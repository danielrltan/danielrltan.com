import { useEffect, useRef } from "react";
import { useScrollProgress } from "./useScrollProgress";

/**
 * Hero-only background pattern of "rice dots" — small walnut dots
 * tiled across the viewport. The cursor dissolves the dots around it
 * in a blobby fluid way: three overlapping radial-gradient blobs are
 * stamped with `destination-out` each frame, the blob offsets slowly
 * drift via sin/cos so the dissolved edge wobbles organically instead
 * of reading as a hard circle.
 *
 * Fade tied to scroll progress (1 → 0 between 0 and 0.05) so this is
 * purely a hero flourish — once the user scrolls into content the
 * dots disappear and don't compete with the cards.
 */

const DOT_SPACING = 16;
const DOT_RADIUS = 1.2;
const DOT_COLOR = "rgba(21, 23, 26, 0.32)";

const HOLE_BASE_RADIUS = 90;
const HOLE_FEATHER_RADIUS = 220;
const BLOB_OFFSET = 36;
const DRIFT_SPEED = 0.0014;

export function RiceDotsBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -10000, y: -10000 });
  const scrollProgress = useScrollProgress();
  const fadeOpacity = Math.max(0, Math.min(1, 1 - scrollProgress / 0.05));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let raf = 0;
    let running = true;

    let w = 0;
    let h = 0;
    let edgeMaskCanvas: HTMLCanvasElement | null = null;

    const buildEdgeMask = () => {
      // Pre-render the ellipse edge fade once into an offscreen canvas
      // so the per-frame loop can stamp it cheaply via destination-in.
      const m = document.createElement("canvas");
      m.width = Math.round(w * dpr);
      m.height = Math.round(h * dpr);
      const mctx = m.getContext("2d")!;
      const g = mctx.createRadialGradient(
        m.width / 2,
        m.height / 2,
        0,
        m.width / 2,
        m.height / 2,
        Math.max(m.width, m.height) * 0.55,
      );
      g.addColorStop(0.0, "rgba(0, 0, 0, 1)");
      g.addColorStop(0.55, "rgba(0, 0, 0, 1)");
      g.addColorStop(1.0, "rgba(0, 0, 0, 0)");
      mctx.fillStyle = g;
      mctx.fillRect(0, 0, m.width, m.height);
      edgeMaskCanvas = m;
    };

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildEdgeMask();
    };
    resize();
    window.addEventListener("resize", resize);

    const onMove = (e: PointerEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    const onLeave = () => {
      mouseRef.current.x = -10000;
      mouseRef.current.y = -10000;
    };
    window.addEventListener("pointerleave", onLeave);

    const drawDots = () => {
      // Tile the dot pattern across the viewport.
      const cols = Math.ceil(w / DOT_SPACING) + 1;
      const rows = Math.ceil(h / DOT_SPACING) + 1;
      ctx.fillStyle = DOT_COLOR;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * DOT_SPACING;
          const y = r * DOT_SPACING;
          ctx.beginPath();
          ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const eraseAtCursor = (t: number) => {
      const { x: mx, y: my } = mouseRef.current;
      if (mx < -1000) return; // cursor off-screen
      const drift = t * DRIFT_SPEED;
      // Three overlapping blobs around the cursor. Slight drift via
      // sin/cos so the dissolved edge wobbles instead of reading as a
      // hard circle. Each blob is a radial-gradient stamped with
      // destination-out (erases existing paint).
      const blobs = [
        { dx: 0, dy: 0, r: HOLE_FEATHER_RADIUS * 1.0 },
        {
          dx: Math.cos(drift) * BLOB_OFFSET,
          dy: Math.sin(drift * 1.3) * BLOB_OFFSET,
          r: HOLE_FEATHER_RADIUS * 0.85,
        },
        {
          dx: Math.cos(drift * 1.7 + 1.2) * BLOB_OFFSET,
          dy: Math.sin(drift * 1.1 + 0.4) * BLOB_OFFSET,
          r: HOLE_FEATHER_RADIUS * 0.75,
        },
      ];
      ctx.globalCompositeOperation = "destination-out";
      for (const b of blobs) {
        const cx = mx + b.dx;
        const cy = my + b.dy;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, b.r);
        // Solid alpha out to the base radius, then feather to 0.
        const inner = HOLE_BASE_RADIUS / b.r;
        grad.addColorStop(0.0, "rgba(0, 0, 0, 1)");
        grad.addColorStop(Math.min(0.95, inner), "rgba(0, 0, 0, 0.85)");
        grad.addColorStop(1.0, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(cx - b.r, cy - b.r, b.r * 2, b.r * 2);
      }
      ctx.globalCompositeOperation = "source-over";
    };

    const applyEdgeMask = () => {
      if (!edgeMaskCanvas) return;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(edgeMaskCanvas, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.restore();
    };

    const tick = (t: number) => {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      drawDots();
      eraseAtCursor(t);
      applyEdgeMask();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
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
        opacity: fadeOpacity,
      }}
    />
  );
}
