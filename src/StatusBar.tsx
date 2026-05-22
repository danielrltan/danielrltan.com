import { useEffect, useState } from "react";
import { RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useAudioToggle } from "./useAudioToggle";

interface Props {
  /** Reset the room (snap throwables / draggables back to starting pose). */
  onReset: () => void;
}

/**
 * Top-right status pill. Shows the section the user is currently
 * looking at, plus the live clock, scroll progress, and audio /
 * reset controls.
 *
 * Section detection is IntersectionObserver-based — observes every
 * `.portfolio-section` and the keypad section, picks whichever one
 * is most prominently in view. This stays accurate as section
 * heights change (e.g., pinned sections grow their pin spacer); the
 * previous scroll-progress-threshold version drifted whenever a
 * section's content grew.
 */

interface SectionEntry {
  number: string;
  label: string;
  /** Selector to identify the section in the DOM. */
  selector: string;
}

// Render order from PortfolioSections.tsx — keep this in lockstep
// when sections are added/removed/renamed.
const SECTION_REGISTRY: SectionEntry[] = [
  { number: "00", label: "Hero", selector: ".portfolio-section--hero" },
  { number: "01", label: "About", selector: ".portfolio-section:not([class*='--'])" }, // generic match — falls back via index
  { number: "02", label: "Stack", selector: ".portfolio-mac" },
  { number: "03", label: "Work", selector: ".portfolio-work" },
  { number: "04", label: "Off the clock", selector: ".portfolio-other" },
  { number: "05", label: "Bits and pieces", selector: ".portfolio-bp" },
  { number: "06", label: "Contact", selector: ".keypad-section" },
];

function formatClock(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Locates each registered section in the DOM. Returns an ordered
 * array (matching SECTION_REGISTRY indices) of nullable elements so
 * we know which slots have a real DOM node and which are still
 * loading.
 */
function findSectionElements(): Array<{ entry: SectionEntry; el: Element | null }> {
  return SECTION_REGISTRY.map((entry, i) => {
    if (i === 1) {
      // About is the second `.portfolio-section` (after hero) that
      // ISN'T one of the special-class sections. Find by index
      // rather than selector to avoid clashing with the keypad's
      // own class.
      const all = Array.from(document.querySelectorAll(".portfolio-section"));
      // Filter to sections WITHOUT the special-section modifier classes.
      const generic = all.filter(
        (e) =>
          !e.classList.contains("portfolio-section--hero") &&
          !e.classList.contains("portfolio-mac") &&
          !e.classList.contains("portfolio-work") &&
          !e.classList.contains("portfolio-other") &&
          !e.classList.contains("portfolio-bp") &&
          !e.classList.contains("keypad-section"),
      );
      return { entry, el: generic[0] ?? null };
    }
    return { entry, el: document.querySelector(entry.selector) };
  });
}

export function StatusBar({ onReset }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const [progressPct, setProgressPct] = useState(0);
  const audio = useAudioToggle();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // IntersectionObserver-based active-section detection. We observe
  // each registered section and recompute the active one whenever an
  // intersection changes. The active section is the LAST one in
  // document order whose center is at or above the viewport center
  // — i.e. the deepest-scrolled-into section.
  useEffect(() => {
    const found = findSectionElements();
    const visibleRatios = new Map<Element, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibleRatios.set(entry.target, entry.intersectionRatio);
        }
        // Determine the active section by finding the deepest one
        // whose top is at or above 50% of the viewport.
        const vh = window.innerHeight || 1;
        let bestIdx = 0;
        for (let i = 0; i < found.length; i++) {
          const el = found[i]!.el;
          if (!el) continue;
          const r = el.getBoundingClientRect();
          // "Active" = the section whose top edge has passed the
          // viewport's upper third. Index-of-deepest wins.
          if (r.top <= vh * 0.45) bestIdx = i;
        }
        setActiveIdx(bestIdx);
      },
      // Slightly inset rootMargin so the boundaries land where the
      // user perceives the section change (not at the very edge).
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const f of found) {
      if (f.el) io.observe(f.el);
    }
    return () => io.disconnect();
  }, []);

  // Scroll-progress percent for the right side of the pill — keep
  // the existing display, just decouple from section detection.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const max = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      setProgressPct(Math.round((window.scrollY / max) * 100));
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

  const active = SECTION_REGISTRY[activeIdx] ?? SECTION_REGISTRY[0]!;

  return (
    <div
      style={{
        position: "fixed",
        top: 18,
        right: 22,
        zIndex: 40,
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        padding: "6px 6px 6px 14px",
        background: "rgba(255, 255, 255, 0.72)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(26, 23, 20, 0.10)",
        borderRadius: 999,
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--wrapper-ink)",
        fontWeight: 600,
        userSelect: "none",
      }}
    >
      {/* Fixed-min-width section slot so the pill doesn't visibly
          resize as the label changes between short ("HERO") and
          longer ("OFF THE CLOCK", "BITS AND PIECES"). */}
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          minWidth: 162,
        }}
      >
        <span
          style={{
            color: "var(--accent)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {active.number}
        </span>
        <span>{active.label}</span>
      </span>
      <span style={{ opacity: 0.25 }}>·</span>
      <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.85 }}>
        {formatClock(now)}
      </span>
      <span style={{ opacity: 0.25 }}>·</span>
      <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.65 }}>
        {String(progressPct).padStart(3, "0")}%
      </span>
      <button
        type="button"
        className="hud-btn"
        onClick={onReset}
        aria-label="Reset room"
        style={iconButtonStyle(false)}
      >
        <RotateCcw size={13} strokeWidth={2} />
      </button>
      <button
        type="button"
        className="hud-btn"
        onClick={audio.toggle}
        aria-label={audio.on ? "Mute ambience" : "Play ambience"}
        aria-pressed={audio.on}
        style={iconButtonStyle(audio.on)}
      >
        {audio.on ? (
          <Volume2 size={13} strokeWidth={2} />
        ) : (
          <VolumeX size={13} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}

function iconButtonStyle(active: boolean): React.CSSProperties {
  return {
    marginLeft: 2,
    width: 28,
    height: 28,
    borderRadius: 999,
    border: "1px solid rgba(26, 23, 20, 0.12)",
    background: active
      ? "rgba(232, 112, 64, 0.14)"
      : "rgba(26, 23, 20, 0.04)",
    color: active ? "var(--accent)" : "var(--wrapper-ink)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    transition: "background 0.18s ease, color 0.18s ease",
  };
}
