import { useEffect, useState } from "react";
import { useIsMobile } from "./useIsMobile";
import { SECTION_REGISTRY, findSectionElements } from "./sectionRegistry";
import { NavSpillMenu } from "./NavSpillMenu";
import { SectionDial } from "./SectionDial";

/**
 * Top-right section indicator: Offbit numeral + Geist label + a stepped
 * pixel-block scroll meter. Section detection reads live rects so it
 * stays accurate as pinned sections grow their pin spacers. (The
 * faux-mono readout, live clock, and reset/ambience buttons were
 * removed per design; room reset still lives on the keyboard shortcut.
 * The previous circular SVG progress ring was retired with the pixel
 * retrofuturism pass: round chrome fought the blocky type language.)
 */

export function StatusBar() {
  const isMobile = useIsMobile();
  const [activeIdx, setActiveIdx] = useState(0);
  // Nav-menu open state: the resting dial is a button that opens the spill
  // menu to jump between sections.
  const [menuOpen, setMenuOpen] = useState(false);

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

  // Global hotkey: "m" or "/" toggles the channel menu. Ignored while
  // typing in a field so it never eats input. (Esc / outside-click close
  // are owned by CrtChannelMenu itself.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M" && e.key !== "/") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      setMenuOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = SECTION_REGISTRY[activeIdx] ?? SECTION_REGISTRY[0]!;
  const cardAria = `Open section menu. Current: ${active.number} ${active.label}`;

  const top = isMobile ? "calc(14px + env(safe-area-inset-top, 0px))" : 20;
  const right = isMobile ? "calc(14px + env(safe-area-inset-right, 0px))" : 22;

  // Skeuomorphic odometer dial: rolls the current section into the aperture as
  // you navigate, and opens the spill menu on click. Hidden while the menu is
  // open so the close X can take its exact corner (close where you opened).
  return (
    <>
      <SectionDial
        activeIdx={activeIdx}
        menuOpen={menuOpen}
        onToggle={() => setMenuOpen((o) => !o)}
        cardAria={cardAria}
        isMobile={isMobile}
        style={{
          position: "fixed",
          top,
          right,
          zIndex: 40,
          opacity: menuOpen ? 0 : 1,
          pointerEvents: menuOpen ? "none" : "auto",
          transition: "opacity 160ms ease",
        }}
      />
      <NavSpillMenu
        open={menuOpen}
        activeIdx={activeIdx}
        onClose={() => setMenuOpen(false)}
      />
    </>
  );
}
