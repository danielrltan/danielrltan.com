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
// Cat icon / lamp glow / wireframes all use #ff7842 — matching here
// so the signature reads as part of the same warm-amber language.
const PAINT_COLOR = "255, 120, 66";
// Brush params matched to PaintTrail's cursor brush. Accumulation is
// prevented categorically by destination-over compositing in stamp()
// below — each canvas pixel can only be painted by the FIRST stamp
// that covers it, so slow strokes with lots of overlapping stamps
// can't saturate into dark blobs. No fade needed (and no fade applied)
// — the canvas state stays exactly as drawn, forever.
const STAMP_ALPHA = 0.45;
const BRUSH_RADIUS = 60;

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
    grad.addColorStop(0, `rgba(${PAINT_COLOR}, ${STAMP_ALPHA})`);
    grad.addColorStop(0.6, `rgba(${PAINT_COLOR}, ${STAMP_ALPHA})`);
    grad.addColorStop(1, `rgba(${PAINT_COLOR}, 0)`);
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, brushSize, brushSize);

    const stamp = (
      x: number,
      y: number,
      radiusOverride?: number,
      alphaMult?: number,
    ) => {
      // destination-over: paint only where the canvas is still
      // transparent. The FIRST stamp at each pixel wins; subsequent
      // overlapping stamps can extend the stroke into untouched
      // territory but cannot compound atop already-painted pixels.
      // This is the categorical fix for the "stuck dark blob" issue
      // at slow-signing hesitations — accumulation literally can't
      // happen because the second deposit at a pixel is a no-op.
      ctx.globalCompositeOperation = "destination-over";
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
      }}
    />
  );
}
