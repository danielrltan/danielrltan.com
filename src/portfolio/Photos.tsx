import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { requestScrollRefresh } from "./scrollRefresh";
import "./sections.css";
// Reuse the photo-train + gallery-header CSS that Beat A used inside Other.
// (Those classes are global; only the giant title is re-scoped in photos.css.)
import "./other.css";
import "./photos.css";
import { ScrambleText } from "./ScrambleText";
import { OtherPhotoTrains } from "../other/OtherPhotoTrains";
import { useSectionCanvasMount } from "../useSectionCanvasMount";

gsap.registerPlugin(ScrollTrigger);

/**
 * PHOTOS — "Recents".
 *
 * The horizontal photo-train stack that used to be Beat A inside the Play
 * (Other) section, lifted out into its own standalone section so Photos can
 * live near the end of the page (after Honors, before Contact) instead of
 * being the opening beat of the interests reel. Three rows of cards glide at
 * their own controlled rate as the section's pin scrubs; OtherPhotoTrains owns
 * the rAF lerp (never bound directly to scroll — see the project rule). Real
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

// Standalone pin length: enough scroll to parade one full unique-photo chunk
// of every row past the centred clear window (the trains derive their travel
// from live geometry, so this is just "how much scroll the parade gets").
const PIN_DURATION_PX = 2600;

// Train scrub window inside the pin: a short lead so the header lands first,
// a short tail so the last cards settle before the pin releases.
const TRAIN_START = 0.08;
const TRAIN_END = 0.92;

const PREFERS_REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;


function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Write the gallery header reveal STRAIGHT to CSS vars (no React state → the
// ~108 card nodes never re-render on a scrub tick). Fed by GSAP's smoothed
// scrub on the Lenis-synced ticker (project rule: never bind CSS to RAW scroll).
function applyGalleryHead(el: HTMLElement | null, p: number) {
  if (!el) return;
  el.style.setProperty("--gh-eye", String(smoothstep(0, 0.4, p)));
  el.style.setProperty("--gh-title", String(smoothstep(0.25, 0.75, p)));
}

export function Photos() {
  const sectionRef = useRef<HTMLElement>(null);
  // Beat-A-style train progress 0..1, written per GSAP frame into a REF (not
  // state) so the ~108 card nodes never re-render on a scrub tick; the trains'
  // rAF loop reads it directly.
  const progressRef = useRef(0);
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
    mountVh: 2,
    unmountVh: 4,
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
      end: `+=${PIN_DURATION_PX}`,
      pin: true,
      pinSpacing: true,
      // Smoothed scrub (same as Play): a fast flick GLIDES the trains rather
      // than teleporting the strip to the raw scroll position.
      scrub: 1,
      onUpdate: (self) => {
        const p = self.progress;
        // Header is already landed by the entrance trigger as the section
        // rises; the pin just holds it up (no per-frame re-land that would
        // snap it back to 0 at progress 0).
        applyGalleryHead(headerRef.current, 1);
        // Train progress 0..1 across [TRAIN_START, TRAIN_END].
        progressRef.current = Math.max(
          0,
          Math.min(1, (p - TRAIN_START) / (TRAIN_END - TRAIN_START)),
        );
      },
    });

    // Entrance reveal: fade the header up as the section RISES into view,
    // before the pin engages. Mirrors the Other Beat-A entrance so the
    // Honors→Photos seam is a cross-dissolve, not a blank gap.
    const entrance = ScrollTrigger.create({
      trigger: el,
      start: "top bottom",
      end: "top top",
      // scrub:1 (was true): eased on the Lenis-synced ticker, not raw scroll.
      scrub: 1,
      onUpdate: (self) => applyGalleryHead(headerRef.current, self.progress),
    });

    // Refresh after the loading screen lifts: pin position can shift during
    // initial layout. Same pattern as Other / Macintosh / Keypad.
    const html = document.documentElement;
    let lastLoading = html.classList.contains("loading-active");
    const obs = new MutationObserver(() => {
      const now = html.classList.contains("loading-active");
      if (lastLoading && !now) requestScrollRefresh();
      lastLoading = now;
    });
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    if (!lastLoading) {
      requestScrollRefresh();
    }

    return () => {
      obs.disconnect();
      st.kill();
      entrance.kill();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="portfolio-section portfolio-photos"
      aria-labelledby="photos-sr-heading"
    >
      {/* Accessible heading: the visible header + trains are decorative
          placeholders (aria-hidden below), so this carries the section name
          for AT and crawlers. When real captioned photos land, give each card
          a real <img alt> and promote the visible header. */}
      <h2 id="photos-sr-heading" className="other-sr-only">
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
          <OtherPhotoTrains photos={TRAIN_PHOTOS} progressRef={progressRef} />
        )}
      </div>
    </section>
  );
}
