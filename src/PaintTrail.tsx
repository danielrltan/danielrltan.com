import { useEffect, useRef } from "react";

/**
 * Wet-paint cursor trail. A fullscreen 2D canvas that stamps soft
 * warm-amber blobs at the pointer position with source-over blending,
 * so successive strokes accumulate into saturated amber where the
 * cursor lingers. Old paint dissolves to transparent over a few
 * seconds via a per-frame `destination-out` wash, so the marks
 * linger but never permanently colour the canvas.
 *
 * Sits BEHIND the R3F canvas in the wrapper's stacking order:
 * this component is rendered as the first child of the wrapper, the
 * R3F `<Canvas>` follows. The room's opaque pixels overdraw the
 * paint; the surround is where the marks read.
 *
 * Pointer-events off so 3D interaction & HUD clicks pass through.
 */
const PAINT_COLOR = "204, 96, 36"; // saturated warm amber
// destination-out multiplies remaining alpha by (1 - source). At
// FADE_ALPHA=0.004 that's a 0.4%/frame decay → ~95% alpha gone after
// ~6s, ~50% gone after ~2.5s. Slow enough that the trail clearly
// lingers; fast enough that the canvas doesn't permanently colour.
const FADE_ALPHA = 0.004;
const BASE_RADIUS = 60;
const STAMP_ALPHA = 0.45;
const STEP_PX = 10;

export function PaintTrail() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
      // Reset transform then scale — resize fires multiple times during
      // an OS chrome animation; cumulative scale would warp the strokes.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Single soft-edged radial brush. Cached once and reused by drawing
    // the same canvas into the main one — cheaper than rebuilding a
    // radial gradient per stamp at a high move rate.
    const brushSize = BASE_RADIUS * 2 * dpr;
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
    // Solid-bodied brush: alpha holds at STAMP_ALPHA across the
    // inner 60% of the radius, then ramps to 0 in the outer 40%.
    // Gives each blob a clear body (not just a fuzzy spot) so the
    // stroke reads as paint rather than a soft glow.
    grad.addColorStop(0.0, `rgba(${PAINT_COLOR}, ${STAMP_ALPHA})`);
    grad.addColorStop(0.6, `rgba(${PAINT_COLOR}, ${STAMP_ALPHA})`);
    grad.addColorStop(1.0, `rgba(${PAINT_COLOR}, 0)`);
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, brushSize, brushSize);

    const stamp = (x: number, y: number, radius: number) => {
      // drawImage of a pre-baked radial brush, scaled to the target
      // radius. Much faster than gradient-per-stamp on rapid motion.
      const size = radius * 2;
      ctx.drawImage(brushCanvas, x - radius, y - radius, size, size);
    };

    let lastX = 0;
    let lastY = 0;
    let lastT = 0;
    let hasLast = false;

    const onMove = (e: PointerEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      const now = performance.now();
      if (!hasLast) {
        lastX = x;
        lastY = y;
        lastT = now;
        hasLast = true;
        return;
      }
      const dx = x - lastX;
      const dy = y - lastY;
      const dist = Math.hypot(dx, dy);
      const dt = Math.max(1, now - lastT);
      const vel = dist / dt; // px / ms
      // Slow drag = bigger, denser blob; fast flick = smaller, lighter.
      // Mapped so vel=0 → 1.4×, vel>=1.5 → 0.55×.
      const sizeMult = Math.max(0.55, 1.4 - vel * 0.6);
      const radius = BASE_RADIUS * sizeMult;

      // source-over: amber stamps alpha-blend over the existing canvas
      // contents (initially transparent, accumulating warm amber where
      // strokes overlap). `multiply` would compound to black on the
      // empty starting state because dest.rgb is 0 where alpha=0.
      ctx.globalCompositeOperation = "source-over";
      // Step between last and current so a fast move doesn't leave a
      // dotted line — stamps every STEP_PX pixels.
      const steps = Math.max(1, Math.ceil(dist / STEP_PX));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        stamp(lastX + dx * t, lastY + dy * t, radius);
      }
      lastX = x;
      lastY = y;
      lastT = now;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    const tick = () => {
      // Per-frame fade. `destination-out` at low alpha erases existing
      // canvas alpha, dissolving old strokes back to fully transparent
      // so the wrapper bg shows through again. Cleaner than overlaying
      // a surround colour — no risk of leaving a tinted "ghost" plane
      // if the surround colour ever drifts from the wrapper bg.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = `rgba(0, 0, 0, ${FADE_ALPHA})`;
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        // Behind the R3F canvas. With no z-index on the canvas and
        // this rendered as the wrapper's first child, document order
        // puts it under. The R3F canvas (alpha:true) only paints over
        // it where the room's opaque pixels are; the surround stays
        // visible so the paint reads.
        zIndex: 0,
        pointerEvents: "none",
        // No mix-blend-mode — plain alpha composite over wrapper bg.
        // Tried multiply earlier; with sub-1.0 canvas alpha it just
        // mixed toward pale tan instead of deepening the cream. Direct
        // alpha blending of a strongly-coloured brush reads cleaner.
      }}
    />
  );
}
