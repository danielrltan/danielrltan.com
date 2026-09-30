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
import { installHeroWipe } from "./hero/heroWipe";
import { useIsMobile } from "./useIsMobile";
import { StatusBar } from "./StatusBar";
import { isLowTier, demoteTier } from "./capabilityTier";
import { clamp01 } from "./math";

/*
 * App shell: the fixed hero layer, the scroll choreography that drives it
 * (CSS vars, no React re-renders on scroll), the sections, and the HUD. The
 * hero hands straight off to the opaque About section below it; About's
 * bento carries the room render (.about-room).
 */

// HERO -> ABOUT lives in src/hero/heroWipe.ts now (compositor-only pixel iris,
// bound 1:1 to the Lenis-smoothed scroll; no second ease, no settle snap, and
// the hero hides only once the iris has cleared the frame). What remains here
// is the page-level choreography that is NOT the hero handoff.

// Content opacity ramp window (page scroll fraction).
const CONTENT_FADE_START = 0.07;
const CONTENT_FADE_END = 0.105;

// Rate-limit for the scroll-driven content fade so a fast flick can't teleport
// it to its end state (~400ms to settle).
const PROGRESS_EASE_RATE = 2.5;
// Clamp per-frame dt so a long idle / tab-switch doesn't produce one giant
// catch-up jump on the next tick.
const MAX_TICK_DT = 0.05;

/**
 * rAF loop for the non-hero scroll signals (--content-opacity) plus the
 * data-hero-lite capability flag and the adaptive slow-frame degrade. Sleeps
 * once settled; a passive scroll/resize listener wakes it. Writes only on
 * change, so the root var is untouched outside its (far-down) window.
 */
function installScrollChoreography(): void {
  if (typeof window === "undefined") return;

  const root = document.documentElement;
  const isMobileQuery = window.matchMedia("(max-width: 768px)");

  // PERF: cache layout reads (scrollHeight/innerHeight) — they change on
  // resize/content-mount, NOT on scroll.
  let vhCache = window.innerHeight || 1;
  let scrollMax = Math.max(1, root.scrollHeight - vhCache);
  const recomputeLayout = () => {
    vhCache = window.innerHeight || 1;
    scrollMax = Math.max(1, root.scrollHeight - vhCache);
  };

  const lastVar: Record<string, string> = {};
  const setVar = (k: string, v: string) => {
    if (lastVar[k] === v) return;
    lastVar[k] = v;
    root.style.setProperty(k, v);
  };

  // data-hero-lite drops the resting wordmark keyline (SVG feMorphology, the
  // one software-rasterized piece of the hero) and the ring's cursor trail.
  // Driven by the capability tier, HiDPI/zoom, and the latched slow-frame
  // degrade below.
  let perfLocked = false;
  let slowFrames = 0;
  const updateHeroLite = () => {
    if (perfLocked || isLowTier() || (window.devicePixelRatio || 1) > 1.4)
      root.setAttribute("data-hero-lite", "");
    else root.removeAttribute("data-hero-lite");
  };
  updateHeroLite();

  const targetContent = () =>
    clamp01(
      (clamp01(window.scrollY / scrollMax) - CONTENT_FADE_START) /
        (CONTENT_FADE_END - CONTENT_FADE_START),
    );
  let contentOpacity = targetContent();
  let convergenceDelta = 1;

  const tick = (dt: number) => {
    const target = targetContent();
    contentOpacity +=
      (target - contentOpacity) * (1 - Math.exp(-dt * PROGRESS_EASE_RATE));
    setVar(
      "--content-opacity",
      isMobileQuery.matches ? "1" : contentOpacity.toFixed(3),
    );
    convergenceDelta = Math.abs(target - contentOpacity);
  };
  tick(MAX_TICK_DT * 100);

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
    // Adaptive degrade: if frames run consistently slow during active scroll,
    // latch the lite path for the rest of the session and persist a one-way
    // tier demote for the next load.
    if (!perfLocked && performance.now() - lastInput < SETTLE_MS) {
      if (rawDt > 0.055) {
        if (++slowFrames >= 8) {
          perfLocked = true;
          root.setAttribute("data-hero-lite", "");
          demoteTier();
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
  // It gates the HUD reveal and the idle warm-up so neither appears over the
  // loader.
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
    // Hero -> About pixel iris (compositor-only, scroll-bound; see heroWipe.ts).
    // The old scroll-end settle snap is gone: the iris resolves by 0.9vh, a
    // resting state mid-iris is a clean porthole (no ghosted bleed), and About's
    // pin holds the landing.
    installHeroWipe();
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

  // Reveal the HUD once ready and the user has fully landed on About (>=1.0vh,
  // after the iris resolves at 0.9vh) so it never pops in over the transition.
  useEffect(() => {
    if (!ready || hudVisible) return;
    const check = () => {
      const vhRatio = window.scrollY / Math.max(1, window.innerHeight);
      if (vhRatio >= 1.0) {
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

  /* Warm the lazy section-scene chunks, so each scene's chunk is compiled AND
   * its GLBs/textures are fetched BEFORE the user scrolls to it. Importing each
   * module runs its module-scope preload (useGLTF.preload for Mac/Keypad,
   * startPreload for Hobbies) — bytes + parse only, NO WebGL context — so it
   * can't touch the freeze protection; it just makes sections ready on arrival.
   *
   * Fires on FIRST MOUNT, NOT gated on `ready` (it used to be — the stated
   * reason was "don't keep drei's useProgress active under the loader," but
   * useAssemblyProgress dropped useProgress entirely, so that gate was pure cost
   * that pushed every prefetch ~3-4s out behind the loader hold). Warming during
   * the loader means the chunks + GLBs are cached by the time it lifts, killing
   * the cold "loads in late" pop the owner flagged — especially the Keypad.
   *
   * KEYPAD FIRST: it's the LAST section AND a jump-menu/StatusBar teleport
   * target, so its chunk compiles ahead of the others (mac.glb is only ~15KB, so
   * Mac loses nothing by going second). Hobbies (~620KB of GLBs) is staggered
   * last so its parse doesn't contend with the nearer scenes. */
  useEffect(() => {
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const ids: number[] = [];
    const timers: ReturnType<typeof setTimeout>[] = [];
    // Schedule on idle (with a guaranteed timeout so a busy main thread can't
    // starve it indefinitely) or a plain timer where rIC is unavailable.
    const schedule = (cb: () => void, idleTimeout: number, fallbackMs: number) => {
      if (typeof w.requestIdleCallback === "function") {
        ids.push(w.requestIdleCallback(cb, { timeout: idleTimeout }));
      } else {
        timers.push(setTimeout(cb, fallbackMs));
      }
    };
    // Wave 1 — Keypad (last section / teleport target) compiles first, then Mac.
    schedule(() => void import("./keypad/KeypadScene"), 300, 120);
    schedule(() => void import("./macintosh/MacintoshScene"), 450, 200);
    // Wave 2 — the heavy Play cluster, staggered behind wave 1.
    schedule(() => void import("./other/HobbiesScene"), 1400, 800);
    return () => {
      ids.forEach((id) => w.cancelIdleCallback?.(id));
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

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

        {/* Hero signature: fixed full viewport, between the content and the
            HUD. The hero -> About pixel iris (clip-path), its visibility and
            the mobile / reduced-motion fade are owned by src/hero/heroWipe.ts,
            written on this element only. */}
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
            // About sits BEHIND (held still by heroWipe's counter-translate) —
            // then a pixel iris opens in the hero to reveal it. Stays below the
            // HUD (z-40) and cursors (z-10000); pointer-events:none + hidden
            // once the iris clears, so it never blocks interaction past the hero.
            zIndex: 11,
          }}
        >
          <HeroSignature />
        </div>

        {/* Custom pointer. Mounted from first paint (not gated on `ready`) so a
            cursor is visible over the boot loader too; the OS arrow stays
            until it takes over (see html.custom-cursor in index.css). */}
        {!isMobile && <MoveableCursor hot={moveableHover} />}
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
