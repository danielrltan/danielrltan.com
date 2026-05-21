import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { KeypadScene } from "../keypad/KeypadScene";
import "./keypad.css";

gsap.registerPlugin(ScrollTrigger);

/**
 * Bottom-of-page section replacing the old Contact card. Pure 3D — the
 * keypad surfaces 4 socials (X, LinkedIn, GitHub, Pinterest); the dial
 * spins on click for fun (each click adds velocity); the cursor pools
 * rice grains in a soft fluid blob behind it.
 *
 * Scroll choreography (TWO ScrollTriggers, intentional):
 *
 *   1. DROP TRIGGER — no pin. start: "top bottom", end: "top top".
 *      Drives sectionProgressRef from 0 → 1 as the section scrolls
 *      from "just entered viewport bottom" to "top edge hit viewport
 *      top". KeypadScene's drop-in lerp + dial auto-spin both read
 *      this ref, so the keypad falls into view DURING the section's
 *      entry — there is no "user staring at a blank grey panel"
 *      window. By the time the pin engages, the model has already
 *      landed.
 *
 *   2. PIN TRIGGER — pin: true, scrub: true. start: "top top",
 *      end: "+=PIN_DURATION_PX". Holds the section snapped to the
 *      viewport top for PIN_DURATION_PX of scroll so the user has a
 *      deliberate dwell to read the socials / interact with the keys
 *      before scrolling on to the footer. This trigger does NOT
 *      drive sectionProgressRef — the drop already completed.
 *
 *   Splitting these was the fix for "I scroll and the keypad doesn't
 *   show up, I have to jiggle to make it drop": the original single
 *   pinned+scrubbed trigger had progress 0 = "section just pinned at
 *   top" = "keypad still off-frame above," forcing the user to scroll
 *   past pin engagement before anything visibly happened. With the
 *   drop running on entry instead, the first frame of section-visible
 *   already shows the keypad mid-fall.
 *
 * Lenis provides the smooth-scroll feel. ScrollTrigger.update is wired
 * to Lenis's scroll event and gsap.ticker drives Lenis's rAF so both
 * triggers track the smoothed scroll position rather than jumpy native
 * deltas. Both are initialized exactly once at module scope.
 *
 * Accessibility / SEO:
 *   The visual surface is 3D-only, but the section also renders a
 *   visually-hidden but DOM-real h2 + <ul> of <a> tags so screen
 *   readers, keyboard users, and crawlers still see the links.
 *
 * The Canvas is lazy-mounted via IntersectionObserver — keeps the
 * second WebGL context idle until the section approaches the viewport.
 * Once mounted it stays mounted; remount-on-exit creates jank on
 * quick back-scrolls.
 */

// Tune mode short-circuits ScrollTrigger entirely so the pin can't
// fight the orbit/transform controls, and parks the page on the keypad
// section so the user can immediately drag the model around.
const TUNE_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("tune") === "keypad";

// Pixels of vertical scroll the user must travel while the section is
// pinned before it releases. Longer = more deliberate dwell on the
// keypad; shorter = quicker handoff to the footer.
const PIN_DURATION_PX = 1200;

// Lenis singleton — ONE instance for the whole page, initialized lazily
// on first Keypad mount. Lives at module scope so React StrictMode's
// double-mount in dev doesn't spin up a second smooth-scroll engine
// fighting the first. Wires its scroll event into ScrollTrigger.update
// and routes its rAF through gsap.ticker so the pin tracks the smoothed
// scroll value exactly.
let lenisInstance: Lenis | null = null;
function ensureLenis() {
  if (lenisInstance || typeof window === "undefined") return;
  // `lerp` is the per-frame interpolation factor for Lenis's smooth
  // scroll. Default is 0.1, which means it takes ~30 frames (~500ms)
  // to reach 95% of a target scroll position and ~1.4 seconds to
  // visually settle. That's a problem here because GSAP ScrollTrigger
  // is bound to Lenis's *smoothed* scroll position via `scrub: true`
  // — so the keypad's drop animation gets dragged out for the same
  // ~1.4s after the user stops wheeling, which reads as "I scrolled
  // to the keypad and have to wait a few seconds for it to drop." A
  // value of 0.18 settles in ~280ms / 95% in ~150ms, snappy enough
  // that the drop tracks the user's scroll without losing the smooth-
  // scroll feel entirely. (Setting it any higher starts to look
  // janky on trackpads.)
  lenisInstance = new Lenis({ lerp: 0.22 });
  // Make Lenis adopt scrollY=0 immediately. Without this, if Lenis is
  // initialized after the user has already scrolled or after a delayed
  // browser scroll-restore (despite main.tsx resetting first), Lenis
  // snapshots whatever the scroller is at and treats it as the new
  // origin. The `immediate: true` flag skips the smooth animation
  // (Lenis goes directly to 0 without animating).
  lenisInstance.scrollTo(0, { immediate: true });
  lenisInstance.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenisInstance!.raf(time * 1000));
  // Disable GSAP's lag smoothing — Lenis already manages frame pacing,
  // and the two would compete and produce visible jitter at the start
  // of each pin transition.
  gsap.ticker.lagSmoothing(0);

  // Pause Lenis while the loading screen is up. CSS `overflow: hidden`
  // on html.loading-active doesn't stop Lenis because Lenis hijacks
  // wheel events and applies its own transform — native overflow is
  // irrelevant to it. Calling lenis.stop() makes wheel events no-ops
  // until lenis.start() is called when `loading-active` is removed
  // (i.e. climaxDone in AssemblyController). MutationObserver fires
  // synchronously on classList toggles so there is no gap where Lenis
  // would still process input.
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

export function Keypad() {
  const sectionRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(TUNE_MODE);
  // `performance.now()` timestamp captured the FIRST time the section
  // enters the viewport (top crosses viewport bottom). KeypadScene
  // reads this and runs its drop-in animation off elapsed time, NOT
  // scroll progress — that's the "guided story" pacing requirement:
  // the drop plays at a fixed rate regardless of how fast the user
  // scrolls. `null` means the section hasn't been entered yet (model
  // sits above the frame, invisible).
  //
  // TUNE_MODE bypasses the trigger and parks the model at landed
  // position so the playground can manipulate it directly.
  const dropStartTimeRef = useRef<number | null>(TUNE_MODE ? 0 : null);

  useEffect(() => {
    if (TUNE_MODE) {
      // Park the page on the keypad section immediately so the user
      // can interact without scrolling around.
      const scroll = () => {
        sectionRef.current?.scrollIntoView({ block: "start" });
      };
      // Defer one tick so layout has settled.
      setTimeout(scroll, 50);
      return;
    }
    const el = sectionRef.current;
    if (!el || mounted) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setMounted(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted]);

  // GSAP ScrollTriggers — see top-of-file doc block for the two-trigger
  // rationale. Drop trigger fires once on section entry; pin trigger
  // holds the section at viewport top for the dwell beat.
  useEffect(() => {
    if (TUNE_MODE) return;
    ensureLenis();
    const el = sectionRef.current;
    if (!el) return;

    // Drop trigger: fires onEnter at "top bottom" — the moment the
    // section's top edge crosses into the viewport on a downward
    // scroll. KeypadScene then runs its drop-in animation off elapsed
    // time at a fixed rate (~DROP_DURATION_MS). Pacing intent:
    // the drop should LEAD the scroll by a small margin — by the
    // time the user has scrolled the rest of the way down to the
    // pin engagement point, the keypad is just finishing its
    // landing. With ~800px of section-entry scroll distance and a
    // typical scroll rate of ~1500px/s, the user covers entry in
    // ~500ms; a 700ms drop runs slightly faster than that scroll,
    // landing a hair before the pin engages. Decoupled from scroll
    // SPEED but anchored to scroll POSITION at start, so it always
    // feels like "the keypad is dropping into place as I scroll
    // there," not "I scroll there and then it animates after."
    const dropST = ScrollTrigger.create({
      trigger: el,
      start: "top bottom",
      end: "top top",
      onEnter: () => {
        dropStartTimeRef.current = performance.now();
      },
      onLeaveBack: () => {
        dropStartTimeRef.current = null;
      },
    });

    const pinST = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: `+=${PIN_DURATION_PX}`,
      pin: true,
      pinSpacing: true,
      // anticipatePin smooths the moment of pin-engagement on fast
      // scrolls — without it, the section can lag one frame at the
      // engagement point and look like a stutter.
      anticipatePin: 1,
    });

    // Refresh once after both triggers register so ScrollTrigger
    // re-measures the document height with the pin spacer included.
    ScrollTrigger.refresh();

    // Critical: ScrollTrigger caches the section's absolute position
    // when it refreshes. The page goes through several layout phases
    // before loading finishes — `html.loading-active` toggles
    // `overflow: hidden`, fonts load and re-flow text, lazy sections
    // mount and inject content — and any of those can shift the
    // keypad section's absolute Y position. If ScrollTrigger doesn't
    // re-measure after those settle, the cached "section.top" can be
    // hundreds of pixels off, and the drop/pin triggers never engage
    // at the scroll positions the user actually reaches → keypad
    // appears to "never drop" until the user keeps scrolling far past
    // where the section visually lives.
    //
    // We watch `html.loading-active` and refresh once — and ONLY once
    // — at the transition from "loading" → "settled." Earlier versions
    // refreshed on every classList change, but Lenis toggles
    // `lenis-scrolling` on the html element every single scroll
    // event, which made `ScrollTrigger.refresh()` fire dozens of
    // times per second during scroll. Each refresh re-measures all
    // triggers and can transiently mis-position the pin, which read
    // to the user as "the section pins late" / "keypad doesn't drop
    // until I'm past it." Gating on the loading-active → removed
    // transition fixes both the perf and the correctness.
    const html = document.documentElement;
    let lastLoadingActive = html.classList.contains("loading-active");
    const obs = new MutationObserver(() => {
      const nowLoading = html.classList.contains("loading-active");
      if (lastLoadingActive && !nowLoading) {
        // Just transitioned from loading → settled. Refresh once so
        // the pin positions reflect the final layout.
        ScrollTrigger.refresh();
      }
      lastLoadingActive = nowLoading;
    });
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    // Fallback: if loading-active was already gone before this effect
    // ran (cached GLB → climaxDone before Keypad mounts), refresh on
    // the next frame so we still pick up the post-load layout.
    if (!lastLoadingActive) {
      requestAnimationFrame(() => ScrollTrigger.refresh());
    }

    return () => {
      obs.disconnect();
      dropST.kill();
      pinST.kill();
    };
  }, []);

  return (
    <section ref={sectionRef} className="portfolio-section keypad-section">
      {/* Hidden semantic content for AT / keyboard / SEO. */}
      <div className="sr-only">
        <h2>Find me elsewhere</h2>
        <ul>
          <li>
            <a href="https://x.com/danielrltan">X (Twitter)</a>
          </li>
          <li>
            <a href="https://www.linkedin.com/in/danielrltan">LinkedIn</a>
          </li>
          <li>
            <a href="https://github.com/danielrltan">GitHub</a>
          </li>
          <li>
            <a href="https://www.pinterest.com/danielrltan">Pinterest</a>
          </li>
        </ul>
      </div>

      <div className="keypad-stage">
        {mounted ? (
          <KeypadScene dropStartTimeRef={dropStartTimeRef} />
        ) : (
          <div className="keypad-placeholder" />
        )}
      </div>
    </section>
  );
}
