import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Eraser, Pipette, Redo2, Trash2, Undo2 } from "lucide-react";

const HISTORY_LIMIT = 8;
const UNDO_LIMIT = 40;
const BRUSH_MIN = 1;
const BRUSH_MAX = 32;

/**
 * Paint app. Toolbar: custom color popover, recent-colors history
 * (slides in on add), brush-size slider, undo / redo / clear.
 */
export function PaintWindow() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const undoStack = useRef<ImageData[]>([]);
  const redoStack = useRef<ImageData[]>([]);

  const [strokeColor, setStrokeColor] = useState("#ff7842");
  const [brushSize, setBrushSize] = useState(2.5);
  const [history, setHistory] = useState<string[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [erasing, setErasing] = useState(false);

  const syncButtons = useCallback(() => {
    setCanUndo(undoStack.current.length > 1);
    setCanRedo(redoStack.current.length > 0);
  }, []);

  const pushUndo = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const data = ctx.getImageData(0, 0, cv.width, cv.height);
    undoStack.current.push(data);
    if (undoStack.current.length > UNDO_LIMIT + 1) undoStack.current.shift();
    redoStack.current = [];
    syncButtons();
  }, [syncButtons]);

  const undo = useCallback(() => {
    if (undoStack.current.length <= 1) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const current = undoStack.current.pop()!;
    redoStack.current.push(current);
    const prev = undoStack.current[undoStack.current.length - 1]!;
    ctx.putImageData(prev, 0, 0);
    syncButtons();
  }, [syncButtons]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(next);
    ctx.putImageData(next, 0, 0);
    syncButtons();
  }, [syncButtons]);

  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    let primed = false;
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
      }
      if (!primed) {
        if (ctx) {
          undoStack.current = [
            ctx.getImageData(0, 0, cv.width, cv.height),
          ];
          redoStack.current = [];
          syncButtons();
        }
        primed = true;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [syncButtons]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select"))
      ) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.code === "KeyZ") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.code === "KeyY") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const localXY = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const applyMode = (ctx: CanvasRenderingContext2D) => {
    // Eraser uses `destination-out` so strokes punch holes in the
    // current bitmap. Drawing uses the default composite.
    ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
    ctx.strokeStyle = erasing ? "rgba(0,0,0,1)" : strokeColor;
    ctx.fillStyle = erasing ? "rgba(0,0,0,1)" : strokeColor;
    ctx.lineWidth = brushSize;
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const cv = canvasRef.current;
    if (!cv) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    const p = localXY(e);
    lastRef.current = p;
    const ctx = cv.getContext("2d");
    if (ctx) {
      applyMode(ctx);
      ctx.beginPath();
      ctx.arc(p.x, p.y, brushSize / 2, 0, Math.PI * 2);
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
    applyMode(ctx);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
  };

  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    pushUndo();
    if (!erasing) {
      setHistory((h) => {
        const without = h.filter(
          (c) => c.toLowerCase() !== strokeColor.toLowerCase(),
        );
        return [strokeColor, ...without].slice(0, HISTORY_LIMIT);
      });
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
    pushUndo();
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: 14,
        gap: 10,
      }}
    >
      {/* Local styles for animations */}
      <style>{`
        @keyframes paint-history-slide-in {
          from { transform: translateX(-12px) scale(0.6); opacity: 0; }
          to   { transform: translateX(0)     scale(1);   opacity: 1; }
        }
        .paint-history-chip { animation: paint-history-slide-in 220ms ease both; }
      `}</style>

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        {/* Native color picker — chip is the trigger, hidden input
            sits on top for the click. Polished with an outer ring,
            inner sheen, and the pipette icon as an affordance. */}
        <label
          aria-label="pick color"
          title="pick color"
          style={{
            position: "relative",
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: strokeColor,
            border: "2px solid var(--text-lt)",
            boxShadow:
              "0 0 0 1px rgba(0,0,0,0.25) inset, 0 2px 6px rgba(0,0,0,0.25)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            flexShrink: 0,
            transition: "transform 0.15s ease, box-shadow 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.05)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <Pipette size={13} color="rgba(0,0,0,0.55)" />
          <input
            type="color"
            value={strokeColor}
            onChange={(e) => {
              setStrokeColor(e.target.value);
              setErasing(false);
            }}
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              cursor: "pointer",
              width: "100%",
              height: "100%",
              padding: 0,
              border: "none",
              background: "transparent",
            }}
          />
        </label>

        {/* Recent-colors history */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            history
          </span>
          {history.length === 0 ? (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--muted)",
                opacity: 0.6,
              }}
            >
              draw to record colors
            </span>
          ) : (
            history.map((c) => {
              const selected = c.toLowerCase() === strokeColor.toLowerCase();
              return (
                <button
                  key={c}
                  className="paint-history-chip"
                  onClick={() => setStrokeColor(c)}
                  aria-label={`use ${c}`}
                  title={c}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: c,
                    border: `2px solid ${
                      selected ? "var(--text-lt)" : "transparent"
                    }`,
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                  }}
                />
              );
            })
          )}
        </div>

        {/* Spacer pushes the rest of the toolbar to the right. */}
        <div style={{ flex: 1, minWidth: 4 }} />

        {/* Brush size */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
          title="brush size"
        >
          <span
            style={{
              width: brushSize + 2,
              height: brushSize + 2,
              maxWidth: 18,
              maxHeight: 18,
              borderRadius: "50%",
              // Always white so the preview reads as size regardless
              // of the active stroke color.
              background: "#ffffff",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.2)",
              flexShrink: 0,
            }}
          />
          <input
            type="range"
            min={BRUSH_MIN}
            max={BRUSH_MAX}
            step={0.5}
            value={brushSize}
            onChange={(e) => setBrushSize(parseFloat(e.target.value))}
            aria-label="brush size"
            style={{
              width: 88,
              accentColor: "var(--accent)",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--muted)",
              width: 22,
              textAlign: "right",
            }}
          >
            {brushSize.toFixed(1)}
          </span>
        </div>

        {/* Undo / Redo / Clear */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ToolbarBtn
            onClick={undo}
            disabled={!canUndo}
            label="undo (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={redo}
            disabled={!canRedo}
            label="redo (Ctrl+Shift+Z)"
          >
            <Redo2 size={14} />
          </ToolbarBtn>
          <ToolbarBtn
            onClick={() => setErasing((v) => !v)}
            active={erasing}
            label={erasing ? "drawing mode" : "eraser"}
          >
            <Eraser size={14} />
          </ToolbarBtn>
          <ToolbarBtn onClick={clear} label="clear canvas">
            <Trash2 size={14} />
          </ToolbarBtn>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={wrapRef}
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          borderRadius: 8,
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
    </div>
  );
}

function ToolbarBtn({
  onClick,
  disabled,
  active,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const activeBg = active ? "var(--accent)" : "transparent";
  const activeFg = active ? "var(--text-dk)" : "var(--text-lt)";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      style={{
        width: 30,
        height: 30,
        borderRadius: 6,
        border: `1px solid ${active ? "var(--accent)" : "var(--surface-alt)"}`,
        background: activeBg,
        color: disabled ? "var(--muted)" : activeFg,
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
        display: "grid",
        placeItems: "center",
        transition: "color 0.15s ease, background-color 0.15s ease, border-color 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!disabled && !active)
          e.currentTarget.style.background = "var(--surface-alt)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}
