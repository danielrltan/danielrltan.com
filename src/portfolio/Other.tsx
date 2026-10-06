import { lazy, Suspense, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { refreshScrollOnLoaderLift } from "./scrollRefresh";
import { ease, reducedMotion } from "../motion";
import { mountSeam, oneShot, smooth, SEAM_MQ } from "../seams";
import "./sections.css";
import "./other.css";
import { ScrambleText } from "./ScrambleText";
import { HOBBIES, hobbiesChanged, hobbiesMotion } from "../other/hobbies";
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
 * scroll stop, no per-hobby focus, and no dot strip; the objects are the whole
 * show. Hovering (or tapping) an object surfaces its label via a tooltip.
 *
 * SEAMS (2026-10-06 seam overhaul, owner brief "one workstation, one signal,
 * never stopping": something moves 1:1 with the wheel at every section
 * boundary, and only three short holds remain on the page). Play's 500px
 * sticky stop is gone; the section scrolls through at page speed and its two
 * boundaries are carried by the props instead:
 * - work → play, ZERO-G ARRIVAL: the ten props rise from below the fold in a
 *   left-to-right wave as the section comes up, and settle with a tiny
 *   overshoot exactly as its top reaches 5% of the viewport.
 * - play → honours, DOORS: as the trophy wall rises, the props part sideways
 *   like elevator doors to make room for it.
 * Both are pure functions of scroll (seams/seam.ts) feeding render-time
 * offsets in the scene through ../other/hobbies.ts; touch gets a short
 * time-based rise instead (scroll-linked writes lag threaded touch scroll).
 *
 * The header arrives with a one-shot, time-based reveal (eyebrow, then title
 * with its pixel decode) as soon as the section shows, and a `live`
 * gate wakes the heavy 3D render loop only while the section is on screen.
 * The accessible + crawlable interests list (sr-only) remains the source of
 * truth for screen readers,
 * keyboard users, and search crawlers, since the visible objects live in a
 * decorative <canvas>.
 */

// Play header reveal line: the wrapper's top crossing 95% of the viewport. It
// was 65% while the section held still for a beat; with no hold the decode has
// to start as soon as the section shows, so it is playing while the props rise
// (spec §5.4).
const HEADER_REVEAL_START = "top 95%";

// Zero-g arrival range (seam work-play): the wrapper's top from the viewport
// bottom to 5% from the top. The props are home exactly as the section lands.
const ARRIVAL_START = "top bottom";
const ARRIVAL_END = "top 5%";
// Rise depth (x the visible half-height): the scroll-linked desktop rise starts
// the props 1.3 half-frames down; the touch one-shot is a shorter 0.9 lift.
const ARRIVAL_DEPTH_SCROLL = 1.3;
const ARRIVAL_DEPTH_TOUCH = 0.9;
// Touch / phone one-shot: rise 700ms on an out-cubic when the wrapper top
// crosses 70% of the viewport; crossing back sinks them in 400ms.
const ARRIVAL_LINE = 0.7;
const ARRIVAL_RISE_MS = 700;
const ARRIVAL_SINK_MS = 400;
// Doors range (seam play-honours-doors): Honours' top from 85% to 25% of the
// viewport, so the middle is clear before its podium build finishes.
const DOORS_START = "top 85%";
const DOORS_END = "top 25%";

// Longest the deferred canvas mount waits for an idle period. The mount band
// is ~2.5 viewports ahead, so even the cap lands it long before arrival.
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
    // Mount the cluster canvas well ahead (2.5 vs the 1.75 default) so the lazy
    // chunk + the ~2.3MB of GLBs — now also eagerly idle-warmed in App.tsx — are
    // resolved before arrival; on a quick scroll-in the section was
    // blanking/popping placeholder meshes while it loaded (user-flagged).
    // unmountVh 3 (was 5; spec §5.4): the page is ~40% shorter after the seam
    // overhaul, so a 5-viewport band kept this context alive beside the
    // Honours and Recents ones. The release band MUST stay wider than the
    // mount band: with mount > unmount, a reader parked between the two bands
    // gets the canvas mounted, then released, and the mount observer never
    // fires again on the way in (blank section). Hence mount 3.5 -> 2.5.
    // (Capable desktops mount eagerly and never release; this band only
    // applies to phones, touch tablets and low-tier GPUs.)
    mountVh: 2.5,
    unmountVh: 3,
  });
  // ...but don't stand the canvas up from inside a scroll frame. The gate
  // flips while the reader is still in Work (~2.5 viewports out) and the
  // mount (WebGL context + scene build + first draw) is one long task; start
  // it in the next idle period instead (capped, so a busy page still mounts
  // well before arrival).
  const sceneIdle = useIdleGate(sceneMounted, IDLE_MOUNT_TIMEOUT_MS);
  // Editorial corner header. `.is-in` (one-shot, latched) starts its CSS
  // reveal; `inView` opens the title's ScrambleText gate in the same pass.
  const headerRef = useRef<HTMLElement>(null);
  // In-flow wrapper around the section (see other.css .other-pin-wrap).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  // Gates the heavy 3D render loop: true only while the section is on screen
  // (both directions). setState with an unchanged value bails.
  const [live, setLive] = useState(false);

  useEffect(() => {
    // Triggers measure the WRAPPER (the registry selector and an in-flow
    // element, spec §0.5). It is exactly the section's height now that the
    // hold is gone.
    const el = wrapRef.current;
    if (!el) return;

    const revealHeader = () => {
      headerRef.current?.classList.add("is-in");
      setInView(true);
    };

    // NO SCROLL STOP (seam overhaul 2026-10-06). Play used to hold for 500px
    // on a CSS sticky stop with a soft release: ~300px of scroll where
    // nothing on screen answered the wheel. The owner's brief for the seams is
    // that something moves 1:1 at every boundary and only three short holds
    // remain (Projects, Honours, Recents), so the section now scrolls through
    // at page speed and the zero-g arrival below is its entrance.

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

    // ZERO-G ARRIVAL (seam work-play, spec §5.4). Desktop with a fine pointer:
    // arrival = scroll progress of the wrapper's top from the viewport bottom
    // to 5% from the top, so the props rise WITH the wheel and are home
    // exactly as the section lands; scrolling up sinks them on the same curve.
    // Everything else (touch, the 769-900 band, phones): a short time-based
    // rise when the wrapper top crosses 70%, reversed on leave-back, since a
    // scroll-linked write lags threaded touch scroll by a frame (rule §0.8).
    // Reduced motion: arrival 1, the existing static still life.
    const setArrival = (a: number) => {
      if (a === hobbiesMotion.arrival) return;
      hobbiesMotion.arrival = a;
      hobbiesChanged();
    };
    const stopArrival = mountSeam({
      id: "work-play",
      trigger: () => wrapRef.current,
      start: ARRIVAL_START,
      end: ARRIVAL_END,
      when: SEAM_MQ.fine,
      measure: () => {
        hobbiesMotion.depthK = ARRIVAL_DEPTH_SCROLL;
      },
      render: (p) => setArrival(p),
      final: () => setArrival(1),
      reset: () => setArrival(1),
      fallback: () => {
        hobbiesMotion.depthK = ARRIVAL_DEPTH_TOUCH;
        // Above the line at mount: start below the fold (oneShot only snaps
        // the forward side; a mount below the line snaps to 1 through `snap`).
        setArrival(0);
        let raf = 0;
        const stop = () => {
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
        };
        // rAF tween from wherever the props are now (a reversal mid-rise
        // turns around without a jump). Returned as an Animation-shaped
        // handle so oneShot can finish() it on a cut jump.
        const tween = (to: number, ms: number, curve: (t: number) => number) => {
          stop();
          const from = hobbiesMotion.arrival;
          const t0 = performance.now();
          const step = (now: number) => {
            const t = Math.min(1, (now - t0) / ms);
            setArrival(from + (to - from) * curve(t));
            raf = t < 1 ? requestAnimationFrame(step) : 0;
          };
          raf = requestAnimationFrame(step);
          return {
            finish: () => {
              stop();
              setArrival(to);
            },
            cancel: stop,
          } as unknown as Animation;
        };
        const undo = oneShot({
          el,
          line: ARRIVAL_LINE,
          play: (dir) =>
            dir === 1
              ? tween(1, ARRIVAL_RISE_MS, ease.outCubic)
              : tween(0, ARRIVAL_SINK_MS, ease.inOut),
          snap: (dir) => {
            stop();
            setArrival(dir === 1 ? 1 : 0);
          },
        });
        return () => {
          undo();
          stop();
          hobbiesMotion.depthK = ARRIVAL_DEPTH_SCROLL;
        };
      },
    });

    // DOORS (seam play-honours-doors, spec §5.5; Honours builds its podium on
    // the same rise, W5). As "The trophy wall" comes up, the props slide apart
    // like elevator doors to make room for it, over Honours' top from 85% to
    // 25% of the viewport, and close again on the way back up. Honours'
    // section is read as a trigger only (an in-flow element it owns).
    // Desktop with a fine pointer only: there is no touch variant (on phones
    // Play and Honours stack as plain screens), and reduced motion keeps the
    // doors shut.
    const setDoors = (d: number) => {
      if (d === hobbiesMotion.doors) return;
      hobbiesMotion.doors = d;
      hobbiesChanged();
    };
    const stopDoors = mountSeam({
      id: "play-honours-doors",
      trigger: () => document.querySelector(".portfolio-bp"),
      start: DOORS_START,
      end: DOORS_END,
      when: SEAM_MQ.fine,
      render: (p) => setDoors(smooth(p)),
      final: () => setDoors(0),
      reset: () => setDoors(0),
    });

    return () => {
      stopLoaderWatch();
      stopDoors();
      stopArrival();
      entrance?.kill();
      presence.kill();
    };
  }, []);

  return (
    // In-flow wrapper, exactly the section's height (no hold). It is the
    // registry selector for "Play" (sectionRegistry) and the seams' trigger,
    // so the class name stays.
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
