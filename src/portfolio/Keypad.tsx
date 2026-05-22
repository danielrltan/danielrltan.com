import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { KeypadScene } from "../keypad/KeypadScene";
import "./keypad.css";

gsap.registerPlugin(ScrollTrigger);

/**
 * Keypad section — bottom-of-page Contact surface. Pure 3D — the
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
 *   scrub) + its own Lenis singleton — that combo bugged out on first
 *   load when the page's layout shifted between trigger registration
 *   and the user reaching the section. Single-pin pattern matches the
 *   kit's, which has been reliable. Drop animation is now scroll-
 *   driven (not time-driven) so the user feels they're directly
 *   pulling the model into view.
 *
 * Lenis × ScrollTrigger sync still lives here as a module-scope
 * singleton — Lenis is set up before any pin is registered, both
 * ScrollTrigger.update + gsap.ticker hooked once so the page-wide
 * smooth scroll feeds every section's pin.
 *
 * Accessibility / SEO: the visual surface is 3D-only, but the section
 * also renders a visually-hidden but DOM-real h2 + <ul> of <a> tags
 * so screen readers, keyboard users, and crawlers see the links.
 *
 * Canvas is lazy-mounted via IntersectionObserver — keeps the second
 * WebGL context idle until the section approaches the viewport.
 */

const TUNE_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("tune") === "keypad";

// Pixels of vertical scroll the user travels while the section is
// pinned. Tuned long enough for the drop to land + a deliberate
// dwell on the keypad before the footer takes over.
const PIN_DURATION_PX = 1400;

// Lenis singleton — initialized lazily on first Keypad mount.
// Module scope so StrictMode's double-mount in dev doesn't spin up
// a competing instance.
let lenisInstance: Lenis | null = null;
function ensureLenis() {
  if (lenisInstance || typeof window === "undefined") return;
  // lerp 0.18 — tuned to settle smoothly within ~150-200ms so pins
  // bound to scrub:true don't drag for a noticeable beat after the
  // user stops wheeling.
  lenisInstance = new Lenis({ lerp: 0.22 });
  // Force scroll-origin sync — without it, if Lenis initializes
  // after the browser has scrolled (cache restore), Lenis snapshots
  // whatever position the scroller is at and treats it as 0.
  lenisInstance.scrollTo(0, { immediate: true });
  lenisInstance.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenisInstance!.raf(time * 1000));
  // Disable GSAP's lag smoothing — Lenis already manages frame
  // pacing; competing interpolators jitter the pin engagement.
  gsap.ticker.lagSmoothing(0);

  // Pause Lenis while the loading screen is up. CSS overflow:hidden
  // doesn't stop Lenis because Lenis hijacks wheel events — only
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

export function Keypad() {
  const sectionRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(TUNE_MODE);

  // Pin progress 0..1 — updated by the GSAP pin's onUpdate, read
  // every frame inside KeypadScene to drive the drop animation.
  // TUNE_MODE bypasses the pin and parks pin progress at 1 so the
  // playground sees the landed model immediately.
  const pinProgressRef = useRef<number>(TUNE_MODE ? 1 : 0);

  // Lazy-mount the canvas via IntersectionObserver — keeps the WebGL
  // context idle until the section approaches the viewport.
  useEffect(() => {
    if (TUNE_MODE) {
      const scroll = () => {
        sectionRef.current?.scrollIntoView({ block: "start" });
      };
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

  // Single pin ScrollTrigger — same pattern as Macintosh.tsx. scrub:true
  // means pin progress is the user's scroll position relative to the
  // pin window (0 at "top top," 1 at "+=PIN_DURATION_PX").
  useEffect(() => {
    if (TUNE_MODE) return;
    ensureLenis();
    const el = sectionRef.current;
    if (!el) return;

    const pinST = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: `+=${PIN_DURATION_PX}`,
      pin: true,
      pinSpacing: true,
      scrub: true,
      anticipatePin: 1,
      onUpdate: (self) => {
        pinProgressRef.current = self.progress;
      },
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
        ScrollTrigger.refresh();
      }
      lastLoadingActive = nowLoading;
    });
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    if (!lastLoadingActive) {
      requestAnimationFrame(() => ScrollTrigger.refresh());
    }

    return () => {
      obs.disconnect();
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
          <KeypadScene pinProgressRef={pinProgressRef} />
        ) : (
          <div className="keypad-placeholder" />
        )}
      </div>
    </section>
  );
}
