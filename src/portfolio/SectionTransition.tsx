import { useEffect, useRef, useSyncExternalStore } from "react";
import { EASE_CSS, reducedMotion } from "../motion";
import { SEAM_MQ, mountSeam, oneShot, seg, ease } from "../seams";
import "./section-transition.css";

/**
 * The white marquee band between Recents and Contact, and seam 7 (recents ->
 * contact, spec .scratch/seams/SPEC.md §5.7): the CHANNEL DRUM.
 *
 * Owner brief (2026-10-06 seam overhaul): the white band read as a separate
 * strip sliding past, not a transition. Now the band turns out to be a channel
 * knob: a 3-face prism that rolls 1:1 with scroll in two detented clicks,
 * white -> International Orange (the same lowercase copy, inverted) -> white.
 * The band itself always moves 1:1; between clicks the drum sits square-on.
 * No new words: faces 1 and 2 are aria-hidden, inert copies of face 0 (and the
 * whole band is aria-hidden already; find-in-page duplicates are accepted).
 *
 * Modes (the root's `data-drum`, so CSS keys the 3D/2D face rules on the same
 * gate the JS uses; set by the seam, never by React):
 * - "3d"   desktop with a fine pointer (SEAM_MQ.fine): the scroll seam writes
 *          only `transform` on .st-drum; the faces' rotations are CSS.
 * - "flip" touch / phone / 769-900 (rule §0.8: no scroll-linked transform on
 *          touch): a time-based 2D squash-flip "double click" when the band
 *          centre crosses 50%, in both directions (oneShot, WAAPI).
 * - none   reduced motion (only face 0 renders; flat static band, as before)
 *          and gate G4 off.
 *
 * The marquee crawl is untouched (G8: steps(640) is owner intent): every face's
 * .st-track runs the same CSS animation, so the copies stay in phase, and the
 * IntersectionObserver pause below covers all of them.
 *
 * Stacking: the band root is z 4 in <main> (src/seams/stack.css) so the turning
 * drum, whose silhouette is 1.41x the band height mid-click, overlaps the
 * Recents stage above and the keypad top below instead of being clipped.
 */

/** Owner gate G4: 3 = the drum (white, orange, white); 1 = the flat white band, no seam. */
const DRUM_FACES = 3 as 3 | 1;

/** The two detented clicks, in band progress (`top bottom` -> `bottom top`). */
const CLICK_1: [number, number] = [0.3, 0.48];
const CLICK_2: [number, number] = [0.58, 0.76];

/** Pure: drum angle (deg) at band progress p. 0 = white face, 90 = orange, 180 = the white copy. */
const drumAngle =(p: number) =>
  90 * (ease.inOutCubic(seg(p, CLICK_1[0], CLICK_1[1])) + ease.inOutCubic(seg(p, CLICK_2[0], CLICK_2[1])));

/** Touch double click (ms): squash, swap to orange, open, hold, squash, swap back, open. */
const FLIP = { squash: 180, hold: 500 } as const;

const subscribeRm = (f: () => void) => reducedMotion.subscribe(f);
const readRm = () => reducedMotion.value;

export function SectionTransition() {
  const ref = useRef<HTMLElement>(null);
  const reduced = useSyncExternalStore(subscribeRm, readRm, () => false);
  const faces = DRUM_FACES === 3 && !reduced ? 3 : 1;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.remove("is-paused");
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        el.classList.toggle("is-paused", !entry.isIntersecting);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Seam 7. Mounted once: mountSeam re-gates itself live (reduced motion, the
  // narrow / compact / touch queries), so a gate flip swaps 3d <-> flip <-> flat.
  useEffect(() => {
    const el = ref.current;
    const drum = el?.querySelector<HTMLElement>(".st-drum");
    if (!el || !drum || DRUM_FACES !== 3) return;

    const setMode = (m: "3d" | "flip" | null) => {
      if (m === null) delete el.dataset.drum;
      else if (el.dataset.drum !== m) el.dataset.drum = m;
    };
    let lastPsi = NaN;
    const clearDrum = () => {
      drum.style.transform = "";
      drum.style.willChange = "";
      lastPsi = NaN;
    };

    // Touch double click: WAAPI, started together in one tick so the face swap
    // lands exactly on the squash's zero point (no timers). fill:none, so the
    // finished or cancelled state is the CSS rest state: the white face.
    let anims: Animation[] = [];
    const cancelFlip = () => {
      anims.forEach((a) => a.cancel());
      anims = [];
    };
    const playFlip = (): Animation | undefined => {
      cancelFlip();
      const hot = el.querySelector<HTMLElement>(".st-face--hot");
      if (!hot || typeof drum.animate !== "function") return;
      const s = FLIP.squash;
      const total = 4 * s + FLIP.hold;
      const at = (ms: number) => ms / total;
      const squash = drum.animate(
        [
          { transform: "scaleY(1)", offset: 0, easing: EASE_CSS.in },
          { transform: "scaleY(0)", offset: at(s), easing: EASE_CSS.out },
          { transform: "scaleY(1)", offset: at(2 * s) },
          { transform: "scaleY(1)", offset: at(2 * s + FLIP.hold), easing: EASE_CSS.in },
          { transform: "scaleY(0)", offset: at(3 * s + FLIP.hold), easing: EASE_CSS.out },
          { transform: "scaleY(1)", offset: 1 },
        ],
        { duration: total, fill: "none" },
      );
      // Faces are stacked flat in this mode; the orange one shows only
      // between the two zero points (hard steps: equal offsets).
      const swap = hot.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 0, offset: at(s) },
          { opacity: 1, offset: at(s) },
          { opacity: 1, offset: at(3 * s + FLIP.hold) },
          { opacity: 0, offset: at(3 * s + FLIP.hold) },
          { opacity: 0, offset: 1 },
        ],
        { duration: total, fill: "none" },
      );
      anims = [squash, swap];
      return squash;
    };

    return mountSeam({
      id: "recents-contact",
      trigger: () => el,
      start: "top bottom",
      end: "bottom top",
      when: SEAM_MQ.fine,
      measure: () => {
        // The drum axis sits half a band height behind the page (CSS
        // transform-origin z), so the resting face is exactly the band rect.
        el.style.setProperty("--st-h", `${el.offsetHeight}px`);
        setMode("3d");
      },
      render: (p) => {
        setMode("3d");
        // Detents: no write while the drum sits square-on between clicks.
        const psi = Math.round(drumAngle(p) * 1000) / 1000;
        if (psi === lastPsi) return;
        lastPsi = psi;
        // The square-on white face (psi 0) is the identity: no transform at
        // all, so the resting band is pixel-identical to the flat one.
        drum.style.transform = psi === 0 ? "" : `rotateX(${psi}deg)`;
      },
      activate: (on) => {
        drum.style.willChange = on ? "transform" : "";
      },
      final: () => {
        setMode(null);
        clearDrum();
      },
      reset: () => {
        setMode(null);
        clearDrum();
        el.style.removeProperty("--st-h");
      },
      fallback: () => {
        setMode("flip");
        // Both directions: crossing back up replays the same double click.
        const off = oneShot({ el, line: 0.5, edge: "center", play: () => playFlip(), snap: cancelFlip });
        return () => {
          off();
          cancelFlip();
          setMode(null);
        };
      },
    });
  }, []);

  const phrase = (
    <>
      <span className="st-text">Let&rsquo;s connect</span>
      <span className="st-bullet">•</span>
      <span className="st-text">Say hi</span>
      <span className="st-bullet">•</span>
      <span className="st-text">Drop a line</span>
      <span className="st-bullet">•</span>
      <span className="st-text">Socials below</span>
      <span className="st-bullet">•</span>
      <span className="st-text">hello@danielrltan.com</span>
      <span className="st-bullet">•</span>
    </>
  );
  const face = (k: number) => (
    <div
      key={k}
      className={`st-face st-face--${k}${k === 1 ? " st-face--hot" : ""}`}
      aria-hidden={k > 0 ? "true" : undefined}
      inert={k > 0 || undefined}
    >
      <div className="st-marquee">
        <div className="st-track">
          {phrase}
          {phrase}
        </div>
      </div>
    </div>
  );

  return (
    // The className is constant: `is-paused` is the initial state only and the
    // observer owns it after mount (React never rewrites an unchanged prop, so
    // the reduced-motion re-render that adds/removes faces leaves it alone).
    <section ref={ref} className="section-transition is-paused" aria-hidden="true" data-seam-stack={DRUM_FACES === 3 ? "" : undefined}>
      <div className="st-drum">{Array.from({ length: faces }, (_, k) => face(k))}</div>
    </section>
  );
}
