import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { MoveableCursor } from "./MoveableCursor";
import { PanCursor } from "./PanCursor";
import { JumpToTop } from "./JumpToTop";
import { RoomHUD } from "./RoomHUD";
import { track } from "./analytics";
// Dev-only signature capture tool (reachable only via ?sign=1). Lazy so its
// code never ships in the main bundle for normal visitors.
const SignatureCapture = lazy(() =>
  import("./SignatureCapture").then((m) => ({ default: m.SignatureCapture })),
);
import { AssemblyProvider } from "./loading";
import { BootLoader } from "./loading/BootLoader";
import { HeroSignature } from "./hero/HeroSignature";
import { PortfolioSections } from "./portfolio/PortfolioSections";
import { scrollToSection } from "./portfolio/Keypad";
import { useIsMobile } from "./useIsMobile";
import { StatusBar } from "./StatusBar";

/*
 * The live R3F room (a 27 MB GLB rendered every frame) was replaced by a single
 * static render of the room (public/render.png) — far cheaper, and the room was
 * only ever a static backdrop during the hero→About beat anyway. All the 3D
 * room machinery (Room, GroundPlane, ScrollCamera, IntroController, the
 * ScrollWireframeRoom assembly, OrbitControls, the room frameloop gate, the
 * fake contact shadow) was deleted. The render fades in where the 3D room used
 * to appear and out into the Projects section, driven by the same
 * --canvas-opacity scroll choreography.
 */

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// Hero wrapper opacity is a TIME-BASED one-shot fade, NOT a scroll-position ramp.
// The composition is held FULL through the pixel-zoom (so the zoom is SEEN), then
// dissolves once About has fully arrived.
//
// Why time-based and not a scroll-linked window: a scroll-POSITION ramp means any
// scroll range where the opacity is partial is a range you can REST in — and since
// the hero sits over a fully-risen About there, you see it ghosted/garbled over the
// section (the "fadeaway bleeds too much into About, can't see things at first"
// bug). But collapsing that window to a near-cut to kill the bleed removed the
// transition entirely — the hero just SNAPPED away after the zoom.
//
// The fix is a binary TARGET (hero fully SHOWN below the hide threshold, fully
// HIDDEN above it) that tick() eases toward over ~330ms. Crossing About's arrival
// therefore fades the hero out over a fixed ~330ms that COMPLETES on its own no
// matter where you stop scrolling — so there's no partial state to rest in (no
// bleed) AND it's a smooth dissolve after the zoom (no snap). Scroll back up past
// the show threshold fades it back in the same way. Hysteresis (hide at 1.0vh =
// About's top at the viewport top, since the hero spacer is 100vh; show again only
// below 0.96vh) stops it flickering if you jitter right at the boundary.
const HERO_HIDE_VH = 1.0;
const HERO_SHOW_VH = 0.96;
const HERO_FADE_RATE = 9; // exp ease rate → ~330ms dissolve, independent of scroll speed
// Pixel-zoom dive window: the composition scales up + steps through the SVG
// mosaic from 0.30vh → 0.75vh. Compressed (was 1.00vh) because the next section
// covers on RAW scroll while this dive is rAF-EASED (it lags); at 1.00vh the
// deep-pixelation climax (+ chromatic tick) landed only after the section had
// already risen over it. Finishing by 0.75vh lands the climax while the hero is
// still on top.
const HERO_DISSOLVE_START_VH = 0.3;
const HERO_DISSOLVE_END_VH = 0.75;
// The static room RENDER occupies the beat the live 3D room used to: it rises
// as the hero dissolves (no blank gap where the wireframe build used to sit) and
// holds through About, then fades out into the Projects/Mac section.
const RENDER_FADE_IN_START_VH = 0.95;
const RENDER_FADE_IN_END_VH = 1.55;
const RENDER_FADE_OUT_START_VH = 2.8;
const RENDER_FADE_OUT_END_VH = 2.95;
// Content opacity ramp window (page scroll fraction).
const CONTENT_FADE_START = 0.07;
const CONTENT_FADE_END = 0.105;

// Rate-limit for the scroll-driven reveal signals so a fast flick can't
// teleport the hero dissolve / render fade straight to their end state. Each
// eased signal chases its raw target at this fixed exponential rate (~400ms to
// settle, matching GSAP `scrub: 1`). Thresholds/windows/sequence are untouched.
const PROGRESS_EASE_RATE = 2.5;
// The render FADE-OUT (handing off to the Projects section) eases at a STEEPER
// rate than the shared reveal rate, with a snap-to-zero floor, so it leaves
// cleanly instead of lingering as a faint dissolving ghost over the section.
const RENDER_FADE_OUT_RATE = 6;
const RENDER_FADE_OUT_SNAP = 0.015;
// Clamp per-frame dt so a long idle / tab-switch doesn't produce one giant
// catch-up jump on the next tick.
const MAX_TICK_DT = 0.05;
// Stepped pixelation buckets for the hero dive (SVG mosaic #hero-px-1..5).
// Front-loaded (was [0.08, 0.26, 0.44, 0.62, 0.8]) so the chunky #hero-px-3/4/5
// mosaic lands while the hero is still opaque and uncovered, not at the very end
// when the next section has already risen over it.
const HERO_PX_STEPS = [0.05, 0.18, 0.34, 0.52, 0.72];

// ── Hero → About "settle to the top" ─────────────────────────────────────────
// The bug this fixes: the pixel-zoom dive + the opacity fade are driven by
// CONTINUED downward scroll, so scroll momentum carries you PAST About's header
// before the fade resolves — you can't tune your way out of it because the cause
// is scroll-POSITION coupling, not fade timing. The fix arrests the scroll
// exactly at About's top when you decelerate while leaving the hero, so the
// transition resolves IN PLACE there instead of racing past the header.
//
// About's flow-top == ONE viewport (Hero.tsx is a bare 100vh spacer), so the
// landing target is simply window.innerHeight — no layout measurement. The
// settle routes through the existing Lenis-synced scrollToSection() (Keypad.tsx)
// so it can't be lerped back and stays in sync with GSAP ScrollTrigger / the
// downstream pins. The dive (--hero-to-about) and fade (--hero-opacity) math are
// left completely untouched: once Lenis parks scrollY at 1.0vh, ratio stops
// climbing and the existing time-based fade completes where it sits.
//
// It is a ONE-SHOT, fired only on scroll-end (debounced) while DESCENDING inside
// a commit band, re-armed only after you clearly leave that band. No scroll-lock
// — Lenis cancels a non-locked tween on any fresh wheel/touch, so a deliberate
// read-scroll always wins (it never jails you). Reduced-motion jumps instantly.
const HERO_SETTLE_BAND_LO = 0.55; // fire only once the dive is well underway
const HERO_SETTLE_BAND_HI = 1.1; // ...and before About's header has scrolled off
const HERO_SETTLE_DURATION = 0.5; // desktop Lenis tween, seconds
const HERO_SETTLE_IDLE_MS = 90; // scroll-quiesced debounce == "scroll ended"
// Mobile: Lenis runs syncTouch:false (native momentum), so a tween can't arrest
// an active fling — only nudge AFTER the fling ends, and only a small near-miss,
// never a big yank.
const HERO_SETTLE_MOBILE_LO = 0.84;
const HERO_SETTLE_MOBILE_HI = 1.1;
const HERO_SETTLE_MOBILE_DURATION = 0.35;
const HERO_SETTLE_MOBILE_IDLE_MS = 130;
// Re-arm the one-shot only after clearly leaving the band (back above the hero,
// or committed down into About's body) so it never re-fires mid-band.
const HERO_SETTLE_REARM_LO = 0.4;
const HERO_SETTLE_REARM_HI = 1.3;

/**
 * Installs the hero→About settle. SEPARATE from installScrollChoreography's rAF
 * loop (that loop must stay a pure per-frame reader/writer of scroll-derived CSS
 * vars); this is an event-driven, debounced one-shot that only ever issues a
 * single scrollTo. Idempotent install is the caller's responsibility.
 */
function installHeroSettle(): void {
  if (typeof window === "undefined") return;

  let vh = window.innerHeight || 1;
  const mobileQuery = window.matchMedia("(max-width: 768px)");
  const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  let lastY = window.scrollY;
  let lastDir = 1; // 1 = descending, -1 = ascending
  // Seed the one-shot from the load position: a refresh-at-offset already inside
  // the band must NOT fire a surprise snap on the user's first scroll.
  let settledOnce = window.scrollY / vh >= HERO_SETTLE_BAND_LO;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const settle = () => {
    if (settledOnce || lastDir < 0) return; // one-shot spent, or ascending
    const ratio = window.scrollY / vh;
    const mobile = mobileQuery.matches;
    const lo = mobile ? HERO_SETTLE_MOBILE_LO : HERO_SETTLE_BAND_LO;
    const hi = mobile ? HERO_SETTLE_MOBILE_HI : HERO_SETTLE_BAND_HI;
    if (ratio < lo || ratio > hi) return; // outside the commit band
    settledOnce = true; // latch regardless of whether we actually move
    if (Math.abs(window.scrollY - vh) <= 2) return; // already at About-top
    if (reduceQuery.matches) {
      scrollToSection(vh, { immediate: true });
    } else {
      scrollToSection(vh, {
        duration: mobile ? HERO_SETTLE_MOBILE_DURATION : HERO_SETTLE_DURATION,
      });
    }
  };

  const onScroll = () => {
    const y = window.scrollY;
    if (y !== lastY) lastDir = y > lastY ? 1 : -1;
    lastY = y;
    const ratio = y / vh;
    if (ratio < HERO_SETTLE_REARM_LO || ratio > HERO_SETTLE_REARM_HI) {
      settledOnce = false; // re-arm only once clearly out of the band
    }
    // Fire on scroll-END: each event resets the idle timer; it only resolves
    // once the wheel/Lenis ease (or a touch fling) has quiesced.
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(
      settle,
      mobileQuery.matches ? HERO_SETTLE_MOBILE_IDLE_MS : HERO_SETTLE_IDLE_MS,
    );
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener(
    "resize",
    () => {
      vh = window.innerHeight || 1;
    },
    { passive: true },
  );
}

/**
 * Single continuous rAF loop. Each frame it recomputes the raw scroll-derived
 * targets and eases the reveal signals toward them at a fixed rate so a fast
 * flick can't teleport through the reveals — only the SPEED is capped. Writes
 * all derived fade/progress values to CSS variables on documentElement; DOM
 * layers bind opacity to `var(--*-opacity)`, so App never re-renders on scroll.
 */
function installScrollChoreography(): void {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  const isMobileQuery = window.matchMedia("(max-width: 768px)");

  // PERF: cache layout reads (scrollHeight/innerHeight) — they change on
  // resize/content-mount, NOT on scroll. Reading scrollHeight every frame forces
  // a synchronous reflow, costly with the scaled + SVG-filtered hero subtree.
  let vhCache = window.innerHeight || 1;
  let scrollMax = Math.max(1, root.scrollHeight - vhCache);
  const recomputeLayout = () => {
    vhCache = window.innerHeight || 1;
    scrollMax = Math.max(1, root.scrollHeight - vhCache);
  };

  // PERF: write a CSS custom property only when its value actually changed, so we
  // don't invalidate style on the scaled + filtered hero subtree every frame.
  const lastVar: Record<string, string> = {};
  const setVar = (k: string, v: string) => {
    if (lastVar[k] === v) return;
    lastVar[k] = v;
    root.style.setProperty(k, v);
  };

  // HI-DPR / browser-zoom escape hatch: the hero's SVG feMorphology filters
  // software-rasterize at DEVICE pixels (cost ~DPR²), so zoom + scroll tanks weak
  // GPUs. data-hero-lite drops those url() filters (CSS keeps the cheap stepped
  // contrast + the scale, so the pixel-zoom dive still reads). Browser zoom fires
  // a resize, so we re-check devicePixelRatio there.
  // Latched once frames run slow during scroll (adaptive degrade — see loop()).
  let perfLocked = false;
  let slowFrames = 0;
  const updateHeroLite = () => {
    if (perfLocked || (window.devicePixelRatio || 1) > 1.4)
      root.setAttribute("data-hero-lite", "");
    else root.removeAttribute("data-hero-lite");
  };
  updateHeroLite();
  let lastDiving = false;
  // Hero shown/hidden LATCH (hysteresis) driving the time-based opacity fade.
  // Seeded from the current scroll so a refresh-at-offset past the hero starts
  // hidden (no fade-in flash on load). computeTargets() flips it across the
  // hide/show thresholds; tick() eases the real opacity toward heroShown?1:0.
  let heroShown = window.scrollY / vhCache < HERO_HIDE_VH;

  type Targets = {
    heroOpacity: number;
    heroToAbout: number;
    renderOpacity: number;
    contentOpacity: number;
    isMobile: boolean;
  };

  const computeTargets = (): Targets => {
    const vh = vhCache;
    const ratio = window.scrollY / vh;
    const scrollProgress = clamp01(window.scrollY / scrollMax);

    // BINARY opacity target with hysteresis: fade OUT once About has fully arrived
    // (ratio >= hide), fade back IN only after scrolling back up past the lower
    // show threshold. tick() eases toward this over ~330ms, so the fade is a
    // time-based dissolve that always completes — never a rest-able partial state
    // (no bleed) and never a scroll-linked snap.
    if (heroShown && ratio >= HERO_HIDE_VH) heroShown = false;
    else if (!heroShown && ratio < HERO_SHOW_VH) heroShown = true;
    const heroOpacity = heroShown ? 1 : 0;

    const heroToAbout = clamp01(
      (ratio - HERO_DISSOLVE_START_VH) /
        (HERO_DISSOLVE_END_VH - HERO_DISSOLVE_START_VH),
    );

    const fadeIn = clamp01(
      (ratio - RENDER_FADE_IN_START_VH) /
        (RENDER_FADE_IN_END_VH - RENDER_FADE_IN_START_VH),
    );
    const fadeOut = clamp01(
      (ratio - RENDER_FADE_OUT_START_VH) /
        (RENDER_FADE_OUT_END_VH - RENDER_FADE_OUT_START_VH),
    );
    const renderOpacity = fadeIn * (1 - fadeOut);

    const contentOpacity = clamp01(
      (scrollProgress - CONTENT_FADE_START) /
        (CONTENT_FADE_END - CONTENT_FADE_START),
    );

    const isMobile = isMobileQuery.matches;
    return { heroOpacity, heroToAbout, renderOpacity, contentOpacity, isMobile };
  };

  // Seed from the first target so there's no ease-in flash on load / refresh-at-offset.
  const seed = computeTargets();
  const prevEased = {
    heroOpacity: seed.heroOpacity,
    heroToAbout: seed.heroToAbout,
    renderOpacity: seed.renderOpacity,
    contentOpacity: seed.contentOpacity,
  };

  const ease = (prev: number, target: number, dt: number) =>
    prev + (target - prev) * (1 - Math.exp(-dt * PROGRESS_EASE_RATE));

  let lastHeroPx = -1;
  const applyHeroPx = (p: number) => {
    let bucket = 0;
    for (let i = 0; i < HERO_PX_STEPS.length; i++) {
      if (p > HERO_PX_STEPS[i]!) bucket = i + 1;
    }
    if (bucket === lastHeroPx) return;
    lastHeroPx = bucket;
    if (bucket === 0) root.removeAttribute("data-hero-px");
    else root.setAttribute("data-hero-px", String(bucket));
  };

  let convergenceDelta = 1;

  const tick = (dt: number) => {
    const t = computeTargets();

    // Hero opacity: ease toward the BINARY target (1 shown / 0 hidden) at a fixed
    // rate so crossing About's arrival plays a ~330ms time-based dissolve that
    // completes on its own — a smooth fade after the zoom, with no scroll range to
    // rest in half-faded (no bleed). Snap to the endpoints so it fully clears
    // (pointer-events + no lingering 0.004 ghost) and fully arrives.
    let heroOpacity =
      prevEased.heroOpacity +
      (t.heroOpacity - prevEased.heroOpacity) *
        (1 - Math.exp(-dt * HERO_FADE_RATE));
    if (t.heroOpacity === 0 && heroOpacity < 0.01) heroOpacity = 0;
    else if (t.heroOpacity === 1 && heroOpacity > 0.99) heroOpacity = 1;
    const heroToAbout = ease(prevEased.heroToAbout, t.heroToAbout, dt);
    // Render fade: gentle shared rate IN (anti-teleport on reveal), steeper rate
    // + snap-to-zero OUT so the render doesn't ghost over the Projects section.
    const falling = t.renderOpacity < prevEased.renderOpacity;
    let renderOpacity =
      prevEased.renderOpacity +
      (t.renderOpacity - prevEased.renderOpacity) *
        (1 -
          Math.exp(
            -dt * (falling ? RENDER_FADE_OUT_RATE : PROGRESS_EASE_RATE),
          ));
    if (t.renderOpacity === 0 && renderOpacity < RENDER_FADE_OUT_SNAP) {
      renderOpacity = 0;
    }
    const contentOpacity = ease(prevEased.contentOpacity, t.contentOpacity, dt);

    prevEased.heroOpacity = heroOpacity;
    prevEased.heroToAbout = heroToAbout;
    prevEased.renderOpacity = renderOpacity;
    prevEased.contentOpacity = contentOpacity;

    setVar("--hero-opacity", heroOpacity.toFixed(3));
    setVar("--hero-to-about", heroToAbout.toFixed(3));
    // Stop the (z-11, near-full-viewport) hero wordmark from swallowing clicks
    // the INSTANT the dive begins — NOT when its opacity fade finishes. The
    // opacity fade runs late (HERO_FADE_START/END 0.92→1.12vh) while the About
    // pin already sits under it at ratio ~1.0, so a fade-gated value left the
    // still-semi-visible wordmark stealing clicks from the top ~100px of About
    // (its upper Reach links were dead). heroToAbout>0.004 latches through the
    // rest of the page (it saturates at 1 past the hero), which is exactly what
    // we want here: once you've started diving, the hero is never the intended
    // click target again.
    setVar(
      "--hero-pointer-events",
      heroToAbout > 0.004 || heroOpacity < 0.05 ? "none" : "auto",
    );
    applyHeroPx(heroToAbout);
    // ⚠️ LATCH SEMANTICS — read before adding a consumer of data-hero-diving /
    // data-hero-px / data-hero-lite. heroToAbout = clamp01((ratio-0.3)/0.45)
    // SATURATES at 1 for the WHOLE page below ~0.75vh and only clears if you
    // scroll back to the very top. So data-hero-diving is effectively "on for the
    // rest of the page after the hero," NOT a momentary "currently diving" pulse
    // (data-hero-px latches at "5", data-hero-lite latches permanently). Every
    // current consumer WANTS that (drop the hero's own keyline/filter/pointer
    // events for good once you've left it) — but a consumer that reads these
    // expecting "only during the brief dive" will silently disable its feature
    // for the rest of the page (this already bit MoveableCursor's spark). If you
    // ever need a true dive-only signal, derive it under a NEW attribute as
    // `heroToAbout > 0.004 && heroToAbout < 0.999` so the two can't be confused.
    // Drop the wordmark keyline filter the instant the dive begins (any DPR) — it
    // re-rasterizes every scroll frame and is imperceptible mid-dive.
    const diving = heroToAbout > 0.004;
    if (diving !== lastDiving) {
      lastDiving = diving;
      if (diving) root.setAttribute("data-hero-diving", "");
      else root.removeAttribute("data-hero-diving");
    }
    // The render image rides --canvas-opacity (the same var the room canvas
    // used). It's purely decorative, so it never receives pointer events.
    setVar("--canvas-opacity", renderOpacity.toFixed(3));
    setVar("--canvas-pointer-events", "none");
    setVar("--content-opacity", t.isMobile ? "1" : contentOpacity.toFixed(3));

    convergenceDelta = Math.max(
      Math.abs(t.heroOpacity - heroOpacity),
      Math.abs(t.heroToAbout - heroToAbout),
      Math.abs(t.renderOpacity - renderOpacity),
      Math.abs(t.contentOpacity - contentOpacity),
    );
  };

  // Seed CSS vars from the initial target with dt large enough to land on it.
  tick(MAX_TICK_DT);

  // Drive tick() from a rAF loop that EASES toward the target, then SLEEPS once
  // settled AND no scroll/resize happened recently (so we don't read layout
  // every frame for the page lifetime). A passive scroll/resize listener wakes
  // it; it keeps ticking for SETTLE_MS after the last input AND until converged.
  const SETTLE_MS = 650;
  const CONVERGE_EPS = 0.0004;
  let lastTs = performance.now();
  let lastInput = lastTs;
  let running = false;

  const loop = (ts: number) => {
    const rawDt = (ts - lastTs) / 1000;
    const dt = Math.min(MAX_TICK_DT, rawDt);
    lastTs = ts;
    tick(dt);
    // Adaptive degrade: if frames run consistently slow (>~18fps) during active
    // scroll, latch the lite path (drop the expensive SVG dive filters) for the
    // rest of the session — fixes weak laptops at any DPR, not just zoom.
    if (!perfLocked && performance.now() - lastInput < SETTLE_MS) {
      if (rawDt > 0.055) {
        if (++slowFrames >= 8) {
          perfLocked = true;
          root.setAttribute("data-hero-lite", "");
        }
      } else if (slowFrames > 0) {
        slowFrames--;
      }
    }
    if (
      performance.now() - lastInput < SETTLE_MS ||
      convergenceDelta > CONVERGE_EPS
    ) {
      requestAnimationFrame(loop);
    } else {
      running = false;
    }
  };
  const wake = () => {
    lastInput = performance.now();
    if (!running) {
      running = true;
      lastTs = performance.now();
      requestAnimationFrame(loop);
    }
  };
  const onResize = () => {
    recomputeLayout();
    updateHeroLite();
    wake();
  };
  window.addEventListener("scroll", wake, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  // Page-height changes (content mount, loader lift, font swap) refresh the
  // cached scrollMax without per-frame scrollHeight reads.
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => recomputeLayout()).observe(document.body);
  }
}

export default function App() {
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("sign") === "1"
  ) {
    return (
      <Suspense fallback={null}>
        <SignatureCapture />
      </Suspense>
    );
  }

  // `ready` flips once the loading screen lifts (html.loading-active removed).
  // It gates the custom cursor, the HUD reveal, and the idle warm-up so none
  // appear over the loader.
  const [ready, setReady] = useState(false);
  // The HUD (dial + jump-to-top) reveals once ready AND the user has scrolled
  // past the hero, so it never clutters the opening signature.
  const [hudVisible, setHudVisible] = useState(false);
  const [moveableHover, setMoveableHover] = useState(false);
  const isMobile = useIsMobile();

  const choreoInstalled = useRef(false);
  if (!choreoInstalled.current) {
    choreoInstalled.current = true;
    installScrollChoreography();
    // Arrest the scroll at About's top when you decelerate leaving the hero, so
    // the pixel-zoom fade resolves in place instead of momentum sailing past the
    // header (see installHeroSettle). Separate from the rAF choreography above.
    installHeroSettle();
  }

  // Lenis smooth scroll is owned by src/portfolio/Keypad.tsx via a module-scope
  // singleton (initializing a second here would have two engines fighting).

  // Mark ready when the loading screen lifts. (loading-active is owned by
  // AssemblyProvider — see useAssemblyProgress; many sections also key
  // ScrollTrigger.refresh off its removal.)
  useEffect(() => {
    const html = document.documentElement;
    if (!html.classList.contains("loading-active")) {
      setReady(true);
      return;
    }
    const obs = new MutationObserver(() => {
      if (!html.classList.contains("loading-active")) {
        setReady(true);
        obs.disconnect();
      }
    });
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // Reveal the HUD once ready and the user scrolls past ~0.75vh (off the hero).
  useEffect(() => {
    if (!ready || hudVisible) return;
    const check = () => {
      const vhRatio = window.scrollY / Math.max(1, window.innerHeight);
      if (vhRatio >= 0.75) {
        setHudVisible(true);
        track("room_entered");
      }
    };
    const onScroll = () => requestAnimationFrame(check);
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [ready, hudVisible]);

  /* Keypad canvas dispatches `keypad-cursor-hover`; mirror it into shared
   * moveableHover state (drives the custom cursor's hot ring). */
  useEffect(() => {
    const onKeypadHover = (e: Event) => {
      const ev = e as CustomEvent<{ hot: boolean }>;
      setMoveableHover(!!ev.detail?.hot);
    };
    // DECOUPLING / teardown contract: the keypad emits hot:true on R3F
    // pointerOver and hot:false on pointerOut — but R3F fires NO pointerOut when
    // the keypad CANVAS UNMOUNTS (mount-on-approach tears it down as it scrolls
    // out of view). So a hover that ends by scrolling away would latch the spark
    // cursor ON for the rest of the page. Self-correct: any scroll or window
    // blur clears the mirror. setMoveableHover(false) is a no-op re-render when
    // already false (React bails on an equal value), and a genuine cap hover
    // re-emits hot:true on the next pointer move.
    const clearHot = () => setMoveableHover(false);
    window.addEventListener("keypad-cursor-hover", onKeypadHover);
    window.addEventListener("scroll", clearHot, { passive: true });
    window.addEventListener("blur", clearHot);
    return () => {
      window.removeEventListener("keypad-cursor-hover", onKeypadHover);
      window.removeEventListener("scroll", clearHot);
      window.removeEventListener("blur", clearHot);
    };
  }, []);

  /* Disable the browser context menu site-wide (no right-click). */
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  /* Keep hover alive WHILE SCROLLING. The browser only re-fires pointer events
   * (and JS hover detection — R3F raycasts, etc.) on real pointer MOVEMENT, so
   * while the page scrolled under a stationary mouse, hover effects froze until
   * you stopped (user-flagged). On each scroll frame we re-dispatch a
   * pointermove at the LAST pointer position on whatever element is now under it,
   * so R3F + JS pointer handlers re-evaluate against the content that scrolled
   * beneath the cursor. Same coords => no parallax/cursor jump, and a pointermove
   * never triggers scroll, so there's no loop. (The custom cursor re-hit-tests
   * its spark per frame on its own; see MoveableCursor.) rAF-throttled. */
  useEffect(() => {
    let lastX = -1;
    let lastY = -1;
    let queued = false;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const fire = () => {
      queued = false;
      if (lastX < 0) return;
      // PERF: skip while the hero is on screen — its ring/wordmark hover effects
      // are decorative, and a per-scroll-frame elementFromPoint + bubbling
      // pointermove fan-out (re-firing the ring + wordmark handlers, each with
      // their own layout reads) is real cost on the exact laggy frames. Only
      // re-hit-test hover for the sections BELOW the hero.
      if (window.scrollY < (window.innerHeight || 1) * 1.1) return;
      const el = document.elementFromPoint(lastX, lastY);
      if (!el) return;
      el.dispatchEvent(
        new PointerEvent("pointermove", {
          clientX: lastX,
          clientY: lastY,
          bubbles: true,
          cancelable: true,
          pointerType: "mouse",
        }),
      );
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      raf = requestAnimationFrame(fire);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  /* Warm the lazy section-scene chunks (Macintosh / Hobbies / Keypad) during
   * idle time once the loader is done, so they're cached before the user
   * scrolls to them. (Gated on `ready` so these loads don't keep drei's
   * useProgress active during the loading screen.) */
  useEffect(() => {
    if (!ready) return;
    const warm = () => {
      void import("./macintosh/MacintoshScene");
      void import("./other/HobbiesScene");
      void import("./keypad/KeypadScene");
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      // timeout GUARANTEES warm() runs within 1.2s even if the main thread stays
      // busy. Without it, requestIdleCallback can be starved indefinitely, so the
      // hobbies GLB preload (kicked off when its module first imports) starts late
      // and the section blanks/pops while still loading on arrival (user-flagged).
      const id = w.requestIdleCallback(warm, { timeout: 1200 });
      return () => w.cancelIdleCallback?.(id);
    }
    const tm = setTimeout(warm, 600);
    return () => clearTimeout(tm);
  }, [ready]);

  return (
    <AssemblyProvider>
      <div
        className="app-wrapper"
        style={{
          position: "relative",
          minHeight: "100vh",
          cursor: "none",
        }}
        onPointerLeave={() => setMoveableHover(false)}
      >
        {/* Stylized loading overlay: pixel meter + VT323 readout on the orange
            field. Runs 0→100 / READY, lifts, then unmounts (at loaderDone) so
            the hero signature draws onto the bare orange scrim beneath. */}
        <BootLoader />

        {/* Hero signature: fixed full viewport, between the render layer (z 0)
            and the HUD. Opacity driven by --hero-opacity from the scroll
            choreography (no CSS transition — it's already eased per-frame). */}
        <div
          className="scroll-layer--hero"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            pointerEvents: "none",
            // ABOVE the content (main is z-10) so the hero is a full-screen
            // OPAQUE field (see .scroll-layer--hero background in index.css) that
            // the next section rises BEHIND — then the hero pixel-zooms and
            // DISSOLVES (--hero-opacity) to reveal it. Previously z-2 (below
            // content), so the opaque About section slid up OVER the hero like a
            // wall instead of the hero dissolving away. Stays below the HUD (z-40)
            // and cursors (z-10000); pointer-events:none + it fades to 0, so it
            // never blocks interaction once you're past the hero.
            zIndex: 11,
          }}
        >
          <HeroSignature />
        </div>

        {/* Static room render (replaces the deleted live 3D room). Fades in
            where the room used to appear and out into the Projects section via
            --canvas-opacity. Decorative + pointer-events:none. */}
        <div
          className="scroll-layer--canvas"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            zIndex: 0,
          }}
        >
          <img className="room-render" src="/render.webp" alt="" draggable={false} />
        </div>

        {/* Orange ring + dot cursor with parallax trail. */}
        {ready && !isMobile && <MoveableCursor hot={moveableHover} />}
        {/* Middle-button pan / autoscroll cursor. */}
        {ready && !isMobile && <PanCursor />}

        <PortfolioSections />

        {/* Brand mark (signature). Gated on hudVisible so it reveals AFTER the
            hero (the hero already carries the big signature wordmark, and a
            small mark over the orange field read as redundant + unreadable). */}
        <RoomHUD visible={hudVisible} />

        {/* Section indicator (dial) + jump-to-top, once past the hero. */}
        {hudVisible && (
          <>
            <StatusBar />
            <JumpToTop />
          </>
        )}
      </div>
    </AssemblyProvider>
  );
}
