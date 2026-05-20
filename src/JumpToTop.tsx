import { ArrowUp } from "lucide-react";
import { useScrollProgress } from "./useScrollProgress";

/**
 * Persistent "jump to top" pill anchored bottom-left of the
 * viewport. Visible once the user has scrolled past the hero so it
 * doesn't clutter the landing.
 */
const SHOW_AT_PROGRESS = 0.08;

export function JumpToTop() {
  const progress = useScrollProgress();
  const visible = progress >= SHOW_AT_PROGRESS;

  return (
    <button
      type="button"
      aria-label="Jump to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      style={{
        position: "fixed",
        right: 22,
        bottom: 22,
        zIndex: 35,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "9px 14px 9px 12px",
        background: "rgba(255, 255, 255, 0.72)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(21, 23, 26, 0.10)",
        borderRadius: 999,
        color: "var(--wrapper-ink)",
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        fontWeight: 600,
        cursor: "pointer",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        pointerEvents: visible ? "auto" : "none",
        transition:
          "opacity 220ms ease, transform 220ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <ArrowUp size={13} strokeWidth={2} />
      <span>Top</span>
    </button>
  );
}
