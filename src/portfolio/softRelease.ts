import { ScrollTrigger } from "gsap/ScrollTrigger";
import { reducedMotion } from "../motion";

/**
 * SOFT PIN RELEASE (owner, 2026-10-05: "make releases from pins lighter and
 * more smooth; right now it feels like it snaps off from scroll").
 *
 * A pinned (or sticky-held) section sits dead still for the whole hold, then
 * at the release scroll position it moves at full scroll speed: measured on
 * About, 0 px/s one frame, ~800 px/s the next. That velocity step is the
 * "snap".
 *
 * Over the last L px of the hold the target now drifts up on a quadratic
 * ease-in: offset y(x) = -x² / 2L for x in [0, L] scrolled into that zone. Its
 * on-screen velocity therefore ramps 0 -> scroll speed and arrives at exactly
 * 1:1 on the release frame, so the handoff to normal scrolling has no step.
 * After the release the offset stays at -L/2. Nothing about the page's layout
 * or scroll length changes: the content just leaves L/2 earlier, opening an
 * L/2 strip of the section's own (page-coloured) ground below it.
 *
 * Applied as the CSS `translate` property, which composes with (and is never
 * overwritten by) the transform GSAP's pinning writes. Off under reduced
 * motion.
 */

/** Release zone length: this fraction of the viewport height… */
const RELEASE_VH = 0.3;
/** …but never more than this fraction of the hold itself. */
const MAX_HOLD_FRAC = 0.4;

export function softRelease(opts: {
  trigger: Element;
  /** Scroll position where the hold starts / ends (numbers, live). */
  start: () => number;
  end: () => number;
  /** The element that moves (the pinned element, or the sticky stage). */
  target: HTMLElement;
}): () => void {
  const { trigger, start, end, target } = opts;
  if (reducedMotion.value) return () => {};
  let last = NaN;
  const apply = (self: ScrollTrigger) => {
    const len = self.end - self.start;
    const L = Math.min(window.innerHeight * RELEASE_VH, len * MAX_HOLD_FRAC);
    let y = 0;
    if (L > 0) {
      const into = self.progress * len;
      const x = Math.min(L, Math.max(0, into - (len - L)));
      y = -(x * x) / (2 * L);
    }
    const dpr = window.devicePixelRatio || 1;
    const r = Math.round(y * dpr) / dpr;
    if (r === last) return;
    last = r;
    target.style.translate = r ? `0 ${r}px` : "";
  };
  const st = ScrollTrigger.create({
    trigger,
    start,
    end,
    invalidateOnRefresh: true,
    onUpdate: apply,
    onRefresh: apply,
    onLeave: apply,
    onEnterBack: apply,
    onLeaveBack: apply,
  });
  return () => {
    st.kill();
    target.style.translate = "";
  };
}

/** Soft release for a GSAP pin: follows the pin's own start / end. */
export function softReleasePin(pin: ScrollTrigger): () => void {
  const target = pin.pin as HTMLElement | undefined;
  if (!target || !pin.trigger) return () => {};
  return softRelease({ trigger: pin.trigger, start: () => pin.start, end: () => pin.end, target });
}
