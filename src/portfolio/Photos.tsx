import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { refreshScrollOnLoaderLift } from "./scrollRefresh";
import { smoothstep } from "../math";
import "./sections.css";
import "./photos.css";
import { ScrambleText } from "./ScrambleText";
import { OtherPhotoTrains } from "../other/OtherPhotoTrains";
import { useSectionCanvasMount } from "../useSectionCanvasMount";
import { isCoarsePointer } from "../motion";

gsap.registerPlugin(ScrollTrigger);

/**
 * PHOTOS — "Recents".
 *
 * The horizontal photo-train stack (originally the opening beat of the Play
 * section), now its own standalone section near the end of the page (after
 * Honours, before Contact). Three rows of cards slide as the page scrolls:
 * ONE continuous train-progress span (the "photos-train" trigger) runs from
 * the section entering the viewport, through the pin, to half a viewport past
 * it, so the rack is never parked static on the way in or out.
 * OtherPhotoTrains follows that progress through a dt-based damp that sleeps
 * once converged. Real
 * uploads stream in from /photos/manifest.json; until they exist the tinted
 * placeholders below render.
 */

// Placeholder photo vocabulary (moved here from Other.tsx with the trains).
const TRAIN_PHOTOS = [
  { color: "#2a1f1a", label: "Kickboxing" },
  { color: "#1a1714", label: "Piano" },
  { color: "#262120", label: "Keys" },
  { color: "#5a3a1f", label: "Cars" },
  { color: "#a8c4d0", label: "Skiing" },
  { color: "#ff4f00", label: "Design" },
  { color: "#3d4a52", label: "Travel" },
  { color: "#c08c6c", label: "3D Modelling" },
  { color: "#3a2418", label: "Fashion" },
  { color: "#d4a574", label: "Coffee" },
  { color: "#7a4f30", label: "Photography" },
  { color: "#1f1a17", label: "Books" },
];

// Pin length, viewport-relative (motion spec §3). Was a fixed 2600px with a
// dead lead/tail and a static rack either side; the train now moves across
// the whole approach + pin + exit span instead (TRAIN_TAIL_VH).
const PIN_VH = 2.0;
// The train progress span ends this many viewports past the pin's end.
const TRAIN_TAIL_VH = 0.5;

const PREFERS_REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;


// Write the gallery header reveal STRAIGHT to CSS vars (no React state → the
// ~108 card nodes never re-render on a scroll tick). Driven by ScrollTrigger
// on the Lenis-smoothed scroll (Lenis is the one smoother; photos.css keeps
// no transition on these vars). Skips the write when nothing changed.
function applyGalleryHead(el: HTMLElement | null, p: number) {
  if (!el) return;
  const eye = smoothstep(0, 0.4, p).toFixed(3);
  const title = smoothstep(0.25, 0.75, p).toFixed(3);
  if (el.style.getPropertyValue("--gh-eye") !== eye) el.style.setProperty("--gh-eye", eye);
  if (el.style.getPropertyValue("--gh-title") !== title) {
    el.style.setProperty("--gh-title", title);
  }
}

export function Photos() {
  const sectionRef = useRef<HTMLElement>(null);
  // Train progress 0..1 across the photos-train span, written per ScrollTrigger
  // update into a REF (not state) so the ~108 card nodes never re-render on a
  // scroll tick; the trains' rAF loop reads it directly.
  const progressRef = useRef(0);
  // The trains' follow loop sleeps once converged; each progress write wakes it.
  const trainWakeRef = useRef<(() => void) | null>(null);
  // Header reveal written straight to CSS vars (no per-tick setState).
  const headerRef = useRef<HTMLElement>(null);
  // Defer the ~5MB of photo webp off the INITIAL load: mount the trains only as
  // the section approaches (a generous 2vh lead so images fetch before arrival).
  // .other-trains-wrap is position:absolute, so this never changes section height
  // or strands the pin; once fetched, the browser caches them across remounts.
  // Trains mount on ALL viewports (incl. phones): the horizontal photo carousel
  // IS this section's experience — restored on mobile per the owner ("restore
  // the prod carousel; the vertical stack is terrible mobile UX"). The trains
  // fetch their own /photos/manifest.json. disableOnMobile:false overrides the
  // section-canvas keystone (which is for the live-WebGL sections, not this DOM
  // rack).
  const trainsMounted = useSectionCanvasMount(sectionRef, {
    mountVh: 3,
    unmountVh: 4.5,
    disableOnMobile: false,
  });

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    // The pin scrubs the horizontal photo carousel on ALL viewports — including
    // phones (restored per the owner; the vertical grid was bad mobile UX). Only
    // prefers-reduced-motion opts out, laying the rack at its neutral centred
    // frame with the header up (a static, readable single frame).
    if (PREFERS_REDUCED_MOTION) {
      applyGalleryHead(headerRef.current, 1);
      progressRef.current = 0.5;
      return;
    }

    const st = ScrollTrigger.create({
      id: "photos-pin",
      trigger: el,
      start: "top top",
      end: () => "+=" + Math.round(window.innerHeight * PIN_VH),
      invalidateOnRefresh: true,
      pin: true,
      pinSpacing: true,
      // Native touch scroll pins late without it (the pin engages a frame
      // after the section passes the top); Lenis-driven desktop scroll pins
      // early WITH it, so only coarse pointers get it.
      anticipatePin: isCoarsePointer() ? 1 : 0,
      // Header is already landed by the entrance trigger as the section
      // rises; the pin just holds it up (applyGalleryHead no-ops when the
      // value is unchanged).
      onUpdate: () => applyGalleryHead(headerRef.current, 1),
    });

    // One continuous train span (created AFTER the pin so it refreshes after
    // it): from the section's top entering the viewport bottom, through the
    // pin, to TRAIN_TAIL_VH past the pin's end. Not pinning.
    const train = ScrollTrigger.create({
      id: "photos-train",
      trigger: el,
      start: "top bottom",
      end: () =>
        (ScrollTrigger.getById("photos-pin")?.end ?? st.end) +
        window.innerHeight * TRAIN_TAIL_VH,
      invalidateOnRefresh: true,
      onUpdate: (s) => {
        progressRef.current = s.progress;
        trainWakeRef.current?.();
      },
      // Callbacks don't fire for refresh-time changes; keep the ref seeded.
      onRefresh: (s) => {
        progressRef.current = s.progress;
        trainWakeRef.current?.();
      },
    });

    // Entrance reveal: fade the header up as the section RISES into view,
    // before the pin engages. Mirrors the Other Beat-A entrance so the
    // Honors→Photos seam is a cross-dissolve, not a blank gap. Direct on the
    // Lenis-smoothed scroll (a numeric scrub here was inert: nothing attached).
    const entrance = ScrollTrigger.create({
      trigger: el,
      start: "top bottom",
      end: "top top",
      onUpdate: (self) => applyGalleryHead(headerRef.current, self.progress),
    });

    // Refresh after the loading screen lifts: pin position can shift during
    // initial layout. Same pattern as Other / Macintosh / Keypad.
    const stopLoaderWatch = refreshScrollOnLoaderLift();

    return () => {
      stopLoaderWatch();
      train.kill();
      st.kill();
      entrance.kill();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="portfolio-section portfolio-photos"
      aria-labelledby="photos-sr-heading"
      // Menu / footer jumps land just inside the pin (scroll.ts jumpToSection).
      data-jump-progress="0.1"
    >
      {/* Accessible heading: the visible header + trains are decorative
          placeholders (aria-hidden below), so this carries the section name
          for AT and crawlers. When real captioned photos land, give each card
          a real <img alt> and promote the visible header. */}
      <h2 id="photos-sr-heading" className="sr-only">
        Recents: a few frames from off the clock
      </h2>

      <header
        ref={headerRef}
        className="other-gallery-header"
        aria-hidden="true"
        style={
          {
            // Initial state only; applyGalleryHead writes these after mount.
            "--gh-eye": PREFERS_REDUCED_MOTION ? "1" : "0",
            "--gh-title": PREFERS_REDUCED_MOTION ? "1" : "0",
          } as React.CSSProperties
        }
      >
        {/* Cohesive corner header: big "06" + UPPERCASE wordmark. */}
        <div className="other-gallery-eyebrow">
          <span className="other-gallery-num">06</span>
        </div>
        <h2 className="other-gallery-title">
          <ScrambleText text="Recents" />
        </h2>
      </header>

      {/* The horizontal photo train rack (three parallax rows) — the carousel,
          on every viewport. The pin scrubs it; on mobile it's the swipe-through
          carousel the owner wanted back. */}
      <div className="other-trains-wrap" aria-hidden="true">
        {trainsMounted && (
          <OtherPhotoTrains
            photos={TRAIN_PHOTOS}
            progressRef={progressRef}
            wakeRef={trainWakeRef}
          />
        )}
      </div>
    </section>
  );
}
