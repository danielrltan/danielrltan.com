import { useEffect, useRef } from "react";

/**
 * Self-contained footer signature. Renders the captured gesture
 * (signature.json) into a small canvas that lives INSIDE the
 * footer column, scaled to fit. Independent from the fullscreen
 * SignatureCanvas + SignatureReplay pair that used to live at the
 * hero — this version doesn't need the global brush registry, it
 * paints directly into its own ctx with its own projection.
 *
 * Trigger: once the canvas's IntersectionObserver fires, the
 * stroke replays from t=0 over ~1.6s. No fade afterwards — the
 * signature stays painted as a sign-off element.
 */

interface NormalizedEvent {
  type: "down" | "move" | "up";
  t: number;
  nx: number;
  ny: number;
}
interface SignatureJSON {
  totalDuration: number;
  events: NormalizedEvent[];
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
}

interface Props {
  /** CSS height of the signature canvas. Defaults to 120px. */
  height?: number;
  /** Stroke colour (defaults to brand accent orange). */
  color?: string;
  /** Base stamp radius in CSS pixels. */
  brushRadius?: number;
  /** Replay speed multiplier (>1 = faster). */
  speed?: number;
}

const STAMP_ALPHA = 0.55;
const STEP_PX = 4;

export function FooterSignature({
  height = 120,
  color = "232, 112, 64",
  brushRadius = 6,
  speed = 2.4,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = wrap.clientWidth;
    let h = height;

    const setupCanvas = () => {
      w = wrap.clientWidth;
      h = height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
    };
    setupCanvas();

    // Pre-bake the brush stamp once so the replay loop just blits it.
    const brushSize = brushRadius * 2;
    const brushCanvas = document.createElement("canvas");
    brushCanvas.width = brushSize * dpr;
    brushCanvas.height = brushSize * dpr;
    const bctx = brushCanvas.getContext("2d")!;
    bctx.scale(dpr, dpr);
    const grad = bctx.createRadialGradient(
      brushRadius,
      brushRadius,
      0,
      brushRadius,
      brushRadius,
      brushRadius,
    );
    grad.addColorStop(0, `rgba(${color}, ${STAMP_ALPHA})`);
    grad.addColorStop(0.55, `rgba(${color}, ${STAMP_ALPHA * 0.85})`);
    grad.addColorStop(1, `rgba(${color}, 0)`);
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, brushSize, brushSize);

    const stamp = (x: number, y: number) => {
      ctx.drawImage(
        brushCanvas,
        x - brushRadius,
        y - brushRadius,
        brushSize,
        brushSize,
      );
    };

    let cancelled = false;
    let raf = 0;

    const start = async () => {
      let sig: SignatureJSON | null = null;
      try {
        const r = await fetch("/signature.json");
        if (!r.ok) return;
        sig = (await r.json()) as SignatureJSON;
      } catch {
        return;
      }
      if (!sig || cancelled) return;

      // Project the normalised gesture into our small canvas while
      // preserving the gesture's natural aspect ratio. Fit-contain
      // with vertical centering and a LEFT-edge anchor (so the
      // signature reads as a sign-off above the Elsewhere column
      // header).
      //
      // Margin = brushRadius on each side: the brush is a soft
      // radial-gradient stamp that extends ±brushRadius from each
      // path point. With x0 = 0, the leftmost path point's stamp
      // drew from x = -brushRadius (clipped by the wrap's
      // overflow:hidden). Insetting by one brush-radius on both
      // sides gives the stamps clearance without re-centering the
      // signature.
      //
      // Same logic vertically — h * 0.7 clamp instead of 0.84 leaves
      // brush headroom top + bottom.
      const bounds = sig.bounds ?? { minX: 0, minY: 0, maxX: 1000, maxY: 300 };
      const aspect =
        (bounds.maxX - bounds.minX) /
        Math.max(1, bounds.maxY - bounds.minY);
      const xMargin = brushRadius;
      let targetW = w - xMargin * 2;
      let targetH = targetW / aspect;
      if (targetH > h * 0.7) {
        targetH = h * 0.7;
        targetW = targetH * aspect;
      }
      const x0 = xMargin;
      const y0 = (h - targetH) / 2;
      const projectX = (nx: number) => x0 + nx * targetW;
      const projectY = (ny: number) => y0 + ny * targetH;

      const startWallMs = performance.now();
      let nextIdx = 0;
      let lastX: number | null = null;
      let lastY: number | null = null;

      const tick = () => {
        if (cancelled || !sig) return;
        const elapsed = (performance.now() - startWallMs) * speed;
        while (nextIdx < sig.events.length && sig.events[nextIdx]!.t <= elapsed) {
          const ev = sig.events[nextIdx]!;
          const px = projectX(ev.nx);
          const py = projectY(ev.ny);
          if (ev.type === "down") {
            lastX = px;
            lastY = py;
            stamp(px, py);
          } else if (ev.type === "move") {
            if (lastX != null && lastY != null) {
              const dx = px - lastX;
              const dy = py - lastY;
              const dist = Math.hypot(dx, dy);
              const steps = Math.max(1, Math.ceil(dist / STEP_PX));
              for (let i = 1; i <= steps; i++) {
                const t = i / steps;
                stamp(lastX + dx * t, lastY + dy * t);
              }
            } else {
              stamp(px, py);
            }
            lastX = px;
            lastY = py;
          } else {
            lastX = null;
            lastY = null;
          }
          nextIdx++;
        }
        if (nextIdx < sig.events.length) {
          raf = requestAnimationFrame(tick);
        }
      };
      raf = requestAnimationFrame(tick);
    };

    // Trigger replay when the wrap scrolls into view.
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            obs.disconnect();
            start();
            break;
          }
        }
      },
      { threshold: 0.25 },
    );
    obs.observe(wrap);

    const onResize = () => setupCanvas();
    window.addEventListener("resize", onResize);

    return () => {
      cancelled = true;
      obs.disconnect();
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, [height, color, brushRadius, speed]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        width: "100%",
        height,
        marginBottom: 24,
        overflow: "hidden",
      }}
    >
      <canvas ref={canvasRef} aria-hidden style={{ display: "block" }} />
    </div>
  );
}
