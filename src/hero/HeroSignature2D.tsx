import { useEffect, useRef } from "react";
import { type SignatureData, eventsToStrokes } from "./signatureGeometry";

/**
 * 2D canvas that draws the captured signature stroke-by-stroke in
 * WHITE against the orange loading background. This is the loading
 * screen's visible state — it replaces the wireframe assembly.
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
}

// White, ~half the footer's 60px brush radius (per user direction
// "keep stroke half thinness of what we have now").
const STROKE_COLOR = "#ffffff";
const BRUSH_RADIUS = 14;
// Single stamp pass — no soft fade halo, no glow. The signature is
// already on a saturated orange background; over-blurring the stroke
// makes the gesture look like a smudge rather than a confident mark.
const STAMP_ALPHA = 0.95;
const STEP_PX = 4;

// Target signature size as a fraction of viewport width. The 3D hero
// will expand from this baseline to a larger ratio during the
// transition, so the 2D draw should land at the "compact" size.
const TARGET_WIDTH_RATIO = 0.45;
// Vertical center of the loading signature, as a fraction of viewport
// height from the top.
const TARGET_VERTICAL_CENTER = 0.5;

export function HeroSignature2D({
  data,
  onComplete,
  speedMultiplier = 1.6,
  opacity,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
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

    // Pre-bake a single radial-gradient brush stamp; drawImage'd per
    // stroke segment. Soft falloff so individual stamps blend into a
    // continuous-looking stroke instead of beading.
    const brushSize = BRUSH_RADIUS * 2 * dpr;
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
        x - BRUSH_RADIUS,
        y - BRUSH_RADIUS,
        BRUSH_RADIUS * 2,
        BRUSH_RADIUS * 2,
      );
    };

    // Compute target rect in CSS pixels.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const captureW = data.bounds ? data.bounds.maxX - data.bounds.minX : 1;
    const captureH = data.bounds ? data.bounds.maxY - data.bounds.minY : 0.3;
    const aspect = captureW / Math.max(1, captureH);
    const targetW = vw * TARGET_WIDTH_RATIO;
    const targetH = targetW / aspect;
    const x0 = (vw - targetW) / 2;
    const y0 = vh * TARGET_VERTICAL_CENTER - targetH / 2;

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

    // Flatten strokes back into ordered events for simple playback —
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

    const tick = () => {
      if (completed) return;
      if (startWall === 0) startWall = performance.now();
      const elapsedRecorded = (performance.now() - startWall) * speedMultiplier;
      while (lastEventIdx < flat.length && flat[lastEventIdx]!.t <= elapsedRecorded) {
        const ev = flat[lastEventIdx]!;
        if (ev.type === "down") {
          stamp(ev.x, ev.y);
          lastX = ev.x;
          lastY = ev.y;
        } else if (ev.type === "move" && lastX != null && lastY != null) {
          const dx = ev.x - lastX;
          const dy = ev.y - lastY;
          const dist = Math.hypot(dx, dy);
          const steps = Math.max(1, Math.ceil(dist / STEP_PX));
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
    // changes after first render are ignored — first-paint timing
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
        zIndex: 5,
        pointerEvents: "none",
        opacity,
        transition: "opacity 480ms ease",
      }}
    />
  );
}
