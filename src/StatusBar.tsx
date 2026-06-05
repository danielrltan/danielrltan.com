import { useEffect, useRef, useState } from "react";
import { RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useAudioToggle } from "./useAudioToggle";
import { useIsMobile } from "./useIsMobile";

interface Props {
  /** Reset the room (snap throwables / draggables back to starting pose). */
  onReset: () => void;
}

/**
 * Top-right status pill: active section, live clock, scroll progress,
 * audio + reset controls. Section detection is IO-based so it stays
 * accurate as pinned sections grow their pin spacers.
 */

interface SectionEntry {
  number: string;
  label: string;
  /** Selector to identify the section in the DOM. */
  selector: string;
}

// Mirrors PortfolioSections.tsx render order; keep in lockstep.
const SECTION_REGISTRY: SectionEntry[] = [
  { number: "00", label: "Hero", selector: ".portfolio-section--hero" },
  { number: "01", label: "About", selector: ".portfolio-section:not([class*='--'])" },
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

function findSectionElements(): Array<{ entry: SectionEntry; el: Element | null }> {
  return SECTION_REGISTRY.map((entry, i) => {
    if (i === 1) {
      // About is the first generic `.portfolio-section` (no special
      // modifier class); selector-based match would clash with the
      // keypad's own class.
      const all = Array.from(document.querySelectorAll(".portfolio-section"));
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
  const isMobile = useIsMobile();
  const [activeIdx, setActiveIdx] = useState(0);
  const [now, setNow] = useState(() => new Date());
  // Progress % is written directly into the span via ref, keeping the
  // StatusBar tree from reconciling on every scroll frame.
  const progressLabelRef = useRef<HTMLSpanElement>(null);
  const audio = useAudioToggle();

  // OLD: the 1s setNow interval ran always, re-rendering the whole StatusBar
  // every second even on mobile where the clock isn't rendered (wasted render
  // per second). NEW: gated behind !isMobile, so mobile has zero clock-driven
  // re-renders; desktop clock behaviour is unchanged.
  useEffect(() => {
    if (isMobile) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [isMobile]);

  // Active section = deepest one whose top has passed 45% of viewport.
  // OLD: every IO callback looped ALL ~7 sections calling live
  // getBoundingClientRect() (forced synchronous layout per crossing), built
  // an unread visibleRatios Map, and called setActiveIdx unconditionally
  // (re-render on every threshold crossing even when the index was unchanged).
  // NEW: read entry.boundingClientRect.top straight off the IO entries (no
  // forced layout), cache per-target tops across calls, and setState only
  // when the derived index changes (ref-guarded) — re-render solely on a
  // genuine active-section change.
  useEffect(() => {
    const found = findSectionElements();
    // Latest observed top per target; IO only reports targets that changed,
    // so we persist the rest from prior callbacks.
    const tops = new Map<Element, number>();
    let lastActiveIdx = -1;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          tops.set(entry.target, entry.boundingClientRect.top);
        }
        const vh = window.innerHeight || 1;
        let bestIdx = 0;
        for (let i = 0; i < found.length; i++) {
          const el = found[i]!.el;
          if (!el) continue;
          const top = tops.get(el);
          if (top === undefined) continue;
          if (top <= vh * 0.45) bestIdx = i;
        }
        if (bestIdx !== lastActiveIdx) {
          lastActiveIdx = bestIdx;
          setActiveIdx(bestIdx);
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const f of found) {
      if (f.el) io.observe(f.el);
    }
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    let raf = 0;
    let lastPct = -1;
    const update = () => {
      const max = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const pct = Math.round((window.scrollY / max) * 100);
      if (pct === lastPct) return;
      lastPct = pct;
      const el = progressLabelRef.current;
      if (el) el.textContent = String(pct).padStart(3, "0") + "%";
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

  // Mobile: compact info pill with section number + label + scroll %, and
  // the live clock and the reset/mute buttons dropped. Those controls
  // live in RoomHUD's labeled bottom-left pills on mobile (single source
  // of truth, no duplicate top-right buttons crowding the notch). The
  // pill anchors top-right with safe-area insets and a smaller min-width
  // so it never overflows a 360px viewport or collides with the cat mark.
  if (isMobile) {
    return (
      <div
        style={{
          position: "fixed",
          top: "calc(14px + env(safe-area-inset-top, 0px))",
          right: "calc(14px + env(safe-area-inset-right, 0px))",
          // Cap width so a long label ("Bits and pieces") wraps/ellipsizes
          // rather than pushing the pill off-screen or into the cat mark.
          maxWidth: "min(62vw, 240px)",
          zIndex: 40,
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 14px",
          background: "rgba(238, 240, 243, 0.82)",
          backdropFilter: "blur(10px) saturate(120%)",
          WebkitBackdropFilter: "blur(10px) saturate(120%)",
          border: "1px solid var(--ink-hairline)",
          borderRadius: 999,
          boxShadow:
            "0 1px 0 rgba(255, 255, 255, 0.5) inset, 0 8px 24px -16px rgba(13, 14, 16, 0.25)",
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--ink)",
          fontWeight: 600,
          userSelect: "none",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: "var(--accent)",
              fontVariantNumeric: "tabular-nums",
              flex: "0 0 auto",
            }}
          >
            {active.number}
          </span>
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {active.label}
          </span>
        </span>
        <span style={{ opacity: 0.25, flex: "0 0 auto" }}>·</span>
        <span
          ref={progressLabelRef}
          style={{
            fontVariantNumeric: "tabular-nums",
            opacity: 0.65,
            flex: "0 0 auto",
          }}
        >
          000%
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        // Shares baseline with the brand cat chip in RoomHUD and the
        // hero eyebrow so all top-row chrome reads as one editorial
        // top-bar (TOP_STRIP_TOP = 20, ~40px tall).
        top: 20,
        right: 22,
        zIndex: 40,
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        padding: "6px 6px 6px 16px",
        background: "rgba(238, 240, 243, 0.82)",
        backdropFilter: "blur(10px) saturate(120%)",
        WebkitBackdropFilter: "blur(10px) saturate(120%)",
        border: "1px solid var(--ink-hairline)",
        borderRadius: 999,
        boxShadow:
          "0 1px 0 rgba(255, 255, 255, 0.5) inset, 0 8px 24px -16px rgba(13, 14, 16, 0.25)",
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--ink)",
        fontWeight: 600,
        userSelect: "none",
      }}
    >
      {/* Fixed min-width so the pill doesn't visibly resize between
          "HERO" and "BITS AND PIECES". */}
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
      <span
        ref={progressLabelRef}
        style={{ fontVariantNumeric: "tabular-nums", opacity: 0.65 }}
      >
        000%
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
    border: "1px solid var(--ink-hairline)",
    background: active
      ? "var(--accent-tint)"
      : "rgba(13, 14, 16, 0.04)",
    color: active ? "var(--accent)" : "var(--ink)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    padding: 0,
    transition: "background 0.18s ease, color 0.18s ease",
  };
}
