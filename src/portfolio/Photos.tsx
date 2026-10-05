import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { softRelease } from "./softRelease";
import { refreshScrollOnLoaderLift } from "./scrollRefresh";
import { smoothstep } from "../math";
import "./sections.css";
import "./photos.css";
import { ScrambleText } from "./ScrambleText";
import { RecentsCanvas } from "./RecentsCanvas";
import { useSectionCanvasMount } from "../useSectionCanvasMount";
import { reducedMotion } from "../motion";

gsap.registerPlugin(ScrollTrigger);

/**
 * PHOTOS — "Recents".
 *
 * A standalone section near the end of the page (after Honours, before
 * Contact). Every photo sits on an endless plane you can drag through
 * (RecentsCanvas: the owner's pick from the recents lab, 2026-10-05, which
 * replaced the three scroll-scrubbed photo trains). The section holds for
 * --photos-hold while ONE continuous progress span (the "photos-plane"
 * trigger) runs from the section entering the viewport, through the sticky
 * hold, to half a viewport past it. That progress pans the plane vertically,
 * so scrolling still moves you through the photos; dragging moves you
 * anywhere. Photos stream in from /photos/manifest.json.
 */

// Hold length (2 viewports) lives in photos.css as --photos-hold: the section
// is that much taller than its sticky stage. The plane's progress span ends
// PLANE_TAIL_VH viewports past the end of the hold.
const PLANE_TAIL_VH = 0.5;

// Write the gallery header reveal STRAIGHT to CSS vars (no React state, so
// the plane never re-renders on a scroll tick). Driven by ScrollTrigger on the
// Lenis-smoothed scroll (Lenis is the one smoother; photos.css keeps no
// transition on these vars). Skips the write when nothing changed.
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
  // Plane progress 0..1 across the photos-plane span, written per
  // ScrollTrigger update into a REF (not state); the plane's rAF loop reads it.
  const progressRef = useRef(0.5);
  // The plane's loop parks when idle; each progress write wakes it.
  const planeWakeRef = useRef<(() => void) | null>(null);
  // Header reveal written straight to CSS vars (no per-tick setState).
  const headerRef = useRef<HTMLElement>(null);
  // Mount the plane (and fetch its photos) as the section approaches. The
  // plane wrapper is position:absolute, so mounting never changes section
  // height or strands a trigger. It mounts on ALL viewports including phones
  // (disableOnMobile:false): the plane IS this section's experience.
  const planeMounted = useSectionCanvasMount(sectionRef, {
    mountVh: 3,
    unmountVh: 4.5,
    disableOnMobile: false,
  });

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    // THE HOLD IS CSS, NOT A GSAP PIN. The section is taller than the
    // viewport by --photos-hold and its .photos-stage is `position: sticky;
    // top: 0` inside it (photos.css), the same recipe as Play's
    // .other-pin-wrap. The old GSAP pin swapped the section to position:fixed
    // on a JS frame and wrapped it in a pin-spacer; on phones (native touch
    // scroll + anticipatePin) that logged a ~1.0 layout shift on engage and
    // ~0.97 on release. Sticky is resolved by the compositor with the native
    // scroll, so there is no engage frame and nothing shifts.
    //
    // Reduced motion: no hold (photos.css drops the extra height), plane
    // parked at its neutral centred frame with the header up.
    if (reducedMotion.value) {
      applyGalleryHead(headerRef.current, 1);
      progressRef.current = 0.5;
      return;
    }

    // "photos-pin" is kept as a NON-pinning trigger spanning the hold: the
    // section registry / jumpToSection read its start/end to land a menu jump
    // at data-jump-progress inside the hold. It also keeps the header landed
    // while held (applyGalleryHead no-ops when the value is unchanged).
    const st = ScrollTrigger.create({
      id: "photos-pin",
      trigger: el,
      start: "top top",
      end: "bottom bottom",
      invalidateOnRefresh: true,
      onUpdate: () => applyGalleryHead(headerRef.current, 1),
    });

    // One continuous plane span: from the section's top entering the viewport
    // bottom, through the hold, to PLANE_TAIL_VH past the hold's end. Not
    // pinning, and read raw by the plane (Lenis already smooths the scroll).
    const plane = ScrollTrigger.create({
      id: "photos-plane",
      trigger: el,
      start: "top bottom",
      end: () => `bottom ${Math.round((1 - PLANE_TAIL_VH) * 100)}%`,
      invalidateOnRefresh: true,
      onUpdate: (s) => {
        progressRef.current = s.progress;
        planeWakeRef.current?.();
      },
      // Callbacks don't fire for refresh-time changes; keep the ref seeded.
      onRefresh: (s) => {
        progressRef.current = s.progress;
        planeWakeRef.current?.();
      },
    });

    // Entrance reveal: fade the header up as the section RISES into view,
    // before the hold engages. Mirrors the Other Beat-A entrance so the
    // Honours→Photos seam is a cross-dissolve, not a blank gap.
    const entrance = ScrollTrigger.create({
      trigger: el,
      start: "top bottom",
      end: "top top",
      onUpdate: (self) => applyGalleryHead(headerRef.current, self.progress),
    });

    // Refresh after the loading screen lifts: trigger positions can shift
    // during initial layout. Same pattern as Other / Macintosh / Keypad.
    const stopLoaderWatch = refreshScrollOnLoaderLift();

    // Soft release of the sticky stage at the end of the hold (softRelease.ts).
    const stage = el.querySelector<HTMLElement>(".photos-stage");
    const stopSoftRelease = stage
      ? softRelease({ trigger: el, start: () => st.start, end: () => st.end, target: stage })
      : () => {};

    return () => {
      stopLoaderWatch();
      stopSoftRelease();
      plane.kill();
      st.kill();
      entrance.kill();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="portfolio-section portfolio-photos"
      aria-labelledby="photos-sr-heading"
      // Menu / footer jumps land just inside the hold (scroll.ts jumpToSection).
      data-jump-progress="0.1"
    >
      {/* Sticky stage: the viewport-tall frame that holds while the taller
          section scrolls past (photos.css). */}
      <div className="photos-stage">
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
              "--gh-eye": reducedMotion.value ? "1" : "0",
              "--gh-title": reducedMotion.value ? "1" : "0",
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

        {/* The photo plane: canvas, HUD and the portalled focus view. */}
        {planeMounted && (
          <RecentsCanvas progressRef={progressRef} wakeRef={planeWakeRef} />
        )}
      </div>
    </section>
  );
}
