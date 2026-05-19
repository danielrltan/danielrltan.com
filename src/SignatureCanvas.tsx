import { useEffect, useRef } from "react";
import { registerSignatureBrush } from "./paint";

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
// Single-color amber brush — matches the cat icon / lamp glow / wireframes.
// The soft halo look comes from the CSS blur on the canvas (below),
// not from a multi-color gradient. Strokes read as warm amber ribbons
// with fuzzy edges where they pass through the blur, and slow overlap
// areas naturally accumulate to a slightly deeper amber.
const PAINT_COLOR = "255, 120, 66"; // #ff7842
const STAMP_ALPHA = 0.22;
const BRUSH_RADIUS = 60;
/**
 * CSS blur applied to the entire signature canvas. Smaller than the
 * blob field's 60px because the signature has actual structure to
 * preserve — we want it to read as a soft wet-paint stroke, not as
 * an unreadable cloud.
 */
const CANVAS_BLUR_PX = 12;

export function SignatureCanvas() {
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
    // Simple amber radial gradient: peak alpha at the centre, gentle
    // fade to transparent at the edge. The CSS blur on the canvas
    // takes the gradient and softens it into the soft amber ribbon
    // look — no colour gymnastics needed.
    grad.addColorStop(0.0, `rgba(${PAINT_COLOR}, ${STAMP_ALPHA})`);
    grad.addColorStop(0.35, `rgba(${PAINT_COLOR}, ${STAMP_ALPHA * 0.75})`);
    grad.addColorStop(0.7, `rgba(${PAINT_COLOR}, ${STAMP_ALPHA * 0.35})`);
    grad.addColorStop(1.0, `rgba(${PAINT_COLOR}, 0)`);
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, brushSize, brushSize);

    const stamp = (
      x: number,
      y: number,
      radiusOverride?: number,
      alphaMult?: number,
    ) => {
      // source-over (default). The CSS blur on the canvas element
      // takes care of softening the strokes — any per-frame
      // accumulation at hesitation points reads as painterly density
      // variation through the blur, not as hard amber blobs.
      ctx.globalCompositeOperation = "source-over";
      const radius = radiusOverride ?? BRUSH_RADIUS;
      const size = radius * 2;
      if (alphaMult !== undefined && alphaMult !== 1) {
        ctx.globalAlpha = alphaMult;
        ctx.drawImage(brushCanvas, x - radius, y - radius, size, size);
        ctx.globalAlpha = 1;
      } else {
        ctx.drawImage(brushCanvas, x - radius, y - radius, size, size);
      }
    };
    registerSignatureBrush(stamp);

    return () => {
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
        // CSS blur on the whole canvas — the same trick the Blobs
        // component uses, gives the signature the soft wet-paint
        // quality that direct canvas stamps can't produce on their
        // own. Keeps the painted strokes' colour / position / motion
        // intact, just diffuses the hard edges.
        filter: `blur(${CANVAS_BLUR_PX}px)`,
      }}
    />
  );
}
