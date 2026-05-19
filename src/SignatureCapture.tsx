import { useEffect, useRef, useState } from "react";

/**
 * Throwaway capture overlay. Mount via `?sign=1` query param to record
 * a signature gesture with full pointer-timing fidelity, then copy /
 * download the JSON and commit it as `public/signature.json`.
 *
 * Records every pointermove with an absolute timestamp; tracks pen
 * up/down events so a multi-stroke signature (lift between letters)
 * replays correctly without interpolating across the gap.
 *
 * Strokes are rendered live on a dark canvas in the same warm-amber
 * brush as the production trail, so what you see during capture is
 * very close to what'll show up on the site.
 *
 * Coordinates are stored as normalized [0,1] floats relative to the
 * viewport bounding box of the gesture. At replay time the consumer
 * picks a target rect (e.g. 90% of viewport behind the room) and
 * scales the normalized points into it. This means: sign at any size
 * in the capture screen and it'll re-fit at runtime.
 */
type CaptureEvent =
  | { type: "down"; t: number; x: number; y: number }
  | { type: "move"; t: number; x: number; y: number }
  | { type: "up"; t: number; x: number; y: number };

interface SignatureJSON {
  capturedAt: string;
  /** Original capture viewport — informational only; replay uses normalized coords. */
  captureViewport: { w: number; h: number };
  /** Bounding box of all recorded points, in capture-viewport pixels. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Total ms from first event to last. */
  totalDuration: number;
  /**
   * Events with t in ms from gesture start (event[0].t === 0), and
   * x/y normalized to [0,1] within `bounds`. Replay scales these to
   * a target rect at render time.
   */
  events: { type: "down" | "move" | "up"; t: number; nx: number; ny: number }[];
}

const PAINT_COLOR = "204, 96, 36";
const STAMP_ALPHA = 0.45;
const BASE_RADIUS = 28; // smaller capture brush so detail isn't lost at this scale

export function SignatureCapture() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const eventsRef = useRef<CaptureEvent[]>([]);
  const drawingRef = useRef(false);
  const lastXRef = useRef(0);
  const lastYRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [duration, setDuration] = useState(0);
  const [copied, setCopied] = useState(false);

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

    // Pre-baked brush, same recipe as the live trail but smaller — at
    // capture-screen scale the production brush would smear the finer
    // strokes of a real signature into mud.
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
    grad.addColorStop(0, `rgba(${PAINT_COLOR}, ${STAMP_ALPHA})`);
    grad.addColorStop(0.6, `rgba(${PAINT_COLOR}, ${STAMP_ALPHA})`);
    grad.addColorStop(1, `rgba(${PAINT_COLOR}, 0)`);
    bctx.fillStyle = grad;
    bctx.fillRect(0, 0, brushSize, brushSize);

    const stamp = (x: number, y: number) => {
      ctx.drawImage(
        brushCanvas,
        x - BASE_RADIUS,
        y - BASE_RADIUS,
        BASE_RADIUS * 2,
        BASE_RADIUS * 2,
      );
    };

    const STEP_PX = 4;

    const recordEvent = (
      type: CaptureEvent["type"],
      e: PointerEvent,
    ) => {
      const now = performance.now();
      if (startTimeRef.current == null) startTimeRef.current = now;
      const t = now - startTimeRef.current;
      eventsRef.current.push({ type, t, x: e.clientX, y: e.clientY });
      setEventCount(eventsRef.current.length);
      setDuration(t);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drawingRef.current = true;
      lastXRef.current = e.clientX;
      lastYRef.current = e.clientY;
      recordEvent("down", e);
      stamp(e.clientX, e.clientY);
    };
    const onMove = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      const dx = e.clientX - lastXRef.current;
      const dy = e.clientY - lastYRef.current;
      const dist = Math.hypot(dx, dy);
      // Step-stamp between last and current for a continuous stroke
      // in the preview. Records every browser-emitted move event for
      // timing fidelity — only the visual is interpolated.
      const steps = Math.max(1, Math.ceil(dist / STEP_PX));
      ctx.globalCompositeOperation = "source-over";
      for (let i = 1; i <= steps; i++) {
        const tt = i / steps;
        stamp(
          lastXRef.current + dx * tt,
          lastYRef.current + dy * tt,
        );
      }
      recordEvent("move", e);
      lastXRef.current = e.clientX;
      lastYRef.current = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (!drawingRef.current) return;
      drawingRef.current = false;
      recordEvent("up", e);
    };

    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);

    return () => {
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (ctx && canvas) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    eventsRef.current = [];
    startTimeRef.current = null;
    setEventCount(0);
    setDuration(0);
    setCopied(false);
  };

  const buildJSON = (): SignatureJSON | null => {
    const events = eventsRef.current;
    if (events.length < 2) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const e of events) {
      if (e.x < minX) minX = e.x;
      if (e.x > maxX) maxX = e.x;
      if (e.y < minY) minY = e.y;
      if (e.y > maxY) maxY = e.y;
    }
    const w = Math.max(1, maxX - minX);
    const h = Math.max(1, maxY - minY);
    return {
      capturedAt: new Date().toISOString(),
      captureViewport: { w: window.innerWidth, h: window.innerHeight },
      bounds: { minX, minY, maxX, maxY },
      totalDuration: events[events.length - 1]!.t,
      events: events.map((e) => ({
        type: e.type,
        t: Math.round(e.t * 100) / 100,
        nx: Math.round(((e.x - minX) / w) * 10000) / 10000,
        ny: Math.round(((e.y - minY) / h) * 10000) / 10000,
      })),
    };
  };

  const copy = async () => {
    const data = buildJSON();
    if (!data) return;
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const data = buildJSON();
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "signature.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10000,
        background: "#161311",
        color: "#e8dcc6",
        fontFamily: "var(--font-mono)",
        cursor: "crosshair",
        userSelect: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed",
          inset: 0,
          touchAction: "none",
        }}
      />
      <div
        style={{
          position: "fixed",
          top: 24,
          left: 24,
          right: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          fontSize: 12,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          pointerEvents: "none",
        }}
      >
        <div>
          <div style={{ color: "#ff7842", fontWeight: 600, marginBottom: 6 }}>
            signature capture
          </div>
          <div style={{ opacity: 0.6 }}>
            click + drag to sign. lift between letters for clean strokes.
          </div>
        </div>
        <div style={{ textAlign: "right", opacity: 0.6 }}>
          <div>events: {eventCount}</div>
          <div>duration: {(duration / 1000).toFixed(2)}s</div>
        </div>
      </div>

      <div
        style={{
          position: "fixed",
          bottom: 32,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 12,
        }}
      >
        <button
          type="button"
          onClick={clear}
          style={btnStyle("#3a2a1f", "#e8dcc6")}
        >
          clear
        </button>
        <button
          type="button"
          onClick={copy}
          disabled={eventCount < 2}
          style={btnStyle("#ff7842", "#161311", eventCount < 2)}
        >
          {copied ? "copied" : "copy json"}
        </button>
        <button
          type="button"
          onClick={download}
          disabled={eventCount < 2}
          style={btnStyle("#ff7842", "#161311", eventCount < 2)}
        >
          download signature.json
        </button>
      </div>
    </div>
  );
}

function btnStyle(
  bg: string,
  fg: string,
  disabled = false,
): React.CSSProperties {
  return {
    background: bg,
    color: fg,
    border: 0,
    padding: "10px 18px",
    borderRadius: 999,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    fontWeight: 600,
  };
}
