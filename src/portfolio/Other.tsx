import { lazy, Suspense, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { softRelease } from "./softRelease";
import { refreshScrollOnLoaderLift } from "./scrollRefresh";
import { reducedMotion } from "../motion";
import "./sections.css";
import "./other.css";
import { ScrambleText } from "./ScrambleText";
import { HOBBIES } from "../other/hobbies";
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
 * The header arrives with a one-shot, time-based reveal (eyebrow, then title
 * with its pixel decode) once the section is well into view, and a `live`
 * gate wakes the heavy 3D render loop only while the section is on screen.
 * The accessible + crawlable interests list (sr-only) remains the source of
 * truth for screen readers,
 * keyboard users, and search crawlers, since the visible objects live in a
 * decorative <canvas>.
 */

// Play header reveal line: the wrapper's top crossing 65% of the viewport
// (about a third of the section is on screen, the title is well in view).
const HEADER_REVEAL_START = "top 65%";

// Longest the deferred canvas mount waits for an idle period. The mount band
// is ~3.5 viewports ahead, so even the cap lands it long before arrival.
const IDLE_MOUNT_TIMEOUT_MS = 1200;

/**
 * True one idle period after `open` turns true (requestIdleCallback with a
 * timeout; a short timer where rIC is missing, i.e. Safari). Drops back to
 * false at once when `open` does, so an unmount is never delayed.
 */
function useIdleGate(open: boolean, timeout: number): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setReady(true), { timeout });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setReady(true), 120);
    return () => window.clearTimeout(id);
  }, [open, timeout]);
  return open && ready;
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
    // Mount the cluster canvas well ahead (3.5 vs the 1.75 default) so the lazy
    // chunk + the ~2.3MB of GLBs — now also eagerly idle-warmed in App.tsx — are
    // resolved before arrival; on a quick scroll-in the section was
    // blanking/popping placeholder meshes while it loaded (user-flagged).
    // unmountVh:5 keeps the release band above the wider mount band.
    mountVh: 3.5,
    unmountVh: 5,
  });
  // ...but don't stand the canvas up from inside a scroll frame. The gate
  // flips while the reader is still in About (~3.5 viewports out) and the
  // mount (WebGL context + scene build + first draw) is one long task; start
  // it in the next idle period instead (capped, so a busy page still mounts
  // well before arrival).
  const sceneIdle = useIdleGate(sceneMounted, IDLE_MOUNT_TIMEOUT_MS);
  // Editorial corner header. `.is-in` (one-shot, latched) starts its CSS
  // reveal; `inView` opens the title's ScrambleText gate in the same pass.
  const headerRef = useRef<HTMLElement>(null);
  // Sticky-hold wrapper around the section (see other.css .other-pin-wrap).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  // Gates the heavy 3D render loop: true only while the section is on screen
  // (both directions). setState with an unchanged value bails.
  const [live, setLive] = useState(false);

  useEffect(() => {
    // Triggers measure the WRAPPER, not the sticky section: the wrapper's
    // top/bottom are fixed in the document (the section's rect moves while it
    // is stuck), and its bottom marks the end of the hold.
    const el = wrapRef.current;
    if (!el) return;

    const revealHeader = () => {
      headerRef.current?.classList.add("is-in");
      setInView(true);
    };

    // SCROLL STOP: the hold is pure CSS — `.other-pin-wrap` is taller than the
    // section by --other-stop and the section is `position: sticky; top: 0`
    // inside it (other.css, desktop only). A GSAP pin was tried first (same
    // recipe as Keypad) but it swaps the section to position:fixed on a JS
    // frame, which under Lenis' smoothed scroll could land a frame late and
    // read as a SNAP into the hold. Sticky is resolved by the compositor with
    // the native scroll, so the section glides to the top and simply stays —
    // no engagement frame, nothing to snap.

    // Header entrance: ONE time-based reveal, latched (once). end:"max" keeps
    // it active from the reveal line to the page end, so a load or cut jump
    // anywhere below the line still reveals it on the first update. Reduced
    // motion: revealed at mount (CSS parks it static; the scramble shows the
    // final text).
    let entrance: ScrollTrigger | null = null;
    if (reducedMotion.value) {
      revealHeader();
    } else {
      entrance = ScrollTrigger.create({
        trigger: el,
        start: HEADER_REVEAL_START,
        end: "max",
        once: true,
        onEnter: revealHeader,
      });
    }

    // Render-loop gate: live exactly while any of the wrapper is on screen.
    const presence = ScrollTrigger.create({
      trigger: el,
      start: "top bottom",
      end: "bottom top",
      onToggle: (self) => setLive(self.isActive),
    });
    if (presence.isActive) setLive(true);

    // Refresh after the loading screen lifts: layout can shift during initial
    // paint. Same pattern as the other sections.
    const stopLoaderWatch = refreshScrollOnLoaderLift();

    // Soft release of the sticky section at the end of the hold
    // (softRelease.ts). The hold runs while the wrapper's top is above the
    // viewport top by up to (wrapper - section) px; on phones there is no
    // sticky, the lengths match, and the release zone is empty.
    const section = sectionRef.current;
    const holdStart = () => el.getBoundingClientRect().top + window.scrollY;
    const stopSoftRelease = section
      ? softRelease({
          trigger: el,
          start: holdStart,
          end: () => holdStart() + Math.max(0, el.offsetHeight - section.offsetHeight),
          target: section,
        })
      : () => {};

    return () => {
      stopLoaderWatch();
      stopSoftRelease();
      entrance?.kill();
      presence.kill();
    };
  }, []);

  return (
    // Sticky-hold wrapper: taller than the section by --other-stop on desktop;
    // the section sticks to the viewport top while the wrapper scrolls through
    // (the scroll stop). Also the jump/active-section target for "Play" in
    // sectionRegistry, so a jump lands on the START of the hold.
    <div ref={wrapRef} className="other-pin-wrap">
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
      <h2 id="other-sr-heading" className="sr-only">
        Off the clock: some things I enjoy
      </h2>
      <ul className="sr-only" aria-label="Personal interests">
        {HOBBIES.map((h) => (
          <li key={h.id}>
            {h.label}: {h.caption}
          </li>
        ))}
      </ul>

      {/* Editorial corner header: tiny "04" tag + GIANT shared-scale wordmark.
          Floats over the full-bleed cluster (pointer-events:none). `.is-in`
          (added once by the entrance trigger) runs the eyebrow -> title
          reveal; the title's pixel decode starts on the same edge. */}
      <header
        ref={headerRef}
        className={inView ? "other-header is-in" : "other-header"}
      >
        <div className="other-eyebrow">
          <span className="other-section-num">04</span>
        </div>
        <h2 className="other-title">
          <ScrambleText text="Some interests" play={inView} />
        </h2>
      </header>

      {/* Full-bleed 3D cluster: the objects ARE the section. The canvas is
          transparent so the cool-grey page gradient reads through, giving the
          floating objects the feel of suspended-in-page rather than sitting in
          a framed box. aria-hidden: decorative; the sr-only list above is the
          accessible equivalent. */}
      <div className="other-scene-wrap" aria-hidden="true">
        {sceneMounted && sceneIdle && (
          <Suspense fallback={null}>
            <HobbiesScene live={live} />
          </Suspense>
        )}
      </div>

      {/* No bottom chip row: on phones each interest's NAME is rendered STATICALLY
          over its 3D object (HobbiesScene, the always-on label — like the desktop
          hover tag, but permanent on touch). The sr-only <ul> above stays the
          AT/SEO source of truth. */}
    </section>
    </div>
  );
}
