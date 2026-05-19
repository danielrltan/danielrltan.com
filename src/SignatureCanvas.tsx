import { useEffect, useRef } from "react";
import { isSignatureFadeActive, registerSignatureBrush } from "./paint";

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
// so the signature reads as part of the same warm-amber language and
// doesn't drift toward brown.
const PAINT_COLOR = "255, 120, 66";
// Same brush params as PaintTrail's cursor brush. Accumulation
// during replay is controlled by a per-frame destination-out fade
// gated on isSignatureFadeActive() — SignatureReplay flips it ON
// while drawing and OFF the instant replay ends, so the finished
// signature freezes wherever it landed (and stays forever).
const STAMP_ALPHA = 0.45;
const BRUSH_RADIUS = 60;
const FADE_ALPHA = 0.004; // matches PaintTrail's cursor-trail fade rate

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
      // The fade RAF below sets composite to destination-out and
      // resets it, but multiple RAFs can interleave per frame — set
      // composite to source-over here too so a stamp() call that
      // happens between fade frames is guaranteed to DRAW (not erase).
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

    // Per-frame fade. Gated by isSignatureFadeActive() — SignatureReplay
    // turns this ON for the duration of the replay so the accumulating
    // overlapping stamps along each stroke get clamped exactly the same
    // way the cursor trail's per-frame fade clamps cursor strokes. The
    // resulting visible alpha at peak matches a fresh cursor stamp,
    // which is the bauhaus wet-paint look. Replay flips the flag OFF
    // when it finishes; the canvas freezes there and stays.
    let raf = 0;
    const tick = () => {
      if (isSignatureFadeActive()) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = `rgba(0, 0, 0, ${FADE_ALPHA})`;
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
        // Reset for any stamp() that runs later this frame.
        ctx.globalCompositeOperation = "source-over";
      }
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
      }}
    />
  );
}
