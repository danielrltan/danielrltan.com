import { useEffect, useRef, useState, type ReactNode } from "react";
import { AsciiCatPlush } from "./AsciiCatPlush";

interface Props {
  /** CSS dimensions of the host monitor — boot UI fills these. */
  width: number;
  height: number;
  /** Total boot duration in ms (loading bar + cat spin). */
  duration?: number;
  /** Content rendered once the boot finishes. */
  children: ReactNode;
}

const TICK_MS = 60;
const FADE_MS = 320;

const LINES = [
  "DanielPC / boot ",
  "mounting /dev/cat ✓",
  "thinking ✓",
  "linking widgets ✓",
  "hydrating windows ✓",
  "ready.",
];

/**
 * Black-screen boot transition. Mounts every time the OS first appears
 * (so re-entering desk view triggers a fresh boot):
 *
 *   1. Black background, orange ASCII cat spinning centered.
 *   2. Fake loading bar fills over `duration` ms.
 *   3. Short scroll of fake status lines synchronised with the bar.
 *   4. Boot UI fades out, children take over.
 */
// Default tuned so the cat completes at least one full rotation. With
// `AsciiCatPlush rpm=1.6`, one spin ≈ 3.93s; 4400ms gives a small settle
// after the rotation completes before the OS fades in.
export function BootSequence({
  width,
  height,
  duration = 3000,
  children,
}: Props) {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [fading, setFading] = useState(false);
  const startRef = useRef<number>(performance.now());

  // Tick the loading bar.
  useEffect(() => {
    const id = setInterval(() => {
      const elapsed = performance.now() - startRef.current;
      const p = Math.min(1, elapsed / duration);
      setProgress(p);
      if (p >= 1) {
        clearInterval(id);
        setFading(true);
        setTimeout(() => setDone(true), FADE_MS);
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [duration]);

  if (done) return <>{children}</>;

  const visibleLines = Math.max(
    1,
    Math.min(LINES.length, Math.ceil(progress * LINES.length)),
  );

  return (
    <div
      style={{
        position: "relative",
        width,
        height,
        background: "#000",
        color: "#ff7842",
        fontFamily:
          'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
        opacity: fading ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease`,
        overflow: "hidden",
        // Subtle CRT scanline texture, kept faint.
        backgroundImage:
          "repeating-linear-gradient(to bottom, rgba(255,255,255,0.025) 0 1px, transparent 1px 3px)",
      }}
    >
      {/* Centered cat. */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, calc(-50% - 60px))",
        }}
      >
        <AsciiCatPlush size={260} color="#ff7842" rpm={1.6} />
      </div>

      {/* Loading block. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 80,
          transform: "translateX(-50%)",
          width: Math.min(width - 80, 360),
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "#c45a30",
          }}
        >
          <span>booting roomos</span>
          <span>{Math.floor(progress * 100)}%</span>
        </div>
        <div
          style={{
            height: 3,
            background: "rgba(255,120,66,0.18)",
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress * 100}%`,
              background: "#ff7842",
              transition: "width 60ms linear",
            }}
          />
        </div>
        {/* Status line crawl. Fixed-height pane so the bar above stays
            put; new lines appear at the bottom and earlier lines scroll
            up like a normal CLI. */}
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            lineHeight: 1.6,
            color: "rgba(255,120,66,0.85)",
            height: Math.ceil(11 * 1.6 * LINES.length),
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            overflow: "hidden",
          }}
        >
          {LINES.slice(0, visibleLines).map((l, i) => (
            <div key={i}>
              <span style={{ color: "#7a3d22" }}>{">"}</span> {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
