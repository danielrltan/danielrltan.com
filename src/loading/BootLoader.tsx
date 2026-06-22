import { useEffect, useRef, useState } from "react";
import { useAssembly } from "./AssemblyController";
import "./boot-loader.css";

/**
 * Live loading overlay shown during html.loading-active.
 *
 * "SIGNAL ACQUIRE" — an ASCII TRANSMISSION FIELD on the International Orange
 * scrim. A grid of the site's own ASCII vocabulary churns like television
 * static / an incoming signal, and LOCKS IN from the bottom up (faint orange
 * noise → bright ordered white) as the load progresses, so the percentage is
 * also readable as how much of the field has resolved. It is a deliberate
 * preview of the hero's centerpiece (the orange field with white ASCII symbols
 * carved into a ring), so the loader and the page that follows read as one
 * world — and it announces "this is not a normal site" before the first scroll.
 * A CRT scanline veil + a hairline boot readout finish the retro-terminal voice.
 *
 * Cheap: one eased progress value drives the readout + the lock wavefront; the
 * ASCII field is a small 2D canvas redrawn at ~24fps (a few hundred fillText
 * calls). White ink only, so the hand-off to the signature scrim beneath is
 * seamless. Unmounts at loaderDone; freezes resolved under reduced motion.
 */

// Sparse → dense ASCII ramp: the transmission/dither vocabulary, echoing the
// hero ignition blast's ramp.
const RAMP = " .,:-=+*ox#%@";

export function BootLoader() {
  const { combinedPct, climaxReady, loaderDone } = useAssembly();
  const complete = climaxReady;

  const [p, setP] = useState(0); // eased 0..1 progress
  const pRef = useRef(0);
  const targetRef = useRef(0);
  targetRef.current = complete ? 1 : Math.max(0, Math.min(1, combinedPct));
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Eased progress readout (rAF, fixed-rate). Self-stops once fully landed.
  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let raf = 0;
    const tick = () => {
      const t = targetRef.current;
      if (reduced) pRef.current = t;
      else {
        pRef.current += (t - pRef.current) * 0.14;
        if (t - pRef.current < 0.0015) pRef.current = t;
      }
      const next = Math.round(pRef.current * 1000) / 1000;
      setP((prev) => (prev === next ? prev : next));
      if (t >= 1 && pRef.current >= 0.9999) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // ASCII transmission field. Churns as noise and LOCKS from the bottom up as
  // pRef climbs: a cell whose height-fraction-from-bottom is below the eased
  // progress (with a dithered wavefront) flips to bright steady white; above it
  // it stays a faint flowing orange grain. At 100% the whole field is locked.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const CELL = 13;
    const FONT = 14;
    let W = 0,
      H = 0,
      cols = 0,
      rows = 0;
    const resize = () => {
      const r = cv.getBoundingClientRect();
      W = r.width || 360;
      H = r.height || 200;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.max(1, Math.ceil(W / CELL));
      rows = Math.max(1, Math.ceil(H / CELL));
    };
    resize();

    // Cheap value noise (matches the hero ignition's fbm voice).
    const hash = (x: number, y: number) => {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const vnoise = (x: number, y: number) => {
      const xi = Math.floor(x),
        yi = Math.floor(y),
        xf = x - xi,
        yf = y - yi;
      const u = xf * xf * (3 - 2 * xf),
        v = yf * yf * (3 - 2 * yf);
      const a = hash(xi, yi),
        b = hash(xi + 1, yi),
        c = hash(xi, yi + 1),
        d = hash(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    };
    const fbm = (x: number, y: number) =>
      0.6 * vnoise(x, y) + 0.3 * vnoise(x * 2.1, y * 2.1) + 0.1 * vnoise(x * 4.3, y * 4.3);
    // Ordered 4x4 Bayer value for a crisp dithered lock wavefront.
    const BAYER = [
      0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5,
    ].map((v) => v / 16);

    let raf = 0;
    let last = -1;
    let t0 = 0;

    const draw = (timeS: number) => {
      const prog = pRef.current;
      ctx.clearRect(0, 0, W, H);
      ctx.font = `700 ${FONT}px "Geist Mono","Geist",monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let gy = 0; gy < rows; gy++) {
        // 0 at the BOTTOM row, 1 at the top — the signal fills from the floor.
        const fromBottom = 1 - gy / Math.max(1, rows - 1);
        for (let gx = 0; gx < cols; gx++) {
          const px = gx * CELL + CELL / 2;
          const py = gy * CELL + CELL / 2;
          // Flowing grain (vertical drift = an incoming transmission).
          const n = fbm(gx * 0.22, gy * 0.2 - timeS * 0.9);
          // Dithered lock wavefront: cell resolves once the fill line + a Bayer
          // jitter passes its height. Soft band so the edge fizzes, not a hard
          // line.
          const jitter = (BAYER[(gy % 4) * 4 + (gx % 4)]! - 0.5) * 0.16;
          const locked = fromBottom <= prog + jitter;
          let inten: number;
          let col: string;
          if (locked) {
            // Steady, bright, near-fully-ordered white — the acquired signal.
            inten = 0.62 + 0.32 * n;
            col = `rgba(255,255,255,${(0.86 + 0.14 * n).toFixed(2)})`;
          } else {
            // Faint flowing orange-white grain (reads on the orange field).
            inten = 0.18 + 0.55 * n;
            const a = 0.1 + 0.32 * n;
            col = `rgba(255,239,228,${a.toFixed(2)})`;
          }
          const gi = Math.max(
            0,
            Math.min(RAMP.length - 1, Math.floor(inten * (RAMP.length - 1))),
          );
          const ch = RAMP[gi]!;
          if (ch === " ") continue;
          ctx.fillStyle = col;
          ctx.fillText(ch, px, py);
        }
      }
    };

    if (reduced) {
      // Static, mostly-resolved field — no churn.
      pRef.current = Math.max(pRef.current, 0.0);
      draw(0);
      window.addEventListener("resize", () => {
        resize();
        draw(0);
      });
      return;
    }

    const frame = (now: number) => {
      if (t0 === 0) t0 = now;
      const timeS = (now - t0) / 1000;
      // ~24fps cap — the field is a slow churn, imperceptible faster.
      if (last < 0 || timeS - last >= 1 / 24) {
        last = timeS;
        draw(timeS);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onResize = () => resize();
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loaderDone) return null;

  const pct = Math.round(p * 100);
  const ready = complete || pct >= 100;
  // Stepped pixel meter: 24 cells, filled by the eased progress.
  const STEPS = 24;
  const filled = Math.round(p * STEPS);

  return (
    <div
      className={`boot-loader${ready ? " is-ready" : ""}${complete ? " is-complete" : ""}`}
      aria-hidden="true"
    >
      {/* CRT scanline + flicker veil over the whole field. */}
      <div className="boot-scan" aria-hidden="true" />

      <div className="boot-loader__status">
        <b>SYS</b>
        <span>{ready ? "SIGNAL LOCKED" : "ACQUIRING"}</span>
      </div>

      <div className="boot-loader__center">
        {/* The transmission window: ASCII field locking in from the floor. */}
        <div className="boot-screen">
          <canvas ref={canvasRef} className="boot-ascii" />
          <div className="boot-screen__frame" aria-hidden="true" />
        </div>

        <div className="boot-loader__readout">
          <div className="boot-loader__word">
            {ready ? "READY" : "LOADING"}
          </div>
          <div className="boot-loader__meter" aria-hidden="true">
            {Array.from({ length: STEPS }, (_, i) => (
              <span
                key={i}
                className={`boot-cell${i < filled ? " is-on" : ""}`}
              />
            ))}
          </div>
          <div className="boot-loader__pct">
            {pct}
            <span>%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
