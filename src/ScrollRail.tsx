import { useScrollProgress } from "./useScrollProgress";

/**
 * Right-edge vertical scroll progress rail. Thin hairline track with
 * an orange travelling bar + the seven section ticks. TE / spec
 * sheet idiom — gives the page a physical "you are here" indicator
 * without a heavy navigation chrome.
 */

const TICK_POSITIONS = [0.0, 0.13, 0.26, 0.40, 0.55, 0.70, 0.83, 0.95];

export function ScrollRail() {
  const progress = useScrollProgress();
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        right: 14,
        top: "18%",
        bottom: "18%",
        width: 1,
        background: "rgba(26, 23, 20, 0.10)",
        zIndex: 30,
        pointerEvents: "none",
      }}
    >
      {/* Travelling bar — height fills from top down to current progress. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: -1,
          width: 3,
          height: `${Math.max(0, Math.min(1, progress)) * 100}%`,
          background: "var(--accent)",
        }}
      />
      {/* Section ticks — small horizontal dashes off the rail. */}
      {TICK_POSITIONS.map((t, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: -3,
            top: `${t * 100}%`,
            width: 7,
            height: 1,
            background:
              progress >= t
                ? "var(--accent)"
                : "rgba(26, 23, 20, 0.28)",
            transition: "background 200ms ease",
          }}
        />
      ))}
      {/* Live percent label at the head of the travelling bar. */}
      <span
        style={{
          position: "absolute",
          top: `${Math.max(0, Math.min(1, progress)) * 100}%`,
          left: 10,
          transform: "translateY(-50%)",
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          letterSpacing: "0.18em",
          color: "var(--wrapper-ink-soft)",
          fontVariantNumeric: "tabular-nums",
          background: "rgba(248, 246, 243, 0.85)",
          padding: "2px 6px",
        }}
      >
        {String(Math.round(progress * 100)).padStart(2, "0")}
      </span>
    </div>
  );
}
