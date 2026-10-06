import type { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Hold triggers: the NON-pinning ScrollTriggers that mark a sticky hold's
 * [s0, s1] span ('mac-pin', 'bp-pin', 'photos-pin', 'keypad-pin', created by
 * softHold). They keep the ids the GSAP pins used, so jumpToSection
 * (`pinId` + `data-jump-progress`) lands inside a hold exactly as before, and
 * scroll.ts measureGeom treats them as pins when it keeps the reader's beat
 * across a resize.
 *
 * No runtime imports (type-only above): scroll.ts imports this file directly,
 * never the ./seams barrel, so there is no seam.ts <-> scroll.ts module cycle.
 */
const holds = new WeakSet<ScrollTrigger>();

export function registerHold(st: ScrollTrigger): void {
  holds.add(st);
}

export function unregisterHold(st: ScrollTrigger): void {
  holds.delete(st);
}

export function isHoldTrigger(st: ScrollTrigger): boolean {
  return holds.has(st);
}
