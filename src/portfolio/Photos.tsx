import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { softHold } from "../seams";
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
 *
 * Seam overhaul (owner brief 2026-10-06: section boundaries should never stop
 * the page): the hold is 0.8vh (stack.css --seam-photos-hold, phones too; was
 * 2vh) with softHold's C1 engage and release, and the Honours -> Recents seam
 * is a 1-bit pixel iris drawn inside the plane's own canvas (RecentsCanvas),
 * opened by the entrance progress below: the hero's iris, echoed.
 */

// Hold length lives in CSS: photos.css --photos-hold, overridden to
// --seam-photos-hold (80svh) by src/seams/stack.css while this section carries
// data-seam-stack. The plane's progress span ends PLANE_TAIL_VH viewports past
// the end of the hold.
const PLANE_TAIL_VH = 0.5;
// Scroll pan rate: px of plane travel per px of page scroll across the whole
// photos-plane span. It was a fixed 1.4vh of travel over a 3.5vh span
// (0.4px/px); the span is now 2.3vh, so the travel is computed from the
// measured span and the pan keeps the same feel at any hold length.
const PAN_RATE = 0.4;

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
  // Plane travel (px) over the whole photos-plane span (PAN_RATE * span),
  // measured on refresh. 0 = not measured yet (the plane uses its estimate).
  const panPxRef = useRef(0);
  // Honours -> Recents iris, 0..1: the entrance progress (section top from the
  // viewport bottom to the viewport top). 1 = fully open (reduced motion, or
  // anywhere past the entrance).
  const irisRef = useRef(reducedMotion.value ? 1 : 0);
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
      irisRef.current = 1;
      return;
    }

    // The sticky .photos-stage gets softHold (src/seams/softHold.ts): a small
    // `translate` bump around each sticky edge, so the stage eases into the
    // hold and back out of it (C1 engage + release, nothing left over; it
    // replaces softRelease, which only eased the exit and left the stage L/2
    // high over a page-tone strip). It also creates "photos-pin", the
    // NON-pinning trigger over the sticky span that the section registry /
    // jumpToSection read to land a menu jump at data-jump-progress.
    const stage = el.querySelector<HTMLElement>(".photos-stage");
    const hold = stage ? softHold({ id: "photos-pin", section: el, stage }) : null;

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
      // The span is re-measured here too (it moves with the hold length).
      onRefresh: (s) => {
        panPxRef.current = PAN_RATE * Math.max(0, s.end - s.start);
        progressRef.current = s.progress;
        planeWakeRef.current?.();
      },
    });

    // Entrance: as the section RISES into view, before the hold engages, the
    // header fades up and the pixel iris opens in the plane (irisRef; the
    // canvas draws it as a pure function of this progress, so it reverses
    // exactly on scroll-up and lands right after a cut jump). Written on
    // refresh and leave as well: a load or jump below the section must still
    // leave the header up and the iris open (the old photos-pin onUpdate used
    // to pin the header at 1 through the hold).
    const writeEntrance = (self: ScrollTrigger) => {
      applyGalleryHead(headerRef.current, self.progress);
      if (irisRef.current !== self.progress) {
        irisRef.current = self.progress;
        planeWakeRef.current?.();
      }
    };
    const entrance = ScrollTrigger.create({
      trigger: el,
      start: "top bottom",
      end: "top top",
      invalidateOnRefresh: true,
      onUpdate: writeEntrance,
      onRefresh: writeEntrance,
      onLeave: writeEntrance,
      onLeaveBack: writeEntrance,
    });

    // Refresh after the loading screen lifts: trigger positions can shift
    // during initial layout. Same pattern as Other / Macintosh / Keypad.
    const stopLoaderWatch = refreshScrollOnLoaderLift();

    return () => {
      stopLoaderWatch();
      hold?.kill();
      plane.kill();
      entrance.kill();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="portfolio-section portfolio-photos"
      aria-labelledby="photos-sr-heading"
      // Opts into the seam layout contract (src/seams/stack.css): the hold
      // becomes --seam-photos-hold (0.8vh) at every width while motion is OK.
      data-seam-stack=""
      // Menu / footer jumps land a quarter into the hold (scroll.ts
      // jumpToSection): inside softHold's still core (0.1875..0.8125 of the
      // hold), past the iris and the engage ease.
      data-jump-progress="0.25"
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
          <RecentsCanvas
            progressRef={progressRef}
            panPxRef={panPxRef}
            irisRef={irisRef}
            wakeRef={planeWakeRef}
          />
        )}
      </div>
    </section>
  );
}
