import { useEffect, useRef } from "react";
import { registerSignatureBrush } from "./paint";
import { useScrollProgress } from "./useScrollProgress";

/**
 * Separate 2D canvas dedicated to the signature. Same brush look as
 * the cursor trail (warm-amber, solid-bodied, radial soft edge) but
 * NO per-frame fade — strokes stay until the canvas is cleared (which
 * the production site never does once the signature replays).
 *
 * Sits in the wrapper stacking order:
 *   wrapper bg
 *   SignatureCanvas (this, no fade)        ← z-index 0, document order first
 *   PaintTrail canvas (cursor, with fade)  ← z-index 0, document order second
 *   R3F canvas (room)                      ← document order last → on top
 *   chrome / HUD
 *
 * The room overdraws the signature where they overlap; the signature
 * shows in the off-white surround around the room.
 */
// Exact copy of PaintTrail's cursor brush params (option A from the
// brush-comparison brainstorm). No CSS blur, no special compositing —
// per-frame destination-out fade below caps accumulation the same way
// the cursor canvas does.
const PAINT_COLOR = "255, 120, 66"; // #ff7842
const STAMP_ALPHA = 0.45;
const BRUSH_RADIUS = 60;
const FADE_ALPHA = 0.004;

/** Signature stays visible across the hero, then fades to 0 as the
 *  user scrolls into the about/projects sections — by the time the
 *  copy is in view the background should be calm and uncluttered. */
const FADE_START = 0.02;
const FADE_DONE = 0.12;

export function SignatureCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollProgress = useScrollProgress();
  const fadeT = Math.max(
    0,
    Math.min(1, (scrollProgress - FADE_START) / (FADE_DONE - FADE_START)),
  );
  const opacity = 1 - fadeT;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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

    // Pre-baked brush, scaled per stamp via drawImage. Single solid
    // amber core (60% of radius), feathered outer 40%. Same recipe
    // the cursor trail uses so the two read as one paint system.
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
    // PaintTrail's solid-bodied gradient: alpha holds at STAMP_ALPHA
    // across the inner 60% of radius, then ramps to 0 in the outer 40%.
    grad.addColorStop(0.0, `rgba(${PAINT_COLOR}, ${STAMP_ALPHA})`);
    grad.addColorStop(0.6, `rgba(${PAINT_COLOR}, ${STAMP_ALPHA})`);
    grad.addColorStop(1.0, `rgba(${PAINT_COLOR}, 0)`);
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, brushSize, brushSize);

    const stamp = (x: number, y: number, radiusOverride?: number) => {
      // Reset composite to source-over before each stamp — the fade
      // tick below sets destination-out and resets it, but interleaved
      // RAFs may run a stamp after a fade tick within the same frame.
      ctx.globalCompositeOperation = "source-over";
      const radius = radiusOverride ?? BRUSH_RADIUS;
      const size = radius * 2;
      ctx.drawImage(brushCanvas, x - radius, y - radius, size, size);
    };
    // alphaMult parameter on the registered fn is intentionally ignored —
    // the cursor brush doesn't modulate alpha per stamp and we're
    // matching it exactly.
    registerSignatureBrush(stamp);

    // Per-frame fade — identical to PaintTrail. Runs continuously: caps
    // accumulation during replay, dissolves the signature naturally
    // over a few seconds after replay ends.
    let raf = 0;
    const tick = () => {
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0, 0, 0, ${FADE_ALPHA})`;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      registerSignatureBrush(null);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        opacity,
        // No transition — scroll updates at rAF cadence and a CSS
        // transition would fight every step, producing visible
        // stuttering. Raw opacity tracks scroll smoothly because the
        // scroll itself is smooth.
      }}
    />
  );
}
