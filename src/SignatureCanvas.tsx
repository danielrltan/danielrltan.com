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
// Glow-brush palette. Each stamp's radial gradient runs from a bright
// butter-yellow CORE through warm golden mid-tones to a warm amber
// OUTER ring, then fades to transparent. The CSS blur on the canvas
// (below) diffuses the gradient stops into a soft neon halo: bright
// yellow centerline with an orange outline, exactly like the look the
// user pointed at.
const CORE_YELLOW = "255, 235, 140"; // bright butter yellow #ffeb8c
const MID_GOLD = "255, 200, 100"; // warm golden #ffc864
const EDGE_AMBER = "255, 120, 66"; // cat-icon orange #ff7842
const STAMP_ALPHA = 0.28;
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
    // Multi-stop glow gradient:
    //   - 0.0 → 0.25: bright butter yellow core at peak alpha
    //   - 0.25 → 0.55: transition through warm golden
    //   - 0.55 → 0.85: warm amber outer ring (the "outline" colour)
    //   - 0.85 → 1.0: amber fades to transparent
    // The CSS blur on the canvas softens these stops into a continuous
    // glow — yellow-bright centreline with an orange halo, no hard
    // colour bands.
    grad.addColorStop(0.0, `rgba(${CORE_YELLOW}, ${STAMP_ALPHA})`);
    grad.addColorStop(0.25, `rgba(${CORE_YELLOW}, ${STAMP_ALPHA * 0.85})`);
    grad.addColorStop(0.45, `rgba(${MID_GOLD}, ${STAMP_ALPHA * 0.65})`);
    grad.addColorStop(0.7, `rgba(${EDGE_AMBER}, ${STAMP_ALPHA * 0.4})`);
    grad.addColorStop(0.9, `rgba(${EDGE_AMBER}, ${STAMP_ALPHA * 0.15})`);
    grad.addColorStop(1.0, `rgba(${EDGE_AMBER}, 0)`);
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
