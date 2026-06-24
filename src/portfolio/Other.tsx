import { lazy, Suspense, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { requestScrollRefresh } from "./scrollRefresh";
import "./sections.css";
import "./other.css";
import { ScrambleText } from "./ScrambleText";
// Lazy: 3D hobbies scene loads on scroll-approach (idle-prefetched in App.tsx)
// rather than shipping in the first-paint bundle.
const HobbiesScene = lazy(() =>
  import("../other/HobbiesScene").then((m) => ({ default: m.HobbiesScene })),
);
import { useSectionCanvasMount } from "../useSectionCanvasMount";

gsap.registerPlugin(ScrollTrigger);

/**
 * "Off the clock" (section 04, "Play"): a BOLD INTEREST CLUSTER.
 *
 * REDESIGN: this section used to run a scroll-pinned, one-at-a-time "curated
 * reel" (the camera dollied to each hobby while the others dimmed). It is now a
 * single bold screen — the 3D HobbiesScene fills the viewport full-bleed and
 * floats all ten interest objects together as one dense, overlapping cluster
 * suspended in open space (the reference the user supplied). There is no pin, no
 * scroll-jack, no per-hobby focus, and no dot strip; the objects are the whole
 * show. Hovering (or tapping) an object surfaces its label via a tooltip.
 *
 * The only scroll-driven motion is a light entrance reveal of the editorial
 * header as the section rises into view (and a `live` gate that wakes the heavy
 * 3D render loop only when the section is near). The accessible + crawlable
 * interests list (sr-only) remains the source of truth for screen readers,
 * keyboard users, and search crawlers, since the visible objects live in a
 * decorative <canvas>.
 */

interface Hobby {
  id: string;
  label: string;
  caption: string; // 1-line note, carried by the sr-only accessible list
}

const HOBBIES: Hobby[] = [
  { id: "belt",     label: "Kickboxing",  caption: "gloves up, the discipline of throwing a clean combination and taking the hit." },
  { id: "piano",    label: "Piano",       caption: "an hour at the keys before anyone else is up." },
  { id: "pc",       label: "Workstation", caption: "the desk is the workshop is the lab is the rabbit hole." },
  { id: "shoe",     label: "Fashion",     caption: "a fit is a sentence. Punctuation matters." },
  { id: "keyboard", label: "Keyboards",   caption: "tactile under the fingers, loud in the room. on purpose." },
  { id: "cursor",   label: "Design",      caption: "obsession over the line weight no one will ever notice." },
  { id: "car",      label: "Cars",        caption: "spool, whistle, dump: the soundtrack of a good morning." },
  { id: "yarn",     label: "3D Modelling", caption: "started with the Blender donut, stayed for the topology." },
  { id: "luggage",  label: "Travel",      caption: "the carry-on is packed by Thursday for a Saturday I haven't booked." },
  { id: "ski",      label: "Skiing",      caption: "blue light, edges biting, the mountain quiet under it all." },
];

// Stable module-level id list — preserves referential identity across renders
// so HobbiesScene's memo/prop-equality is not defeated every render.
const HOBBY_IDS = HOBBIES.map((h) => h.id);

// prefers-reduced-motion: skip the entrance scrub and reveal the header
// statically with the 3D cluster live (the scene parks itself static too). Read
// once at mount; stable for the page lifetime.
const PREFERS_REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Write the editorial header reveal STRAIGHT to CSS custom props on the header
// element (no React state → the section never re-renders on a scrub tick). Fed
// by GSAP's smoothed scrub on the Lenis-synced gsap.ticker, so it's rate-limited
// on the same clock as the pins (project rule: never bind CSS to RAW scroll).
function applyHead(el: HTMLElement | null, p: number) {
  if (!el) return;
  el.style.setProperty("--head-eye", String(smoothstep(0, 0.3, p)));
  el.style.setProperty("--head-title", String(smoothstep(0.2, 0.6, p)));
}

export function Other() {
  const sectionRef = useRef<HTMLElement>(null);
  // Mount the hobbies <Canvas> only as the section approaches; release the WebGL
  // context once it's well out of view (the weak-GPU freeze fix). .other-scene-wrap
  // is position:absolute so mounting/unmounting never changes layout. `live`
  // below still gates the render LOOP; this gates the CONTEXT.
  // disableOnMobile:false — the 3D cluster IS this section's experience and stays
  // live on phones (rearranged to a tall portrait cluster that fills the screen).
  // Unlike Mac/Keypad, there's no UI laid OVER it to fight, so it's kept on mobile.
  const sceneMounted = useSectionCanvasMount(sectionRef, {
    disableOnMobile: false,
    // Mount the cluster canvas further ahead (2.75 vs the 1.75 default) so the
    // lazy chunk + GLBs are resolved well before arrival — on a quick scroll-in
    // the section was blanking/popping while it loaded (user-flagged).
    mountVh: 2.75,
  });
  // Header reveal is written straight to CSS vars via applyHead (no per-tick
  // setState). headerRef points at the editorial corner header.
  const headerRef = useRef<HTMLElement>(null);
  // Gates the heavy 3D render loop: flipped true as the section approaches so
  // the scene doesn't render at full rate while far off-screen. setState with
  // an unchanged value bails, so calling it per tick is free.
  const [live, setLive] = useState(false);

  useEffect(() => {
    // prefers-reduced-motion: no scrub. Header up, scene live (static cluster).
    if (PREFERS_REDUCED_MOTION) {
      applyHead(headerRef.current, 1);
      setLive(true);
      return;
    }

    const el = sectionRef.current;
    if (!el) return;

    // Entrance reveal: fade the editorial header up as the section RISES into
    // view, and warm the 3D scene so its first on-screen frame is ready. No pin,
    // no scroll-jack — just a cross-dissolve at the Work→Play seam. Reverses on
    // scroll-up.
    const entrance = ScrollTrigger.create({
      trigger: el,
      start: "top bottom",
      end: "top top",
      // scrub:1 (was true): GSAP eases progress on the Lenis-synced ticker, so
      // applyHead writes a rate-limited value, not the raw scroll position.
      scrub: 1,
      onUpdate: (self) => {
        const e = self.progress;
        applyHead(headerRef.current, e);
        setLive(e > 0.05);
      },
    });

    // Hold the header up + scene live while the section is anywhere on screen
    // (after the entrance completes the section sits pinned-free in view).
    const presence = ScrollTrigger.create({
      trigger: el,
      start: "top center",
      end: "bottom top",
      onToggle: (self) => {
        if (self.isActive) {
          applyHead(headerRef.current, 1);
          setLive(true);
        }
      },
    });

    // Refresh after the loading screen lifts: layout can shift during initial
    // paint. Same pattern as the other sections.
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
      entrance.kill();
      presence.kill();
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="portfolio-section portfolio-other"
      aria-labelledby="other-sr-heading"
    >
      {/* ====================================================================
          Accessible + crawlable interests list. The ten hobbies live ONLY as
          3D objects in a decorative <canvas> with hover/tap DOM tooltips.
          Screen readers, keyboard-only users, and crawlers see NOTHING of them
          otherwise. This visually-hidden (but DOM-real) list is the source of
          truth for those users and for SEO: a real heading + a real <ul> of
          every interest with its one-line note.
          ==================================================================== */}
      <h2 id="other-sr-heading" className="other-sr-only">
        Off the clock: some things I enjoy
      </h2>
      <ul className="other-sr-only" aria-label="Personal interests">
        {HOBBIES.map((h) => (
          <li key={h.id}>
            {h.label}: {h.caption}
          </li>
        ))}
      </ul>

      {/* Editorial corner header: tiny "04" tag + GIANT shared-scale wordmark.
          Floats over the full-bleed cluster (pointer-events:none). Per-element
          fade-up is driven by --head-* custom props poked from the entrance. */}
      <header
        ref={headerRef}
        className="other-header"
        style={
          {
            // Initial state only; applyHead writes these imperatively after mount.
            "--head-eye": PREFERS_REDUCED_MOTION ? "1" : "0",
            "--head-title": PREFERS_REDUCED_MOTION ? "1" : "0",
          } as React.CSSProperties
        }
      >
        <div className="other-eyebrow">
          <span className="other-section-num">04</span>
        </div>
        <h2 className="other-title">
          <ScrambleText text="Some interests" />
        </h2>
      </header>

      {/* Full-bleed 3D cluster: the objects ARE the section. The canvas is
          transparent so the cool-grey page gradient reads through, giving the
          floating objects the feel of suspended-in-page rather than sitting in
          a framed box. aria-hidden: decorative; the sr-only list above is the
          accessible equivalent. */}
      <div className="other-scene-wrap" aria-hidden="true">
        {sceneMounted && (
          <Suspense fallback={null}>
            <HobbiesScene hobbyIds={HOBBY_IDS} live={live} />
          </Suspense>
        )}
      </div>

      {/* No bottom chip row: on phones each interest's NAME is rendered STATICALLY
          over its 3D object (HobbiesScene, the always-on label — like the desktop
          hover tag, but permanent on touch). The sr-only <ul> above stays the
          AT/SEO source of truth. */}
    </section>
  );
}
