import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useIsMobile } from "./useIsMobile";
import { SECTION_REGISTRY, findSectionElements } from "./sectionRegistry";
import { SectionDial } from "./SectionDial";
import { track } from "./analytics";
// NavSpillMenu pulls in three.js + @react-three/drei + gsap. Lazy-load it so
// those deps leave the entry/first-paint bundle; warm the chunk on idle
// (mounted but CLOSED, so NO WebGL context is created until the user actually
// opens the menu) so the first open still animates from the closed state.
const NavSpillMenu = lazy(() =>
  import("./NavSpillMenu").then((m) => ({ default: m.NavSpillMenu })),
);

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
  // Defer the NavSpillMenu chunk (three/drei/gsap) off the entry bundle. Warm
  // it on idle so it's mounted-but-closed (no WebGL context until opened) and
  // the first open animates from the closed state.
  const [navMounted, setNavMounted] = useState(false);
  useEffect(() => {
    if (navMounted) return;
    const warm = () => setNavMounted(true);
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(warm);
      return () => w.cancelIdleCallback?.(id);
    }
    const tm = window.setTimeout(warm, 1500);
    return () => window.clearTimeout(tm);
  }, [navMounted]);
  // If the user opens the menu before the idle warm fires, mount it now.
  useEffect(() => {
    if (menuOpen) setNavMounted(true);
  }, [menuOpen]);

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
        track("section_view", { section: SECTION_REGISTRY[bestIdx]?.label });
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
      menuViaRef.current = "hotkey";
      setMenuOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Log menu open/close exactly once per real state change. Tracking lives in an
  // effect (not inside the setState updater — that double-fires under StrictMode
  // and is an impure updater). `menuViaRef` records how the last toggle fired.
  const menuViaRef = useRef("dial");
  const menuFirstRef = useRef(true);
  useEffect(() => {
    if (menuFirstRef.current) {
      menuFirstRef.current = false;
      return;
    }
    track(menuOpen ? "nav_open" : "nav_close", { via: menuViaRef.current });
  }, [menuOpen]);
  const toggleMenu = (via: string) => {
    menuViaRef.current = via;
    setMenuOpen((o) => !o);
  };

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
        onToggle={() => toggleMenu("dial")}
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
      {navMounted && (
        <Suspense fallback={null}>
          <NavSpillMenu
            open={menuOpen}
            activeIdx={activeIdx}
            onClose={() => {
              menuViaRef.current = "menu";
              setMenuOpen(false);
            }}
            onJump={(label) => track("nav_jump", { section: label, source: "menu" })}
          />
        </Suspense>
      )}
    </>
  );
}
