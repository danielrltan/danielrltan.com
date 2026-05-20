import { useScrollProgress } from "./useScrollProgress";

/**
 * Right-edge vertical scroll progress rail. Thin hairline track with
 * an orange travelling bar + the seven section ticks. TE / spec
 * sheet idiom — gives the page a physical "you are here" indicator
 * without a heavy navigation chrome.
 */

// Synced to StatusBar.tsx SECTIONS thresholds so a tick lights up at
// the exact scroll position the section badge swaps labels. Previously
// these were a uniform 0.13-step distribution that drifted from the
// badge — the rail tick would activate noticeably before/after the
// badge said the section had changed.
const TICK_POSITIONS = [0.0, 0.10, 0.22, 0.36, 0.52, 0.66, 0.80, 0.92];

export function ScrollRail() {
  const progress = useScrollProgress();
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        // Inset enough from the viewport right edge that the % label
        // (positioned LEFT of the rail) and the tick dashes (extending
        // a few px past the rail on both sides) all sit cleanly inside
        // the page gutter. Was 14, which let the label clip against
        // the viewport edge.
        right: 28,
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
      {/* Section ticks — small horizontal dashes centred on the rail. */}
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
      {/* Live percent label at the head of the travelling bar.
          Anchored to the LEFT of the rail (right: 12) so it doesn't
          push past the viewport edge — previous `left: 10` had it
          fighting the page border with the rail's own inset. */}
      <span
        style={{
          position: "absolute",
          top: `${Math.max(0, Math.min(1, progress)) * 100}%`,
          right: 12,
          transform: "translateY(-50%)",
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          letterSpacing: "0.18em",
          color: "var(--wrapper-ink-soft)",
          fontVariantNumeric: "tabular-nums",
          background: "rgba(248, 246, 243, 0.85)",
          padding: "2px 6px",
          whiteSpace: "nowrap",
        }}
      >
        {String(Math.round(progress * 100)).padStart(2, "0")}
      </span>
    </div>
  );
}
