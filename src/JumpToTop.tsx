import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";

/** Persistent jump-to-top pill, bottom-right. Visible after the hero. */
const SHOW_AT_PROGRESS = 0.08;

export function JumpToTop() {
  // OLD: consumed useScrollProgress()'s continuous 0..1 value, so the button
  // re-rendered on every scroll frame the float changed (~per frame).
  // NEW: own rAF/scroll handler computes only the boolean and setState's
  // solely when it flips — at most 2 re-renders for the whole page scroll.
  // Mirrors useScrollProgress's progress = scrollY / max(1, scrollHeight - innerHeight).
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const max = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const progress = Math.max(0, Math.min(1, window.scrollY / max));
      const next = progress >= SHOW_AT_PROGRESS;
      setVisible((prev) => (prev === next ? prev : next));
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <button
      type="button"
      className="hud-btn"
      aria-label="Jump to top"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      style={{
        position: "fixed",
        // Safe-area aware bottom-right so the button clears the home
        // indicator / rounded corner on phones (viewport-fit=cover).
        right: "max(18px, env(safe-area-inset-right, 0px) + 14px)",
        bottom: "max(18px, env(safe-area-inset-bottom, 0px) + 14px)",
        zIndex: 35,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        // 44×44 minimum touch target (was 38×38, below the tap floor).
        width: 44,
        height: 44,
        padding: 0,
        // Flat sharp square, matching the sitewide shape lock (radius 0)
        // and the flat chip language; the glass circle was off-voice.
        background: "var(--bg-surface, #ffffff)",
        border: "1px solid var(--ink-hairline)",
        borderRadius: 0,
        boxShadow: "0 8px 24px -16px rgba(13, 14, 16, 0.25)",
        color: "var(--ink)",
        cursor: "pointer",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(8px)",
        pointerEvents: visible ? "auto" : "none",
        transition:
          "opacity 220ms ease, transform 220ms cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <ArrowUp size={15} strokeWidth={2} />
    </button>
  );
}
