import { lazy, Suspense, useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { requestScrollRefresh } from "./scrollRefresh";
import Lenis from "lenis";
import { useSectionCanvasMount } from "../useSectionCanvasMount";
// Lazy: keypad 3D scene (last section before the footer) loads on approach,
// idle-prefetched in App.tsx so the chunk is cached before scroll-in.
const KeypadScene = lazy(() =>
  import("../keypad/KeypadScene").then((m) => ({ default: m.KeypadScene })),
);
import { useIsMobile } from "../useIsMobile";
import { track } from "../analytics";
import "./keypad.css";

gsap.registerPlugin(ScrollTrigger);

// Single source of truth for the four socials the keypad exposes.
// Used by BOTH the visually-hidden semantic list (AT / SEO) and the
// mobile DOM contact chips below, so the links can't drift apart. The
// 3D caps reference the same destinations on desktop.
const SOCIALS = [
  { label: "X", aria: "X (Twitter)", href: "https://x.com/danielrltan", host: "x.com" },
  {
    label: "LinkedIn",
    aria: "LinkedIn",
    href: "https://www.linkedin.com/in/danielrltan",
    host: "linkedin.com",
  },
  {
    label: "GitHub",
    aria: "GitHub",
    href: "https://github.com/danielrltan",
    host: "github.com",
  },
  {
    label: "Pinterest",
    aria: "Pinterest",
    href: "https://www.pinterest.com/danielrltan",
    host: "pinterest.com",
  },
] as const;

/**
 * Keypad section: bottom-of-page Contact surface. Pure 3D: the
 * model exposes 4 socials (X, LinkedIn, GitHub, Pinterest); the dial
 * spins on click; cursor proximity pools rice grains in a soft fluid
 * blob behind it.
 *
 * Scroll pattern (after the kit/Macintosh refactor):
 *   ONE GSAP ScrollTrigger pin with scrub:true. start: "top top",
 *   end: `+=PIN_DURATION_PX`. The pin's onUpdate writes pin progress
 *   (0..1) into pinProgressRef. KeypadScene reads that ref every
 *   frame and drives:
 *     - drop-in animation: pin progress 0.00 → 0.30
 *     - dial auto-spin kick: fires at pin progress ≈ 0.10
 *     - idle / face-tracking: pin progress > 0.30
 *
 *   Previously this used TWO triggers (drop on entry by time, pin by
 *   scrub) + its own Lenis singleton; that combo bugged out on first
 *   load when the page's layout shifted between trigger registration
 *   and the user reaching the section. Single-pin pattern matches the
 *   kit's, which has been reliable. Drop animation is now scroll-
 *   driven (not time-driven) so the user feels they're directly
 *   pulling the model into view.
 *
 * Lenis × ScrollTrigger sync still lives here as a module-scope
 * singleton: Lenis is set up before any pin is registered, both
 * ScrollTrigger.update + gsap.ticker hooked once so the page-wide
 * smooth scroll feeds every section's pin.
 *
 * Accessibility / SEO: the visual surface is 3D-only, but the section
 * also renders a visually-hidden but DOM-real h2 + <ul> of <a> tags
 * so screen readers, keyboard users, and crawlers see the links.
 *
 * Canvas is lazy-mounted via IntersectionObserver: keeps the second
 * WebGL context idle until the section approaches the viewport.
 */

const TUNE_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("tune") === "keypad";

// Pixels of vertical scroll the user travels while the section is
// pinned. Tuned long enough for the drop to land + a deliberate
// dwell on the keypad before the footer takes over.
const PIN_DURATION_PX = 1400;

// Lenis singleton: initialized lazily on first Keypad mount.
// Module scope so StrictMode's double-mount in dev doesn't spin up
// a competing instance.
let lenisInstance: Lenis | null = null;
function ensureLenis() {
  if (lenisInstance || typeof window === "undefined") return;
  // Lenis tuning: balances smoothness vs responsiveness. PERF /
  // FEEL: duration dropped 0.95s → 0.6s after user reported the page
  // feeling "laggy and unusable". The longer duration was amplifying
  // perceived jank: every wheel impulse spread its work over ~57
  // frames, and any per-frame stall during that window read as the
  // entire page hitching. 0.6s still feels glided (vs. the bare-OS
  // 0ms native scroll) while keeping each impulse resolved in ~36
  // frames: fewer chances for an outlier frame to register.
  //
  // wheelMultiplier bumped 0.85 → 1.0 so a single wheel notch moves
  // a sensible distance even though each impulse is shorter.
  //
  // TOUCH: smooth-scroll is intentionally OFF on touch. `syncTouch:false`
  // (Lenis default, set explicitly here for clarity) means a finger drag
  // uses the OS's native momentum/rubber-band scrolling, which on mobile
  // GPUs feels crisper and lower-latency than re-interpolating every touch
  // delta through Lenis's lerp (that path reads as laggy on a phone).
  // GSAP ScrollTrigger still updates from the native scroll, so the
  // pinned keypad/Mac/footer sections stay in sync. touchMultiplier left
  // at the neutral 1 (it only scales deltas when syncTouch is on).
  lenisInstance = new Lenis({
    duration: 0.6,
    easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    wheelMultiplier: 1.0,
    syncTouch: false,
    touchMultiplier: 1,
  });
  // Force scroll-origin sync: without it, if Lenis initializes
  // after the browser has scrolled (cache restore), Lenis snapshots
  // whatever position the scroller is at and treats it as 0.
  lenisInstance.scrollTo(0, { immediate: true });
  lenisInstance.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenisInstance!.raf(time * 1000));
  // Disable GSAP's lag smoothing: Lenis already manages frame
  // pacing; competing interpolators jitter the pin engagement.
  gsap.ticker.lagSmoothing(0);

  // Pause Lenis while the loading screen is up. CSS overflow:hidden
  // doesn't stop Lenis because Lenis hijacks wheel events; only
  // lenis.stop() truly halts input. MutationObserver fires
  // synchronously on classList toggles so input is gated cleanly.
  const html = document.documentElement;
  const sync = () => {
    if (!lenisInstance) return;
    if (html.classList.contains("loading-active")) lenisInstance.stop();
    else lenisInstance.start();
  };
  sync();
  new MutationObserver(sync).observe(html, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

/**
 * Middle-button PAN / auto-scroll: jump the page to an ABSOLUTE Y immediately
 * (no lerp) via the shared Lenis singleton, so the autoscroll tracks the caller's
 * own running target at a direct, snappy, predictable rate. The caller owns the
 * target (accumulating it frame to frame) so nothing compounds — reading Lenis's
 * smoothed `.scroll` back each frame scrolled ~3x too fast. Routing through Lenis
 * (rather than window.scrollTo, which Lenis would lerp straight back) keeps GSAP
 * ScrollTrigger + the pinned sections in sync. ensureLenis() is idempotent.
 */
export function panScrollTo(y: number) {
  if (typeof window === "undefined") return;
  ensureLenis();
  if (lenisInstance) {
    lenisInstance.scrollTo(y, { immediate: true });
  } else {
    window.scrollTo(0, y);
  }
}

/**
 * Smooth-scroll to an absolute Y (or an element) via the shared Lenis
 * singleton. Falls back to native window.scrollTo if Lenis isn't up yet.
 * Used by the section nav menu to jump between sections; routing through
 * the same Lenis instance keeps GSAP ScrollTrigger / the pinned sections
 * in sync (a raw window.scrollTo would fight Lenis's lerp).
 */
export function scrollToSection(
  target: number | HTMLElement,
  opts?: { duration?: number; immediate?: boolean },
) {
  if (lenisInstance) {
    lenisInstance.scrollTo(target, {
      duration: opts?.duration,
      immediate: opts?.immediate,
    });
    return;
  }
  if (typeof window === "undefined") return;
  const y =
    typeof target === "number"
      ? target
      : target.getBoundingClientRect().top + window.scrollY;
  window.scrollTo({ top: y, behavior: opts?.immediate ? "auto" : "smooth" });
}

/**
 * Lock / unlock page scrolling. CSS overflow:hidden alone doesn't stop Lenis
 * (it hijacks wheel events), so we stop the Lenis singleton too — and set
 * overflow:hidden as the native fallback. Used by the spill menu so the page
 * can't be scrolled underneath it while it's open.
 */
export function setScrollLocked(locked: boolean) {
  if (lenisInstance) {
    if (locked) lenisInstance.stop();
    else lenisInstance.start();
  }
  if (typeof document !== "undefined") {
    document.documentElement.style.overflow = locked ? "hidden" : "";
  }
}

export function Keypad() {
  const sectionRef = useRef<HTMLElement>(null);
  // MOBILE: the GSAP pin below is skipped on phones. The desktop pin
  // holds the section fixed for PIN_DURATION_PX of scroll, but the
  // keypad <Canvas> fills the whole section and inherits the global
  // `canvas { touch-action: none }`: on a phone a finger drag that
  // starts on the keypad can't pan-scroll the page, trapping the user
  // on a pinned full-viewport canvas with no way out. The sibling 3D
  // section (Macintosh) already skips its pin at narrow widths for the
  // same reason. Without the pin this is a normal-flow ~80vh band; the
  // drop-in still plays because pinProgressRef is driven by the
  // time-based IntersectionObserver ramp below, NOT by the pin.
  const isMobile = useIsMobile();
  // Mount the keypad <Canvas> WELL ahead of arrival, then release its WebGL
  // context once it's well out of view. The keypad is the LAST section (footer
  // below), so a generous ~3.25-viewport mount margin spins up the context +
  // GLB + first render while the user is still in Photos/Honors — so it's fully
  // loaded + settled BEFORE they reach it (no "Find me elsewhere placeholder
  // then it glitches/loads in" pop the owner flagged). The GLB is module-scope
  // preloaded and App.tsx idle-prefetches the scene chunk, so the early mount is
  // cheap. .keypad-placeholder reserves the exact box so layout never shifts.
  const mounted = useSectionCanvasMount(sectionRef, {
    mountVh: 3.75,
    unmountVh: 5,
  });

  // pinProgressRef is now a TIME-driven 0..1 ramp, not scroll-driven.
  // User feedback: the scroll-bound drop matched the scroll rate so
  // closely that the landing felt 'overwhelming': the keypad was
  // arriving as fast as the user scrolled, leaving no moment to
  // actually watch it land.
  //
  // New behaviour: ramp from 0 → 1 over DROP_RAMP_MS once the section
  // ENTERS the viewport (IntersectionObserver). User scrolls there,
  // section enters, keypad drops in on its own pace, user has the
  // pinned dwell to read + interact.
  //
  // TUNE_MODE parks at 1 so the playground sees the landed model.
  const pinProgressRef = useRef<number>(TUNE_MODE ? 1 : 0);

  // RiceBlob's orange glow opacity 0..1. Held at 0 until the keypad
  // drop animation finishes, then ramped to 1 with a subtle fade so
  // the orange wash doesn't appear behind an empty section. Read by
  // RiceBlob's shader uniform.
  const glowOpacityRef = useRef<number>(TUNE_MODE ? 1 : 0);

  // Time-driven drop, started on APPROACH so the keypad is settling AS you
  // arrive, not after you've stopped on an empty pinned stage. The old tuning
  // (IO at -25% center + 300ms pause + 1200ms ramp + glow released only at the
  // very end) made a fast scroll-to-contact read as ~1.2-2.2s of empty section
  // "loading in" — the owner's "queued in wrong / delaying it" report. Now: IO
  // fires as the section approaches, a near-zero pause, a brisk ramp, and the
  // glow releases partway through the drop. (Still time-based, not scroll-bound,
  // so it honours the fixed-rate-animation rule.)
  useEffect(() => {
    if (TUNE_MODE) return;
    const el = sectionRef.current;
    if (!el) return;
    const DROP_DELAY_MS = 50;
    const DROP_RAMP_MS = 550;
    let started = false;
    let rampStarted = false;
    let startTime = 0;
    let rafId = 0;
    let delayId: number | null = null;
    const tick = () => {
      const elapsed = performance.now() - startTime;
      const t = Math.max(0, Math.min(1, elapsed / DROP_RAMP_MS));
      pinProgressRef.current = t * 0.4;
      // Release the glow PARTWAY through the drop (not at the very end): the
      // RiceBlob wash lerps toward this over ~1s, so releasing it at t=0.5 lands
      // the wash close to the model's landing instead of ~1s behind it.
      if (t >= 0.5) glowOpacityRef.current = 1;
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !started) {
            started = true;
            io.disconnect();
            // Pre-drop pause: user gets a beat of empty section
            // before the keypad starts landing.
            delayId = window.setTimeout(() => {
              if (rampStarted) return;
              rampStarted = true;
              startTime = performance.now();
              rafId = requestAnimationFrame(tick);
            }, DROP_DELAY_MS);
            return;
          }
        }
      },
      { rootMargin: "0px 0px 10% 0px" },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(rafId);
      if (delayId != null) window.clearTimeout(delayId);
    };
  }, []);

  // TUNE_MODE: park the page on the keypad section immediately so
  // the user can interact without scrolling around.
  useEffect(() => {
    if (!TUNE_MODE) return;
    const scroll = () => {
      sectionRef.current?.scrollIntoView({ block: "start" });
    };
    setTimeout(scroll, 50);
  }, []);

  // Single pin ScrollTrigger: same pattern as Macintosh.tsx. scrub:true
  // means pin progress is the user's scroll position relative to the
  // pin window (0 at "top top," 1 at "+=PIN_DURATION_PX").
  useEffect(() => {
    if (TUNE_MODE) return;
    ensureLenis();
    const el = sectionRef.current;
    if (!el) return;
    // Skip the pin on mobile: see the isMobile comment above. The
    // section becomes a normal-flow band; Lenis is still ensured so
    // page-wide smooth scroll (desktop) and the other sections' pins
    // keep their ScrollTrigger.update feed.
    if (isMobile) return;

    // Pin trigger: holds the section snapped to viewport top for a
    // dwell beat. NO onUpdate / scrub here; pinProgressRef is owned
    // by the scroll listener above which spans BOTH approach AND
    // pin, so the drop animation can play during entry instead of
    // only after pin engagement (the bug that left the section
    // looking empty on first scroll-past).
    const pinST = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: `+=${PIN_DURATION_PX}`,
      pin: true,
      pinSpacing: true,
      anticipatePin: 1,
    });

    // Refresh once after the layout settles (loading-active removed).
    // The page's height shifts as fonts load + lazy sections mount;
    // without this refresh the pin can engage at the wrong scroll
    // position (the bug that caused "keypad doesn't drop on first
    // scroll").
    const html = document.documentElement;
    let lastLoadingActive = html.classList.contains("loading-active");
    const obs = new MutationObserver(() => {
      const nowLoading = html.classList.contains("loading-active");
      if (lastLoadingActive && !nowLoading) {
        requestScrollRefresh();
      }
      lastLoadingActive = nowLoading;
    });
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    if (!lastLoadingActive) {
      requestScrollRefresh();
    }

    return () => {
      obs.disconnect();
      pinST.kill();
    };
    // Re-run when the breakpoint flips (rotate / resize across 768px)
    // so the pin is created/torn down to match the new layout.
  }, [isMobile]);

  return (
    <section ref={sectionRef} className="portfolio-section keypad-section">
      {/* Hidden semantic content for AT / keyboard / SEO. Driven from the
          shared SOCIALS list so it can't drift from the visible chips. On
          mobile these same links are surfaced as real, tappable chips below
          (the .keypad-contact block); on desktop the 3D caps are the visible
          affordance and this stays the AT/crawler fallback. */}
      <div className="sr-only">
        <h2>Find me elsewhere</h2>
        <ul>
          {SOCIALS.map((s) => (
            <li key={s.label}>
              <a href={s.href}>{s.aria}</a>
            </li>
          ))}
        </ul>
      </div>

      <div className="keypad-stage">
        {mounted ? (
          <Suspense fallback={<div className="keypad-placeholder" />}>
            <KeypadScene
              pinProgressRef={pinProgressRef}
              glowOpacityRef={glowOpacityRef}
            />
          </Suspense>
        ) : (
          <div className="keypad-placeholder" />
        )}
      </div>

      {/* MOBILE Contact surface. The 3D keypad caps are invisible hit-boxes with
          no touch affordance, so on a phone THIS real, tappable block IS the
          Contact section (it also covers the WebGL-unavailable case). Gated to
          mobile only — desktop keeps the 3D scene + watermark, untouched.
          The header reuses the shared system: an <h2> inside a .portfolio-section
          auto-takes the giant pixel wordmark, so "Contact" reads at the SAME
          scale as every other section's corner header (the one the section was
          missing). */}
      {isMobile && (
        <div className="keypad-mobile">
          <header className="keypad-mhead">
            <span className="keypad-mnum">07</span>
            <h2 className="keypad-mtitle">Contact</h2>
          </header>

          {/* Primary channel: email. The one bold action on the surface. */}
          <a
            className="keypad-email"
            href="mailto:hello@danielrltan.com"
            onClick={() => track("contact_email", { context: "contact" })}
          >
            <span className="keypad-email-k">Email</span>
            <span className="keypad-email-v">hello@danielrltan.com</span>
          </a>

          {/* Secondary: the socials, as a flat hairline-divided link list. */}
          <div className="keypad-elsewhere">
            <span className="keypad-elsewhere-k">Find me elsewhere</span>
            <nav className="keypad-contact" aria-label="Find me elsewhere">
              {SOCIALS.map((s) => (
                <a
                  key={s.label}
                  className="keypad-contact-chip"
                  href={s.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${s.aria}: opens in a new tab`}
                  onClick={() =>
                    track("outbound_link", {
                      url: s.label.toLowerCase(),
                      context: "contact",
                    })
                  }
                >
                  <span className="keypad-contact-name">{s.label}</span>
                  <span className="keypad-contact-meta">
                    <span className="keypad-contact-host">{s.host}</span>
                    {/* External-link arrow (↗): a real affordance, not
                        decoration — signals the link opens off-site. */}
                    <svg
                      className="keypad-contact-arrow"
                      width="11"
                      height="11"
                      viewBox="0 0 10 10"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M2.6 7.4 L7.4 2.6 M4 2.6 H7.4 V6"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="square"
                      />
                    </svg>
                  </span>
                </a>
              ))}
            </nav>
          </div>
        </div>
      )}
    </section>
  );
}
