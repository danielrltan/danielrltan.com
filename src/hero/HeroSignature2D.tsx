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
  speedMultiplier = 1.6,
  opacity,
  zIndex = 5,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // PERF: cap DPR at 1.5 (was 2). The signature is a single-pass
    // ink stroke; at 1.5× the antialiased edges already read crisp,
    // and on 3× retina the 2× cap was allocating a 5760×3240 backing
    // buffer (75MB GPU mem) for a low-opacity persistent background.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Compute target rect in CSS pixels.
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
    // viewport on either axis. The portrait width-ratio (0.72) is safe
    // for the captured signature's wide aspect, but clamp height to a
    // generous fraction of vh (and back-derive width) so a future, more
    // square capture can't draw the gesture past the top/bottom edges.
    const MAX_H = vh * 0.7;
    if (targetW / aspect > MAX_H) targetW = MAX_H * aspect;
    const targetH = targetW / aspect;
    const x0 = (vw - targetW) / 2;
    const y0 = vh * TARGET_VERTICAL_CENTER - targetH / 2;

    // Brush radius scales with the drawn rect (see STROKE_WIDTH_RATIO)
    // so the stroke weight relative to the letterforms is the same on
    // every screen. Stamp spacing scales with the radius for constant
    // overlap density.
    const brushRadius = Math.max(
      MIN_BRUSH_RADIUS,
      targetW * STROKE_WIDTH_RATIO,
    );
    const stepPx = Math.max(1, brushRadius * STEP_RATIO);

    // Pre-bake a single radial-gradient brush stamp; drawImage'd per
    // stroke segment. Soft falloff so individual stamps blend into a
    // continuous-looking stroke instead of beading.
    const brushSize = Math.max(2, Math.ceil(brushRadius * 2 * dpr));
    const brushCanvas = document.createElement("canvas");
    brushCanvas.width = brushSize;
    brushCanvas.height = brushSize;
    const bctx = brushCanvas.getContext("2d")!;
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

    const stamp = (x: number, y: number) => {
      ctx.globalAlpha = STAMP_ALPHA;
      ctx.drawImage(
        brushCanvas,
        x - brushRadius,
        y - brushRadius,
        brushRadius * 2,
        brushRadius * 2,
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
    // without forking the whole code path.
    type FlatEv = { type: "down" | "move" | "up"; t: number; x: number; y: number };
    const flat: FlatEv[] = [];
    for (const stroke of strokes) {
      for (let i = 0; i < stroke.points.length; i++) {
        const p = stroke.points[i]!;
        flat.push({
          type: i === 0 ? "down" : "move",
          t: p.t,
          x: x0 + p.x * targetW,
          y: y0 + p.y * targetH,
        });
      }
      const last = stroke.points[stroke.points.length - 1]!;
      flat.push({ type: "up", t: last.t, x: 0, y: 0 });
    }

    // Stamp one flattened event (shared by the timed playback and the
    // reduced-motion one-shot path).
    const drawEvent = (ev: FlatEv) => {
      if (ev.type === "down") {
        stamp(ev.x, ev.y);
        lastX = ev.x;
        lastY = ev.y;
      } else if (ev.type === "move" && lastX != null && lastY != null) {
        const dx = ev.x - lastX;
        const dy = ev.y - lastY;
        const dist = Math.hypot(dx, dy);
        const steps = Math.max(1, Math.ceil(dist / stepPx));
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          stamp(lastX + dx * t, lastY + dy * t);
        }
        lastX = ev.x;
        lastY = ev.y;
      } else if (ev.type === "up") {
        lastX = null;
        lastY = null;
      }
    };

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
      completed = true;
      onComplete();
      return () => {
        window.removeEventListener("resize", resize);
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
      window.removeEventListener("resize", resize);
    };
    // We intentionally re-run only on data change. Speed multiplier
    // changes after first render are ignored; first-paint timing
    // determines the loading sequence pace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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
        transition: "opacity 480ms ease",
      }}
    />
  );
}
