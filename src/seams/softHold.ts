import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SEAM, reducedMotion } from "../motion";
import { requestScrollRefresh } from "../portfolio/scrollRefresh";
import { holdOffset, stageTop } from "./holdMath";
import { registerHold, unregisterHold } from "./holds";

gsap.registerPlugin(ScrollTrigger);

/**
 * SOFT HOLD (spec §4.2; replaces softRelease, which stays as a compatibility
 * wrapper until its last caller migrates).
 *
 * Owner, 2026-10-05: "make releases from pins lighter and more smooth; right
 * now it feels like it snaps off from scroll". The seam overhaul replaces the
 * GSAP pins with tall in-flow sections and an inner `position: sticky` stage
 * (src/seams/stack.css). A sticky stops dead at engage and starts at full
 * scroll speed at release; softHold writes a small CSS `translate` on the
 * stage around each edge (holdMath.ts) so its on-screen velocity ramps
 * linearly over L instead: C1 engage and release, zero offset left over (no
 * page-tone strip, the old softRelease's permanent -L/2).
 *
 * It also creates the HOLD TRIGGER: a NON-pinning ScrollTrigger over the
 * sticky span [s0, s1] with the id the GSAP pin used ('mac-pin', 'bp-pin',
 * 'photos-pin', 'keypad-pin'), registered as a hold so jumpToSection
 * (`data-jump-progress`) and scroll.ts measureGeom read it like a pin.
 *
 * Geometry: s0 = section doc top (the stage starts flush with the section top
 * and sticks at top 0), s1 = s0 + section height - stage height,
 * L = min(SEAM.holdEdgeVh * vh, SEAM.holdEdgeFrac * (s1 - s0)). The section and
 * its stage are the triggers' only inputs, read by ScrollTrigger at refresh;
 * no JS duplicates a hold length (it is a CSS token).
 *
 * `translate` (not transform) so it composes with anything else on the stage.
 * Reduced motion: holds do not exist (stack.css gates them off, so s1 = s0)
 * and nothing is written. Runs on touch too: the bump is at most L/8 (34px)
 * and smooth, and it is the only scroll-linked write allowed there (spec §0.8).
 */

export interface SoftHold {
  /** The NON-pinning hold trigger over [s0, s1], id = opts.id. */
  st: ScrollTrigger;
  /** Pure: the translate softHold writes at this scroll. */
  offsetAt(scrollY: number): number;
  /** Pure: the stage's on-screen top at this scroll (sticky position + offset). */
  stageTopAt(scrollY: number): number;
  kill(): void;
}

export function softHold(opts: {
  id: string;
  /** In-flow section root (the trigger). */
  section: HTMLElement;
  /** The sticky inner wrapper (gets `translate`). */
  stage: HTMLElement;
  /** Soften the engage edge (default true). */
  engage?: boolean;
  /** Soften the release edge (default true; the keypad never releases). */
  release?: boolean;
}): SoftHold {
  const { id, section, stage } = opts;
  const engage = opts.engage ?? true;
  const release = opts.release ?? true;

  // The hold: sticks when the section top reaches the viewport top, for as long
  // as the section is taller than its stage.
  const hold = ScrollTrigger.create({
    id,
    trigger: section,
    start: "top top",
    end: () => `+=${Math.max(0, section.offsetHeight - stage.offsetHeight)}`,
    invalidateOnRefresh: true,
  });
  registerHold(hold);

  const edge = () => {
    const len = Math.max(0, hold.end - hold.start);
    return Math.min(SEAM.holdEdgeVh * window.innerHeight, SEAM.holdEdgeFrac * len);
  };
  const offsetAt = (s: number) =>
    reducedMotion.value ? 0 : holdOffset(s, hold.start, hold.end, edge(), engage, release);
  const stageTopAt = (s: number) =>
    stageTop(s, hold.start, hold.end, reducedMotion.value ? 0 : edge(), engage, release);

  let last = 0;
  const write = (s: number) => {
    // Half-px dedupe: no write without visible movement.
    const r = Math.round(offsetAt(s) * 2) / 2;
    if (r === last) return;
    last = r;
    stage.style.translate = r ? `0 ${r}px` : "";
  };
  const onScroll = (self: ScrollTrigger) => write(self.scroll());

  // The writer spans both zones, [s0 - L/2, s1 + L/2] (or only the engage zone
  // when there is no release). Created AFTER the hold on the same trigger, so
  // every refresh (scroll.ts orders ties by creation) re-measures the hold
  // first and these functions read its fresh start/end.
  const writer =
    engage || release
      ? ScrollTrigger.create({
          trigger: section,
          start: () => (engage ? hold.start : hold.end) - edge() / 2,
          end: () => (release ? hold.end : hold.start) + edge() / 2,
          invalidateOnRefresh: true,
          onRefresh: onScroll,
          onUpdate: onScroll,
          onEnter: onScroll,
          onLeave: onScroll,
          onEnterBack: onScroll,
          onLeaveBack: onScroll,
        })
      : null;

  // Reduced motion flips the stack.css hold off/on: re-measure, clear or restore.
  const offRm = reducedMotion.subscribe(() => {
    write(window.scrollY);
    requestScrollRefresh();
  });

  return {
    st: hold,
    offsetAt,
    stageTopAt,
    kill() {
      offRm();
      writer?.kill();
      unregisterHold(hold);
      hold.kill();
      last = 0;
      stage.style.translate = "";
    },
  };
}
