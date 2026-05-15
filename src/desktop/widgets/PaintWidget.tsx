import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Eraser } from "lucide-react";
import { Card, Eyebrow } from "../Card";
import { useTheme } from "../theme";

const SWATCHES = ["accent", "accent2", "muted", "textLt"] as const;
type Swatch = (typeof SWATCHES)[number];

/**
 * A tiny in-OS paint surface. The user can scribble with the pointer on a
 * dot-grid canvas, swap stroke color from a small palette, and clear it.
 *
 * The drawing surface is an HTML5 `<canvas>` sized to its container; the
 * dot grid sits behind the canvas as a CSS background so strokes float
 * on top of the paper texture.
 */
export function PaintWidget() {
  const { colors } = useTheme();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [stroke, setStroke] = useState<Swatch>("accent");

  // Keep the canvas's internal pixel size in sync with its CSS size so
  // strokes don't blur on retina or when the widget resizes.
  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    const fit = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.floor(r.width * dpr);
      cv.height = Math.floor(r.height * dpr);
      cv.style.width = `${r.width}px`;
      cv.style.height = `${r.height}px`;
      const ctx = cv.getContext("2d");
      if (ctx) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = 2.5;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const colorFor = useCallback(
    (s: Swatch) => {
      switch (s) {
        case "accent":
          return colors.accent;
        case "accent2":
          return colors.accent2;
        case "muted":
          return colors.muted;
        case "textLt":
          return colors.textLt;
      }
    },
    [colors],
  );

  const localXY = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const cv = canvasRef.current;
    if (!cv) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    const p = localXY(e);
    lastRef.current = p;
    // Single-tap "dot": draw a tiny mark so taps register.
    const ctx = cv.getContext("2d");
    if (ctx) {
      ctx.fillStyle = colorFor(stroke);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const p = localXY(e);
    const last = lastRef.current ?? p;
    ctx.strokeStyle = colorFor(stroke);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
  };

  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false;
    lastRef.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const clear = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  return (
    <Card>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <Eyebrow>paint</Eyebrow>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {SWATCHES.map((s) => (
            <button
              key={s}
              onClick={() => setStroke(s)}
              aria-label={`color ${s}`}
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: colorFor(s),
                border: `2px solid ${
                  stroke === s ? "var(--text-lt)" : "transparent"
                }`,
                cursor: "pointer",
                padding: 0,
              }}
            />
          ))}
          <button
            onClick={clear}
            aria-label="clear"
            style={{
              marginLeft: 6,
              width: 22,
              height: 22,
              border: "1px solid var(--muted)",
              background: "transparent",
              color: "var(--muted)",
              borderRadius: 5,
              cursor: "pointer",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Eraser size={12} />
          </button>
        </div>
      </div>
      <div
        ref={wrapRef}
        style={{
          width: "100%",
          height: 60,
          position: "relative",
          borderRadius: 6,
          overflow: "hidden",
          background: "var(--bg)",
          backgroundImage:
            "radial-gradient(circle at center, color-mix(in srgb, var(--text-dk) 25%, transparent) 1px, transparent 1.4px)",
          backgroundSize: "16px 16px",
          cursor: "crosshair",
        }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          style={{
            position: "absolute",
            inset: 0,
            touchAction: "none",
          }}
        />
      </div>
    </Card>
  );
}
