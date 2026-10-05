import { lazy, memo, Suspense, useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { softReleasePin } from "./softRelease";
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
import { useReveal } from "./useReveal";
import { track } from "../analytics";
import "./keypad.css";

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
 *     blooming when the model falls.
 *   - HIDDEN: until the drop arms, KeypadScene holds the model just above
 *     the canvas, clipped out of view, so the drop is a one-and-done surprise
 *     (owner, 2026-10-04: the old parked half-in-view hover read as "held
 *     halfway until you scroll").
 *   - DROP: a second observer ARMS a one-shot, time-based drop once the
 *     section top crosses DROP_TRIGGER_VH of the viewport. If an overlay
 *     (menu scrim, scroll-cover) still hides the page, the drop holds at
 *     t = 0 until it clears, so a menu jump shows the fall instead of a
 *     keypad that already landed behind the scrim. The timeline itself (fall,
 *     thud + dial kick at contact, squash, rebound) lives in KeypadScene and
 *     advances by frame dt. Time-based on purpose: the owner found a
 *     scroll-bound drop "overwhelming" (it arrived exactly as fast as they
 *     scrolled) and an after-the-fact drop "empty". A late or fast arrival
 *     (FAST_* below) plays the same timeline compressed to 460 ms so the
 *     landing still happens inside the pin.
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

/** Pin length as a fraction of the viewport height. Pure dwell: the drop
 *  (armed 0.2 vh before it) makes contact inside it up to ~1500 px/s. */
const PIN_VH = 0.6;
/** The drop arms ONCE when the section top crosses this fraction of the
 *  viewport height, then plays its fixed time-based timeline (never
 *  scroll-bound). Applied as an IO bottom inset; the callback lands about a
 *  frame after the crossing.
 *
 *  Owner, 2026-10-04: the old 0.45 line with a PARKED keypad (half in view,
 *  bobbing, from section entry) read as "held halfway until you scroll"; the
 *  keypad now waits out of frame and the drop should be "one and done, a
 *  surprise". Why 0.2: at 1440x900 the landed model spans section y ~89-751
 *  (~0.1-0.83 vh), so 0.2 is the LATEST line at which someone who stops
 *  scrolling right on it still sees the whole landing (bottom at ~1.03 vh, a
 *  sliver of the base at most) and the EARLIEST that keeps the empty stage
 *  long enough to set up the surprise. It sits 0.2 vh before the "top top"
 *  pin, so anyone scrolling through gets the contact inside the pin: at
 *  1500 px/s contact lands ~0.5 vh into the 0.6 vh pin. Before the line the
 *  stage is the rice backdrop with its glow already up (GLOW_APPROACH_MARGIN),
 *  so it never reads as a dead section. */
const DROP_TRIGGER_VH = 0.2;
/** Late / fast arrival: compress the 800 ms timeline to FAST_TOTAL_S when the
 *  trigger is seen with the section top already above FAST_LATE_VH (a late IO
 *  delivery at speed, or a jump that lands past the line), or the approach
 *  (glow line -> trigger line) ran faster than FAST_APPROACH_PX_S. Trigger to
 *  pin release is 0.2 + 0.6 = 0.8 vh (720 px at 900 tall): the full 800 ms
 *  settles inside it up to ~900 px/s (its 560 ms pull up to ~1290 px/s), the
 *  compressed 460 ms up to ~1560 px/s.
 *  Never applied behind an overlay (menu / covered jumps). */
const FAST_LATE_VH = 0.08;
const FAST_APPROACH_PX_S = 1100;
const FAST_TOTAL_S = 0.46;
const DROP_TOTAL_S = 0.8; // mirrors KeypadScene's DROP_TOTAL_S
/** The glow releases earlier, on approach (section top within 1.1vh). */
const GLOW_APPROACH_MARGIN = "0px 0px 10% 0px";
/** A full-screen overlay that hides the page: the section menu (while open
 *  or still fading out) and the scroll-cover of a covered cut jump. A menu
 *  jump to Contact lands at pin start while the menu scrim is still up, so
 *  the drop waits behind this gate and plays once the page is visible. */
const MENU_ROOT_SELECTOR = ".navx-spill-root";
const SCROLL_COVER_SELECTOR = ".scroll-cover";
/** The menu root AND the scroll-cover count as covering until their fade-out
 *  drops below this. (The cover used to release at the start of its 200 ms
 *  fade, hidden by the old fall's slow head; the pull is fastest at the
 *  start, so it now waits for the fade to finish.) */
const COVER_OPACITY_EPS = 0.05;
/** Safety cap on the cover wait, so a renamed overlay can never strand the
 *  keypad at its pre-drop pose. */
const COVER_WAIT_MAX_MS = 2500;

/** True while an overlay hides the page (see MENU_ROOT_SELECTOR). */
function pageCovered(): boolean {
  const cover = document.querySelector<HTMLElement>(SCROLL_COVER_SELECTOR);
  if (cover && (cover.classList.contains("is-on") || Number(getComputedStyle(cover).opacity) > COVER_OPACITY_EPS))
    return true;
  const menu = document.querySelector<HTMLElement>(MENU_ROOT_SELECTOR);
  if (!menu) return false;
  if (menu.dataset.open === "true") return true;
  return Number(getComputedStyle(menu).opacity) > COVER_OPACITY_EPS;
}

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
  /** Section top (px) when the trigger line was crossed. Debug only. */
  triggerTop: number | null;
  /** ms the drop waited behind an overlay after the trigger. Debug only. */
  coverWaitMs: number | null;
  /** Timeline playback rate: 1, or DROP_TOTAL_S / FAST_TOTAL_S for a late or
   *  fast arrival. Set once, when the drop arms. */
  rate: number;
  /** Approach speed (px/s, glow line -> trigger line), when measurable. Debug. */
  approachPxS: number | null;
}

/**
 * Memoized (no props): App re-renders on every keypad hover flip (it mirrors
 * `keypad-cursor-hover` into the custom cursor's state) and PortfolioSections
 * passes that re-render down. Without memo it reached the keypad <Canvas>,
 * whose reconfigure relinked all seven scene programs: a ~250 ms three.js
 * frame plus ~300-400 ms of React work, landing right as the falling model
 * first crossed a parked cursor.
 */
export const Keypad = memo(function Keypad() {
  const sectionRef = useRef<HTMLElement>(null);
  // MOBILE: the GSAP pin below is skipped on phones. The keypad <Canvas>
  // fills the whole section and inherits the global
  // `canvas { touch-action: none }`: on a phone a finger drag that starts on
  // the keypad couldn't pan-scroll the page, trapping the user on a pinned
  // full-viewport canvas. The canvas never mounts on mobile
  // (useSectionCanvasMount), so the section is a normal-flow band carrying
  // the contact chips below.
  const isMobile = useIsMobile();
  // Phones: the contact list blocks ride the shared one-shot [data-reveal]
  // entrance (useReveal + sections.css: the subtle mobile timing), like the
  // Honours rows above. Desktop has no [data-reveal] nodes here.
  useReveal(sectionRef, { enabled: isMobile });
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
    coverWaitMs: null,
    rate: 1,
    approachPxS: null,
  });

  // RiceBlob's orange glow target opacity 0..1 (its shader eases toward it).
  const glowOpacityRef = useRef<number>(TUNE_MODE ? 1 : 0);

  // Two one-shot observers: the glow on approach, the drop at the trigger line.
  useEffect(() => {
    if (TUNE_MODE) return;
    const el = sectionRef.current;
    if (!el) return;
    // The glow entry doubles as the approach-speed sample (time + top).
    let glowAt: { time: number; top: number } | null = null;
    const glowIO = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (!hit) return;
        glowAt = { time: hit.time, top: hit.boundingClientRect.top };
        glowOpacityRef.current = 1;
        glowIO.disconnect();
      },
      { rootMargin: GLOW_APPROACH_MARGIN },
    );
    // The drop arms at the trigger line, but only once the page is visible:
    // after a menu or covered jump the timeline holds at t = 0 until the
    // overlay has cleared (rAF poll, capped at COVER_WAIT_MAX_MS).
    let coverRaf = 0;
    const arm = (waitedMs: number) => {
      const d = dropRef.current;
      if (d.armed) return;
      d.armed = true;
      d.coverWaitMs = waitedMs;
      // Wake the scene's demand loop if it is already mounted and idle.
      window.dispatchEvent(new Event("keypad-drop-armed"));
    };
    const dropIO = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (!hit) return;
        dropIO.disconnect();
        const d = dropRef.current;
        if (d.armed) return;
        const top = hit.boundingClientRect.top;
        d.triggerTop = Math.round(top);
        if (!pageCovered()) {
          // Late / fast arrival: compress the timeline (see FAST_*).
          const dt = glowAt ? (hit.time - glowAt.time) / 1000 : 0;
          const v = glowAt && dt > 0.05 ? (glowAt.top - top) / dt : null;
          d.approachPxS = v == null ? null : Math.round(v);
          const late = top < FAST_LATE_VH * window.innerHeight;
          if (late || (v != null && v > FAST_APPROACH_PX_S))
            d.rate = DROP_TOTAL_S / FAST_TOTAL_S;
          return arm(0);
        }
        const t0 = performance.now();
        const poll = () => {
          const waited = performance.now() - t0;
          if (!pageCovered() || waited >= COVER_WAIT_MAX_MS) {
            coverRaf = 0;
            arm(Math.round(waited));
          } else coverRaf = requestAnimationFrame(poll);
        };
        coverRaf = requestAnimationFrame(poll);
      },
      {
        // No integer rounding: 0.425 must stay 57.5%, not snap to 57/58%.
        rootMargin: `0px 0px -${((1 - DROP_TRIGGER_VH) * 100).toFixed(1)}% 0px`,
      },
    );
    glowIO.observe(el);
    dropIO.observe(el);
    return () => {
      glowIO.disconnect();
      dropIO.disconnect();
      cancelAnimationFrame(coverRaf);
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
  // by the observer above and runs on its own clock during the approach.
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
    // Soft release: the section eases into scroll speed instead of snapping
    // off the pin (softRelease.ts).
    const stopSoftRelease = softReleasePin(pinST);

    // Refresh once after the layout settles (loading-active removed): the
    // page's height shifts as fonts load + lazy sections mount, and a stale
    // start would engage the pin at the wrong scroll position.
    const stopLoaderWatch = refreshScrollOnLoaderLift();

    return () => {
      stopLoaderWatch();
      stopSoftRelease();
      pinST.kill();
    };
    // Re-run when the breakpoint flips (rotate / resize across 768px)
    // so the pin is created/torn down to match the new layout.
  }, [isMobile]);


  return (
    <section
      ref={sectionRef}
      className="portfolio-section keypad-section"
      // jumpToSection() lands a menu/footer jump at the pin START; the drop
      // (armed at DROP_TRIGGER_VH, held until any overlay clears) plays in
      // view on arrival.
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
          <header className="keypad-mhead" data-reveal="">
            <span className="keypad-mnum">07</span>
            <h2 className="keypad-mtitle">Contact</h2>
          </header>

          {/* Primary channel: email. The one bold action on the surface.
              (Wrapped so the reveal's transition never collides with the
              card's own press transition.) */}
          <div data-reveal="">
            <a
              className="keypad-email"
              href="mailto:hello@danielrltan.com"
              onClick={() => track("contact_email", { context: "contact" })}
            >
              <span className="keypad-email-k">Email</span>
              <span className="keypad-email-v">hello@danielrltan.com</span>
            </a>
          </div>

          {/* Secondary: the socials, as a flat hairline-divided link list. */}
          <div className="keypad-elsewhere" data-reveal="">
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
});
