import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "./useIsMobile";

/**
 * Top-right section indicator: Offbit numeral + Geist label + a stepped
 * pixel-block scroll meter. Section detection reads live rects so it
 * stays accurate as pinned sections grow their pin spacers. (The
 * faux-mono readout, live clock, and reset/ambience buttons were
 * removed per design; room reset still lives on the keyboard shortcut.
 * The previous circular SVG progress ring was retired with the pixel
 * retrofuturism pass: round chrome fought the blocky type language.)
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
  { number: "04", label: "Play", selector: ".portfolio-other" },
  { number: "05", label: "Bits and pieces", selector: ".portfolio-bp" },
  { number: "06", label: "Contact", selector: ".keypad-section" },
];

// Pixel meter: scroll progress quantised into this many blocks. The
// stepped fill (no tween) is deliberate — steps read as hardware.
const METER_SEGMENTS = 7;
const METER_TRACK = "rgba(13, 14, 16, 0.14)";

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

export function StatusBar() {
  const isMobile = useIsMobile();
  const [activeIdx, setActiveIdx] = useState(0);
  // Scroll progress fills the meter blocks via direct DOM mutation on
  // this ref, so the StatusBar tree never reconciles on a scroll frame.
  const meterRef = useRef<HTMLDivElement>(null);

  // Active section = the deepest one whose top has passed 45% of viewport.
  //
  // We read LIVE getBoundingClientRect() on a rAF-coalesced scroll listener
  // rather than caching IntersectionObserver entry rects. The IO approach
  // cached each section's top from the snapshot taken at a threshold
  // crossing — but the GSAP-pinned sections (Mac / Work / Other) sit
  // `position: fixed` during their pin, so their real top changes (0 while
  // pinned → moving once released) WITHOUT firing new IO crossings. Those
  // stale tops made the pill lag a whole section behind at the pin
  // boundaries. Live rects on the ~7 section elements per scroll frame are
  // cheap and always correct. setState only fires on a genuine index change.
  useEffect(() => {
    const found = findSectionElements();
    let lastIdx = -1;
    let raf = 0;
    let lastInput = 0; // last scroll/resize time
    const measure = () => {
      const vh = window.innerHeight || 1;
      let bestIdx = 0;
      for (let i = 0; i < found.length; i++) {
        const el = found[i]!.el;
        if (!el) continue;
        if (el.getBoundingClientRect().top <= vh * 0.45) bestIdx = i;
      }
      if (bestIdx !== lastIdx) {
        lastIdx = bestIdx;
        setActiveIdx(bestIdx);
      }
    };
    // Keep measuring for ~1.3s after the last scroll/resize. A scroll fires
    // one event, but GSAP's pinned sections (Mac/Work/Other) ease into place
    // over ~1s of SCRUB *without* further scroll events — so a scroll-only
    // listener would read a mid-transition rect and never re-check, leaving
    // the pill one section off when you stop near a pin boundary. Ticking
    // through the settle window keeps it correct, then idles (no per-frame
    // layout cost when nothing's moving).
    const SETTLE_MS = 1800;
    const tick = () => {
      measure();
      if (performance.now() - lastInput < SETTLE_MS) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };
    const onInput = () => {
      lastInput = performance.now();
      if (!raf) raf = requestAnimationFrame(tick);
    };
    measure();
    window.addEventListener("scroll", onInput, { passive: true });
    window.addEventListener("resize", onInput, { passive: true });
    return () => {
      window.removeEventListener("scroll", onInput);
      window.removeEventListener("resize", onInput);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let lastFilled = -1;
    const update = () => {
      const max = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const progress = Math.min(1, Math.max(0, window.scrollY / max));
      // ceil-with-floor: any progress > 0 lights the first block, full
      // scroll lights all of them.
      const filled =
        progress <= 0
          ? 0
          : Math.max(1, Math.round(progress * METER_SEGMENTS));
      if (filled === lastFilled) return;
      lastFilled = filled;
      const el = meterRef.current;
      if (!el) return;
      for (let i = 0; i < el.children.length; i++) {
        (el.children[i] as HTMLElement).style.background =
          i < filled ? "var(--accent)" : METER_TRACK;
      }
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

  // Shared pixel scroll meter: a row of square cells that fill with the
  // accent as the page scrolls. Stepped on purpose (no transition) so it
  // reads as a hardware segment display, matching the OffBit/dot-matrix
  // type language. Fill is mutated directly by the scroll listener
  // (meterRef), no React reconcile per frame.
  const meter = (cellW: number, cellH: number) => (
    <div
      ref={meterRef}
      aria-hidden
      style={{ display: "flex", gap: 2, flex: "0 0 auto" }}
    >
      {Array.from({ length: METER_SEGMENTS }, (_, i) => (
        <span
          key={i}
          style={{ width: cellW, height: cellH, background: METER_TRACK }}
        />
      ))}
    </div>
  );

  // Offbit numeral + Geist label + progress ring. No faux-mono, no live
  // clock. Offbit appears ONLY as the display numeral (a deliberate
  // accent), the label is clean Geist. Anchors top-right.
  if (isMobile) {
    return (
      <div
        data-active-section={active.number}
        style={{
          position: "fixed",
          top: "calc(14px + env(safe-area-inset-top, 0px))",
          right: "calc(14px + env(safe-area-inset-right, 0px))",
          maxWidth: "min(64vw, 240px)",
          zIndex: 40,
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 12px",
          background: "rgba(255, 255, 255, 0.86)",
          backdropFilter: "blur(12px) saturate(125%)",
          WebkitBackdropFilter: "blur(12px) saturate(125%)",
          border: "1px solid var(--ink-hairline)",
          // Square-ish chrome: round-pill radii fought the pixel type.
          borderRadius: 6,
          boxShadow: "0 8px 20px -16px rgba(13, 14, 16, 0.45)",
          color: "var(--ink)",
          userSelect: "none",
        }}
      >
        <span
          style={{
            fontFamily: '"Offbit", monospace',
            fontWeight: 700,
            fontSize: 22,
            lineHeight: 1,
            color: "var(--accent)",
            flex: "0 0 auto",
            // Offbit sits ~13% high in its line box; nudge to optically centre.
            transform: "translateY(3px)",
          }}
        >
          {active.number}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {active.label}
        </span>
        {meter(3, 9)}
      </div>
    );
  }

  return (
    <div
      data-active-section={active.number}
      style={{
        position: "fixed",
        top: 20,
        right: 22,
        zIndex: 40,
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 14px 8px 12px",
        background: "rgba(255, 255, 255, 0.86)",
        backdropFilter: "blur(12px) saturate(125%)",
        WebkitBackdropFilter: "blur(12px) saturate(125%)",
        border: "1px solid var(--ink-hairline)",
        // Square-ish chrome: round-pill radii fought the pixel type.
        borderRadius: 6,
        boxShadow: "0 10px 26px -18px rgba(13, 14, 16, 0.5)",
        color: "var(--ink)",
        userSelect: "none",
      }}
    >
      <span
        style={{
          fontFamily: '"Offbit", monospace',
          fontWeight: 700,
          fontSize: 30,
          lineHeight: 1,
          color: "var(--accent)",
          // Offbit sits ~13% high in its line box, so flex-centering the box
          // leaves the glyph optically high. Nudge down to centre it.
          transform: "translateY(4px)",
        }}
      >
        {active.number}
      </span>
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          lineHeight: 1,
          // Fixed width so the pill doesn't resize between "Work" and
          // "Bits and pieces".
          minWidth: 128,
        }}
      >
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(13, 14, 16, 0.5)",
          }}
        >
          Section
        </span>
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
          }}
        >
          {active.label}
        </span>
      </span>
      {meter(4, 12)}
    </div>
  );
}
