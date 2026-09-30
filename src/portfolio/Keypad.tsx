import { lazy, Suspense, useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { refreshScrollOnLoaderLift } from "./scrollRefresh";
import { SOCIALS } from "../socials";
import { isTuneMode } from "../tuneMode";
import { ensureLenis } from "../scroll";
import { useSectionCanvasMount } from "../useSectionCanvasMount";
// Lazy: keypad 3D scene (last section before the footer) loads on approach,
// idle-prefetched in App.tsx so the chunk is cached before scroll-in.
const KeypadScene = lazy(() =>
  import("../keypad/KeypadScene").then((m) => ({ default: m.KeypadScene })),
);
import { useIsMobile } from "../useIsMobile";
import { track } from "../analytics";
import "./keypad.css";

// Legacy scroll API: the Lenis singleton moved to src/scroll.ts; re-exported
// here so existing importers keep working until they migrate.
export { scrollToSection, panScrollTo, setScrollLocked } from "../scroll";

gsap.registerPlugin(ScrollTrigger);

/**
 * Keypad section: bottom-of-page Contact surface. Pure 3D: the
 * model exposes 4 socials (X, LinkedIn, GitHub, Pinterest); the dial
 * spins on click; cursor proximity pools rice grains in a soft fluid
 * blob behind it.
 *
 * Motion (motion spec W6). Nothing inside this section is scroll-linked:
 *   - GLOW: an approach observer (section top within 1.1vh) releases the
 *     RiceBlob wash, which fades in at λ 2.2, so the stage is already
 *     blooming when the model falls (no "empty stage").
 *   - DROP: a second observer ARMS a one-shot, time-based drop once the
 *     section top crosses DROP_TRIGGER_VH of the viewport, so the landing
 *     plays on screen instead of below the fold. The timeline itself (fall,
 *     thud + dial kick at contact, squash, rebound) lives in KeypadScene and
 *     advances by frame dt. Time-based on purpose: the owner found a
 *     scroll-bound drop "overwhelming" (it arrived exactly as fast as they
 *     scrolled) and an after-the-fact drop "empty".
 *   - PIN: one GSAP pin (id "keypad-pin", start "top top", end +PIN_VH of the
 *     viewport) is a pure dwell beat before the footer. No scrub, no onUpdate.
 *
 * The drop state lives in `dropRef` HERE, not in the scene, so it outlives
 * the canvas: on approach-gated devices (low tier, tablets) the scene
 * unmounts ~5vh away, and coming back shows the landed pose instead of
 * replaying the drop. One drop per page load.
 *
 * Lenis x ScrollTrigger sync lives in src/scroll.ts (module-scope
 * singleton). This section still calls ensureLenis() before its pin is
 * registered, so Lenis creation timing is unchanged.
 *
 * Accessibility / SEO: the visual surface is 3D-only, but the section
 * also renders a visually-hidden but DOM-real h2 + <ul> of <a> tags
 * so screen readers, keyboard users, and crawlers see the links.
 *
 * The canvas mounts via useSectionCanvasMount: eagerly on capable desktops,
 * on approach for low-tier GPUs and tablets. Mobile (<=768px) never mounts
 * it and shows the tappable contact chips instead.
 */

const TUNE_MODE = isTuneMode("keypad");

/** Pin length as a fraction of the viewport height. Pure dwell, sized so the
 *  600 ms drop lands inside the pin at scroll speeds up to ~1500 px/s. */
const PIN_VH = 0.6;
/** The drop arms when the section top crosses this fraction of the viewport
 *  height. Applied as an IO bottom inset. Spec: 0.45 (405 px at 900 tall,
 *  ±30 px). Measured on a real GPU at 1440x900, the landed model spans
 *  section-relative y ≈ 90-750, so at 600 px/s the contact frame clipped
 *  ~65 px below the fold at 0.45. 0.42 (378 px) is the low edge of the
 *  spec band and buys ~27 px of that back. */
const DROP_TRIGGER_VH = 0.42;
/** The glow releases earlier, on approach (section top within 1.1vh). */
const GLOW_APPROACH_MARGIN = "0px 0px 10% 0px";

/**
 * Drop timeline state shared with KeypadScene. Keypad.tsx arms it; the scene
 * advances `t` by frame dt and fires the contact beat exactly once.
 */
export interface KeypadDropState {
  /** Set by the trigger observer; the scene only advances `t` once armed. */
  armed: boolean;
  /** Seconds of drop timeline played (clamped-dt accumulator). */
  t: number;
  /** Latched when the contact beat (thud + dial kick) has fired. */
  contactFired: boolean;
  /** Section top (px) when the drop armed. Debug/measurement only. */
  triggerTop: number | null;
}

export function Keypad() {
  const sectionRef = useRef<HTMLElement>(null);
  // MOBILE: the GSAP pin below is skipped on phones. The keypad <Canvas>
  // fills the whole section and inherits the global
  // `canvas { touch-action: none }`: on a phone a finger drag that starts on
  // the keypad couldn't pan-scroll the page, trapping the user on a pinned
  // full-viewport canvas. The canvas never mounts on mobile
  // (useSectionCanvasMount), so the section is a normal-flow band carrying
  // the contact chips below.
  const isMobile = useIsMobile();
  // Capable desktops mount the canvas eagerly (see useSectionCanvasMount). On
  // approach-gated devices, mount it WELL ahead of arrival and release its
  // WebGL context once it's well out of view. The keypad is the LAST section
  // (footer below), so a generous ~3.75-viewport mount margin spins up the context +
  // GLB + first render while the user is still in Photos/Honors, so it's fully
  // loaded + settled BEFORE they reach it (no "Find me elsewhere placeholder
  // then it glitches/loads in" pop the owner flagged). The GLB is module-scope
  // preloaded and App.tsx idle-prefetches the scene chunk, so the early mount is
  // cheap. .keypad-placeholder reserves the exact box so layout never shifts.
  const mounted = useSectionCanvasMount(sectionRef, {
    mountVh: 3.75,
    unmountVh: 5,
  });

  // TUNE_MODE starts landed (t far past the timeline, contact already spent)
  // so the playground sees the resting model.
  const dropRef = useRef<KeypadDropState>({
    armed: TUNE_MODE,
    t: TUNE_MODE ? 60 : 0,
    contactFired: TUNE_MODE,
    triggerTop: null,
  });

  // RiceBlob's orange glow target opacity 0..1 (its shader eases toward it).
  const glowOpacityRef = useRef<number>(TUNE_MODE ? 1 : 0);

  // Two one-shot observers: the glow on approach, the drop at the trigger line.
  useEffect(() => {
    if (TUNE_MODE) return;
    const el = sectionRef.current;
    if (!el) return;
    const glowIO = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        glowOpacityRef.current = 1;
        glowIO.disconnect();
      },
      { rootMargin: GLOW_APPROACH_MARGIN },
    );
    const dropIO = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (!hit) return;
        dropIO.disconnect();
        const d = dropRef.current;
        if (d.armed) return;
        d.armed = true;
        d.triggerTop = Math.round(hit.boundingClientRect.top);
        // Wake the scene's demand loop if it is already mounted and idle.
        window.dispatchEvent(new Event("keypad-drop-armed"));
      },
      {
        rootMargin: `0px 0px -${Math.round((1 - DROP_TRIGGER_VH) * 100)}% 0px`,
      },
    );
    glowIO.observe(el);
    dropIO.observe(el);
    return () => {
      glowIO.disconnect();
      dropIO.disconnect();
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

  // The dwell pin. Pure hold: nothing reads its progress. The drop is armed
  // by the observer above, so it plays during the approach and lands in view.
  useEffect(() => {
    if (TUNE_MODE) return;
    ensureLenis();
    const el = sectionRef.current;
    if (!el) return;
    // Skip the pin on mobile: see the isMobile comment above. Lenis is still
    // ensured so the other sections' pins keep their ScrollTrigger.update feed.
    if (isMobile) return;

    const pinST = ScrollTrigger.create({
      id: "keypad-pin",
      trigger: el,
      start: "top top",
      end: () => "+=" + Math.round(window.innerHeight * PIN_VH),
      invalidateOnRefresh: true,
      pin: true,
      pinSpacing: true,
    });

    // Refresh once after the layout settles (loading-active removed): the
    // page's height shifts as fonts load + lazy sections mount, and a stale
    // start would engage the pin at the wrong scroll position.
    const stopLoaderWatch = refreshScrollOnLoaderLift();

    return () => {
      stopLoaderWatch();
      pinST.kill();
    };
    // Re-run when the breakpoint flips (rotate / resize across 768px)
    // so the pin is created/torn down to match the new layout.
  }, [isMobile]);


  return (
    <section
      ref={sectionRef}
      className="portfolio-section keypad-section"
      // jumpToSection() lands a menu/footer jump at the pin START, so the drop
      // (armed at DROP_TRIGGER_VH) plays in view on arrival.
      data-jump-progress="0"
    >
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
            <KeypadScene dropRef={dropRef} glowOpacityRef={glowOpacityRef} />
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
