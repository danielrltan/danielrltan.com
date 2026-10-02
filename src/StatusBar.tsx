import { lazy, Suspense, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useIsMobile } from "./useIsMobile";
import { SECTION_REGISTRY, findSectionElements } from "./sectionRegistry";
import { SectionDial, type DialHudState } from "./SectionDial";
import { hudTopOffset, useShownAfterPaint } from "./RoomHUD";
import { track } from "./analytics";
import { isScrollLocked } from "./scroll";
import { requestScrollRefresh } from "./portfolio/scrollRefresh";
// NavSpillMenu pulls in three.js + @react-three/drei + gsap. Lazy-load it so
// those deps leave the entry/first-paint bundle; warm the chunk on idle
// (mounted but CLOSED, so NO WebGL context is created until the user actually
// opens the menu) so the first open still animates from the closed state.
const NavSpillMenu = lazy(() =>
  import("./NavSpillMenu").then((m) => ({ default: m.NavSpillMenu })),
);

gsap.registerPlugin(ScrollTrigger);

/**
 * Top-right section indicator: the odometer dial (SectionDial) that opens
 * the spill menu.
 *
 * `visible` (default true, so a plain mount keeps working) drives the shared
 * HUD CHROME entrance. It is designed to be mounted early (at `ready`) with
 * `visible={hudVisible}`: while hidden it tracks the active section silently
 * (no `section_view`, no drum roll), so it appears already on the right face.
 */

/** The active line: a section is current once its top passes 45% of the viewport. */
const ACTIVE_LINE = 0.45;
const ACTIVE_START = `top ${Math.round(ACTIVE_LINE * 100)}%`;

/** Deepest registry index whose start is at or above scroll position `y`. */
function lastIndexWithStartLE(starts: readonly number[], y: number): number {
  let best = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! <= y) best = i;
  }
  return best;
}

/** Quiet time after the last page-height change before the one refresh. Longer
 *  than the near-still opening of an accordion's in-out morph (one row closing
 *  while another opens nets ~0px for the first ~180 ms), so a toggle costs one
 *  refresh, not two. */
const LAYOUT_SETTLE_MS = 250;

/** One-off live measure (mount only): the same 45% rule from element rects. */
function measureActiveNow(): number {
  if (typeof window === "undefined") return 0;
  const line = (window.innerHeight || 1) * ACTIVE_LINE;
  let best = 0;
  findSectionElements().forEach(({ el }, i) => {
    if (el && el.getBoundingClientRect().top <= line) best = i;
  });
  return best;
}

interface Props {
  visible?: boolean;
}

export function StatusBar({ visible = true }: Props) {
  const isMobile = useIsMobile();
  // Seeded synchronously from one live measure, so the dial mounts on the
  // right face instead of rolling 00 → 01 as it appears.
  const [activeIdx, setActiveIdx] = useState(measureActiveNow);
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

  // Active section, EVENT-DRIVEN (motion spec W7.7). ScrollTrigger already
  // measures every trigger once per refresh, pin spacers included, so each
  // registry element gets a callback-free trigger at "top 45%" that exists
  // only to cache its `start` (refreshPriority -10: measured after the section
  // pins). One page-long trigger maps the scroll position onto those cached
  // starts on every ScrollTrigger update. No layout reads during scroll: the
  // old loop read live getBoundingClientRect() on every section for 1.8 s
  // after any scroll, the second-largest source of forced style recalcs in
  // the wheel-scroll trace.
  const lastIdxRef = useRef(activeIdx);
  // While the HUD is hidden (the hero dive, before the 1.0vh reveal) the dial
  // is pre-mounted but nobody sees it, so section changes are NOT committed:
  // no StatusBar render during 0-1.0vh. The skipped index is resolved from the
  // cached starts in the render that flips `visible` (below), so the dial
  // lands on the right face in that same commit, while its hud is still
  // "hidden" and the drum snaps instead of rolling.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const pendingResolveRef = useRef(false);
  const resolveIdxRef = useRef<(() => number) | null>(null);
  if (visible && pendingResolveRef.current && resolveIdxRef.current) {
    pendingResolveRef.current = false;
    const idx = resolveIdxRef.current();
    lastIdxRef.current = idx;
    if (idx !== activeIdx) setActiveIdx(idx);
  }
  useEffect(() => {
    const found = findSectionElements();
    const starts: number[] = found.map(() => Number.POSITIVE_INFINITY);
    const sectionSts = found.map(({ el }) =>
      el
        ? ScrollTrigger.create({
            trigger: el,
            start: ACTIVE_START,
            refreshPriority: -10,
          })
        : null,
    );
    const setActive = (idx: number) => {
      if (!visibleRef.current) {
        if (idx !== lastIdxRef.current) pendingResolveRef.current = true;
        return;
      }
      if (idx === lastIdxRef.current) return;
      lastIdxRef.current = idx;
      setActiveIdx(idx);
    };
    const readStarts = () => {
      sectionSts.forEach((st, i) => {
        starts[i] = st ? st.start : Number.POSITIVE_INFINITY;
      });
    };
    let lastScrollAt = 0;
    const page = ScrollTrigger.create({
      start: 0,
      end: "max",
      refreshPriority: -10,
      onUpdate: (self) => {
        lastScrollAt = performance.now();
        setActive(lastIndexWithStartLE(starts, self.scroll()));
      },
    });

    // Cached starts only move on a ScrollTrigger refresh, and nothing refreshes
    // when the page height changes WITHOUT a resize (an accordion opening on
    // the unpinned/mobile layout, a late section mount): every section below
    // would switch late by the height delta. Watch the sections' container and
    // refresh ONCE after its height settles: debounced past the last callback
    // (an accordion morph fires one per frame), skipped while loading (the
    // loader-lift refresh covers boot), deferred while scroll is locked or
    // moving (menu open, a glide), and only if the height really differs from
    // the one the last refresh measured (scrollbar/width toggles reflow back).
    const container =
      found.find((f) => f.el)?.el?.closest("main") ?? document.body;
    // Border-box height on both sides of the compare (offsetHeight here, the
    // observer's borderBoxSize below), so padding never reads as a change.
    let measuredH = (container as HTMLElement).offsetHeight;
    let observedH = measuredH;
    let settleT = 0;
    const settle = () => {
      settleT = 0;
      if (Math.abs(observedH - measuredH) <= 1) return;
      if (
        document.documentElement.classList.contains("loading-active") ||
        isScrollLocked() ||
        performance.now() - lastScrollAt < LAYOUT_SETTLE_MS
      ) {
        settleT = window.setTimeout(settle, LAYOUT_SETTLE_MS);
        return;
      }
      requestScrollRefresh();
    };
    const ro = new ResizeObserver((entries) => {
      const e = entries[entries.length - 1];
      if (!e) return;
      observedH = e.borderBoxSize?.[0]?.blockSize ?? e.contentRect.height;
      if (Math.abs(observedH - measuredH) <= 1) return;
      if (document.documentElement.classList.contains("loading-active")) return;
      if (settleT) window.clearTimeout(settleT);
      settleT = window.setTimeout(settle, LAYOUT_SETTLE_MS);
    });
    ro.observe(container);

    // A refresh moves the starts while the scroll position may not change
    // (pins resize, loader lift), so re-resolve on every refresh too.
    const onRefresh = () => {
      readStarts();
      setActive(lastIndexWithStartLE(starts, page.scroll()));
      // Layout is clean right after a refresh: one cheap read.
      measuredH = (container as HTMLElement).offsetHeight;
      observedH = measuredH;
    };
    ScrollTrigger.addEventListener("refresh", onRefresh);
    onRefresh();
    resolveIdxRef.current = () => lastIndexWithStartLE(starts, page.scroll());
    return () => {
      resolveIdxRef.current = null;
      ScrollTrigger.removeEventListener("refresh", onRefresh);
      ro.disconnect();
      if (settleT) window.clearTimeout(settleT);
      page.kill();
      sectionSts.forEach((st) => st?.kill());
    };
  }, []);

  // section_view only while the HUD is visible: never for the hero behind a
  // hidden dial. On becoming visible it fires once for the current section.
  const trackedIdxRef = useRef(-1);
  useEffect(() => {
    if (!visible) {
      trackedIdxRef.current = -1;
      return;
    }
    if (trackedIdxRef.current === activeIdx) return;
    trackedIdxRef.current = activeIdx;
    track("section_view", { section: SECTION_REGISTRY[activeIdx]?.label });
  }, [visible, activeIdx]);

  // Global hotkey: "m" or "/" toggles the channel menu. Ignored while
  // typing in a field so it never eats input, and while the HUD is hidden
  // (there is no dial to open it from yet). Esc / outside-click close are
  // owned by NavSpillMenu itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M" && e.key !== "/") return;
      if (!visibleRef.current) return;
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

  // HUD chrome state for the dial. The entrance (hidden → shown) is staggered
  // a --stagger behind the brand tile; stepping back in after the menu closes
  // is not.
  const shown = useShownAfterPaint(visible);
  const hud: DialHudState = !shown ? "hidden" : menuOpen ? "menu" : "shown";
  const hudStateRef = useRef<{ prev: DialHudState; delay: string }>({
    prev: "hidden",
    delay: "0s",
  });
  if (hudStateRef.current.prev !== hud) {
    hudStateRef.current.delay =
      hudStateRef.current.prev === "hidden" ? "var(--stagger)" : "0s";
    hudStateRef.current.prev = hud;
  }

  const active = SECTION_REGISTRY[activeIdx] ?? SECTION_REGISTRY[0]!;
  const cardAria = `Open section menu. Current: ${active.number} ${active.label}`;

  // Safe-area offsets as max(gap, inset + n) at every width (a phone on its
  // side has its notch on the right half the time), same rule as the brand.
  const top = hudTopOffset(isMobile);
  const right = isMobile
    ? "max(14px, env(safe-area-inset-right, 0px) + 8px)"
    : "max(22px, env(safe-area-inset-right, 0px) + 12px)";

  // Skeuomorphic odometer dial: rolls the current section into the aperture as
  // you navigate, and opens the spill menu on click. Steps aside while the menu
  // is open so the close X can take its exact corner (close where you opened).
  return (
    <>
      <SectionDial
        activeIdx={activeIdx}
        menuOpen={menuOpen}
        onToggle={() => toggleMenu("dial")}
        cardAria={cardAria}
        isMobile={isMobile}
        hud={hud}
        hudDelay={hudStateRef.current.delay}
        style={{
          position: "fixed",
          top,
          right,
          zIndex: 40,
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
