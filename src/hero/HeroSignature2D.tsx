import { useEffect, useRef } from "react";
import { type SignatureData, eventsToStrokes } from "./signatureGeometry";

/**
 * 2D canvas that draws the captured signature stroke-by-stroke in
 * WHITE against the orange loading background. This is the loading
 * screen's visible state; it replaces the wireframe assembly.
 *
 * Unlike the footer SignatureCanvas (which paints amber on the room
 * scene), this one is dedicated to the hero loading sequence:
 *   - white strokes, half the thickness of the footer's signature
 *   - centered on the viewport
 *   - no per-frame fade (strokes accumulate as drawn)
 *   - signals `onComplete` when the final stroke finishes
 *
 * After completion + assets-loaded the parent HeroSignature crossfades
 * this canvas out and the 3D signature in.
 */

interface Props {
  data: SignatureData | null;
  onComplete: () => void;
  /** Gate: the stroke playback (and the reduced-motion one-pass paint)
   *  only begins once this is true. The loader now finishes BEFORE the
   *  signature draws, so the parent flips this on loaderDone. */
  start: boolean;
  /** Multiplies the natural playback speed. 1 = recorded pace. */
  speedMultiplier?: number;
  /** Visible opacity (parent controls the crossfade out). */
  opacity: number;
  /** Stacking order. High (5) while drawing/crossfading so the ink
   *  paints over the composition; low (1) once settled so the
   *  persistent ghost sits behind the wordmark. */
  zIndex?: number;
}

// White on the orange loading backdrop.
const STROKE_COLOR = "#ffffff";
// Stroke weight as a FRACTION of the signature's drawn width, not a
// fixed pixel radius. The old constant 14px radius was tuned on a
// 1920px desktop where the drawn rect is 864px wide (stroke ≈ 3% of
// the gesture); on a 390px phone the rect shrinks to ~280px but the
// brush didn't, so the stroke ballooned to ~10% of the gesture and
// the signature read as illegible blobs. Deriving the radius from
// targetW keeps the stroke-to-letterform ratio identical on every
// viewport: the signature now LOOKS the same at every size.
const STROKE_WIDTH_RATIO = 14 / 864;
// Floor so the stroke never goes hairline-thin on tiny viewports.
const MIN_BRUSH_RADIUS = 3;
// Single stamp pass: no soft fade halo, no glow. The signature is
// already on a saturated orange background; over-blurring the stroke
// makes the gesture look like a smudge rather than a confident mark.
const STAMP_ALPHA = 0.95;
// Stamp spacing as a fraction of the brush radius (the tuned 4px/14px
// pair) so stamp-overlap density — and therefore the stroke's edge
// quality — stays constant as the radius scales.
const STEP_RATIO = 4 / 14;

// Target signature size as a fraction of viewport width. The 3D hero
// will expand from this baseline to a larger ratio during the
// transition, so the 2D draw should land at the "compact" size.
// On narrow portrait phones 0.45vw is tiny + lost on the orange scrim,
// so widen it there (see resolveWidthRatio) while still guarding the
// drawn rect against horizontal/vertical overflow below.
const TARGET_WIDTH_RATIO = 0.45;
const TARGET_WIDTH_RATIO_PORTRAIT = 0.72;
// Vertical center of the loading signature, as a fraction of viewport
// height from the top.
const TARGET_VERTICAL_CENTER = 0.5;

// Pick the width ratio for the current viewport. Portrait phones (tall,
// narrow) get the larger ratio so the gesture reads at a comfortable
// size; everything else keeps the compact desktop ratio.
function resolveWidthRatio(vw: number, vh: number): number {
  const isPortraitPhone = vw <= 540 && vh >= vw;
  return isPortraitPhone ? TARGET_WIDTH_RATIO_PORTRAIT : TARGET_WIDTH_RATIO;
}

export function HeroSignature2D({
  data,
  onComplete,
  start,
  speedMultiplier = 2.2,
  opacity,
  zIndex = 5,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    // `start` gates the whole draw: until the loader reports done the
    // effect bails, so the signature never paints concurrently with the
    // loading bar. It re-runs (and draws) when start flips true.
    if (!canvas || !data || !start) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // PERF: cap DPR at 1.5 (was 2). The signature is a single-pass
    // ink stroke; at 1.5× the antialiased edges already read crisp,
    // and on 3× retina the 2× cap was allocating a 5760×3240 backing
    // buffer (75MB GPU mem) for a low-opacity persistent background.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const sizeCanvas = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    sizeCanvas();

    // Layout is RECOMPUTED on resize (it used to be captured once: a
    // rotation/resize re-allocated the canvas buffer — which clears
    // it — and the strokes were gone for good, with any in-flight draw
    // continuing at stale coordinates). Everything position-dependent
    // lives in this mutable object; events are stored NORMALIZED and
    // mapped through it at draw time, so a resize can recompute the
    // rect + brush and replay the strokes drawn so far.
    const layout = {
      x0: 0,
      y0: 0,
      targetW: 1,
      targetH: 1,
      brushRadius: MIN_BRUSH_RADIUS,
      stepPx: 1,
      brushCanvas: document.createElement("canvas"),
    };

    const computeLayout = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
    // Event coords (nx, ny) are ALREADY normalized to [0,1] WITHIN the
    // signature's bounding box. SignatureCapture stores them as
    // `(clientX - bounds.minX) / boundsWidth`. The `bounds` field is in
    // ORIGINAL CAPTURE-VIEWPORT PIXELS (e.g. minX = 137 px, maxX = 1472 px),
    // useful only for deriving the signature's native aspect ratio.
    //
    // So the correct mapping is just `p.x * targetW` / `p.y * targetH`,
    // offset by (x0, y0). Subtracting bounds.minX (a pixel value) from
    // p.x (a [0,1] value), as a previous revision did, pushed every
    // stroke ~137 units negative, collapsing the entire signature into
    // a single pixel in the top-left corner of the viewport.
      const captureW = data.bounds ? data.bounds.maxX - data.bounds.minX : 1;
      const captureH = data.bounds ? data.bounds.maxY - data.bounds.minY : 1;
      // Aspect-ratio guard: if bounds are degenerate (single point or
      // missing), fall back to the natural ~16:9 signature aspect so we
      // don't divide by zero or render a zero-height target rect.
      const aspect =
        captureW > 0 && captureH > 0 ? captureW / captureH : 16 / 9;
      // Width ratio adapts to viewport: on a narrow portrait phone the
      // 0.45 desktop ratio renders a timid ~175px gesture dwarfed by the
      // giant wordmark. Widen it toward 0.72 of the viewport on phones so
      // the persistent signature still reads as a confident background
      // mark the wordmark "loads around", while staying centered (same
      // anchor as desktop) so the loading→settled position never jumps.
      const widthRatio = resolveWidthRatio(vw, vh);
      let targetW = vw * widthRatio;
      // Overflow guard: never let the signature's drawn rect exceed the
      // viewport on either axis.
      const MAX_H = vh * 0.7;
      if (targetW / aspect > MAX_H) targetW = MAX_H * aspect;
      layout.targetW = targetW;
      layout.targetH = targetW / aspect;
      layout.x0 = (vw - targetW) / 2;
      layout.y0 = vh * TARGET_VERTICAL_CENTER - layout.targetH / 2;

      // Brush radius scales with the drawn rect (see STROKE_WIDTH_RATIO)
      // so the stroke weight relative to the letterforms is the same on
      // every screen. Stamp spacing scales with the radius for constant
      // overlap density.
      layout.brushRadius = Math.max(
        MIN_BRUSH_RADIUS,
        targetW * STROKE_WIDTH_RATIO,
      );
      layout.stepPx = Math.max(1, layout.brushRadius * STEP_RATIO);

      // (Re)bake the radial-gradient brush stamp at the current radius;
      // drawImage'd per stroke segment. Soft falloff so individual
      // stamps blend into a continuous stroke instead of beading.
      const brushSize = Math.max(2, Math.ceil(layout.brushRadius * 2 * dpr));
      layout.brushCanvas = document.createElement("canvas");
      layout.brushCanvas.width = brushSize;
      layout.brushCanvas.height = brushSize;
      const bctx = layout.brushCanvas.getContext("2d")!;
      const grad = bctx.createRadialGradient(
        brushSize / 2,
        brushSize / 2,
        0,
        brushSize / 2,
        brushSize / 2,
        brushSize / 2,
      );
      grad.addColorStop(0.0, STROKE_COLOR);
      grad.addColorStop(0.6, STROKE_COLOR);
      grad.addColorStop(1.0, "rgba(255,255,255,0)");
      bctx.fillStyle = grad;
      bctx.fillRect(0, 0, brushSize, brushSize);
    };
    computeLayout();

    const stamp = (x: number, y: number) => {
      ctx.globalAlpha = STAMP_ALPHA;
      ctx.drawImage(
        layout.brushCanvas,
        x - layout.brushRadius,
        y - layout.brushRadius,
        layout.brushRadius * 2,
        layout.brushRadius * 2,
      );
    };

    const strokes = eventsToStrokes(data.events);
    // Total recorded duration drives the playback timeline. Each stroke
    // gets its share of the timeline based on its event timestamps.
    const totalRecorded = data.totalDuration;

    let raf = 0;
    let startWall = 0;
    let lastEventIdx = 0;
    let lastX: number | null = null;
    let lastY: number | null = null;
    let completed = false;

    // Flatten strokes back into ordered events for simple playback;
    // gives us the same draw cadence as the footer's SignatureReplay
    // without forking the whole code path. Coordinates stay NORMALIZED
    // [0,1] here and are mapped through `layout` at draw time, so a
    // resize can recompute the rect and replay losslessly.
    type FlatEv = { type: "down" | "move" | "up"; t: number; x: number; y: number };
    const flat: FlatEv[] = [];
    for (const stroke of strokes) {
      for (let i = 0; i < stroke.points.length; i++) {
        const p = stroke.points[i]!;
        flat.push({ type: i === 0 ? "down" : "move", t: p.t, x: p.x, y: p.y });
      }
      const last = stroke.points[stroke.points.length - 1]!;
      flat.push({ type: "up", t: last.t, x: 0, y: 0 });
    }

    // Stamp one flattened event (shared by the timed playback, the
    // reduced-motion one-shot path, and the resize replay).
    const drawEvent = (ev: FlatEv) => {
      const px = layout.x0 + ev.x * layout.targetW;
      const py = layout.y0 + ev.y * layout.targetH;
      if (ev.type === "down") {
        stamp(px, py);
        lastX = px;
        lastY = py;
      } else if (ev.type === "move" && lastX != null && lastY != null) {
        const dx = px - lastX;
        const dy = py - lastY;
        const dist = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(dist / layout.stepPx));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          stamp(lastX + dx * t, lastY + dy * t);
        }
        lastX = px;
        lastY = py;
      } else if (ev.type === "up") {
        lastX = null;
        lastY = null;
      }
    };

    // Resize/rotation: the buffer realloc CLEARS the canvas, so resize
    // used to wipe the signature for good (and an in-flight draw kept
    // painting at stale coordinates). Now: re-size the buffer, recompute
    // the layout + brush, and REPLAY every event drawn so far at the new
    // geometry. The in-flight playback continues seamlessly because
    // events are normalized and mapped at draw time.
    let resizeRaf = 0;
    const onResize = () => {
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        sizeCanvas();
        computeLayout();
        lastX = null;
        lastY = null;
        for (let i = 0; i < lastEventIdx; i++) drawEvent(flat[i]!);
      });
    };
    window.addEventListener("resize", onResize);

    // Reduced motion: skip the stroke-by-stroke animation. Paint the
    // whole signature in one synchronous pass and signal completion so
    // the loading→composition handoff still fires. (The progressive
    // pen-draw IS the motion here; honour the preference by landing it
    // fully formed instead.)
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) {
      for (const ev of flat) drawEvent(ev);
      // Mark the whole stream as drawn so a later resize replays it all.
      lastEventIdx = flat.length;
      completed = true;
      onComplete();
      return () => {
        window.removeEventListener("resize", onResize);
        if (resizeRaf) cancelAnimationFrame(resizeRaf);
      };
    }

    const tick = () => {
      if (completed) return;
      if (startWall === 0) startWall = performance.now();
      const elapsedRecorded = (performance.now() - startWall) * speedMultiplier;
      while (lastEventIdx < flat.length && flat[lastEventIdx]!.t <= elapsedRecorded) {
        drawEvent(flat[lastEventIdx]!);
        lastEventIdx++;
      }
      if (
        lastEventIdx >= flat.length ||
        elapsedRecorded >= totalRecorded
      ) {
        completed = true;
        onComplete();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      if (resizeRaf) cancelAnimationFrame(resizeRaf);
    };
    // Re-run on data arrival AND when `start` flips true (the loader-done
    // gate). Speed multiplier changes after first render are ignored;
    // first-paint timing determines the loading sequence pace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, start]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex,
        pointerEvents: "none",
        opacity,
        transition: "opacity 360ms ease",
      }}
    />
  );
}
