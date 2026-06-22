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

// Hero wrapper opacity: held FULL through the pixel-zoom so the composition is
// SEEN zooming + pixelating, then the wrapper dissolves it just as the dive
// completes and the next section rises to meet it. Pulled earlier (was
// 0.85/1.05) so the dissolve tracks the now-compressed dive instead of lingering
// invisibly under the risen section.
// The opaque hero holds while the next section rises BEHIND it (hidden), then
// dissolves only AFTER that section has filled the viewport (~1.0vh, the hero
// spacer is 100vh), so the grey section is never seen sliding up as a wall — the
// hero just pixel-zooms and dissolves to reveal the already-arrived content.
const HERO_FADE_START_VH = 0.92;
const HERO_FADE_END_VH = 1.12;
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

    const heroFade = clamp01(
      (ratio - HERO_FADE_START_VH) / (HERO_FADE_END_VH - HERO_FADE_START_VH),
    );
    const heroOpacity = 1 - heroFade;

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

    const heroOpacity = ease(prevEased.heroOpacity, t.heroOpacity, dt);
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
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(warm);
      return () => w.cancelIdleCallback?.(id);
    }
    const tm = setTimeout(warm, 1500);
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

        <RoomHUD visible={true} />

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
