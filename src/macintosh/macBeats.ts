/**
 * The Projects (Mac) beat map, in CINE vh (spec .scratch/seams/SPEC.md §5.2).
 *
 * Seam overhaul, 2026-10-06: the GSAP mac-pin (4.0vh + a landed magnet) is
 * gone. .portfolio-mac is now a tall in-flow section whose inner .mac-sticky
 * holds for --seam-mac-hold (H, 240svh; src/seams/stack.css), and on desktop
 * the section rises 1:1 over a still About as an opaque sheet (the curtain).
 * One number drives the whole cinematic: c = (scrollY - (macTop - vh)) / vh,
 * the scroll since the sheet's top edge entered at the viewport bottom.
 *   c 0 -> 1        the sheet rises (the Mac arrives already orbiting)
 *   c 1 -> 1 + H    the sticky hold
 *   c > 1 + H       the stage scrolls away 1:1
 * Macintosh.tsx writes c; MacintoshScene reads it; macRelay.ts reads the end.
 *
 * Kept free of three/React so Macintosh.tsx can import it without pulling
 * the lazy scene chunk into the first-paint bundle.
 */

export const MAC_BEATS = {
  /** ENTRY cue: the camera settles z 9.0 -> 8.5 while the sheet rises. */
  entryEnd: 0.24,
  /**
   * ORBIT: 0.6π over 1.765vh = 1588px at 900 tall, the owner-approved
   * ~0.068°/px. 900px of it pre-rolls on the rising sheet.
   */
  orbitStart: 0,
  orbitEnd: 1.765,
  /** Orbit cards dissolve (fade, drift, shrink). */
  dissolveStart: 1.35,
  dissolveEnd: 1.7,
  /** "Projects" header fades out before the CRT fills the frame. */
  headFadeStart: 1.35,
  headFadeEnd: 1.55,
  /** The float click-to-zoom hitbox is live only before the landing commits. */
  floatClickEnd: 1.4,
  /** Cursor parallax / idle sway damps to square-on. */
  spinSettleStart: 1.4,
  spinSettleEnd: 1.62,
  /** Camera dolly 8.5 -> 2.6 (the landing). */
  dollyStart: 1.4,
  dollyEnd: 2.1,
  /** Mac descent + float-tilt unwind (one landing motion with the dolly). */
  descentStart: 1.44,
  descentEnd: 2.04,
  /** CRT boot type-in; the screensaver hands over here. bootEnd = landed. */
  bootStart: 1.98,
  bootEnd: 2.25,
  /** Detail-zoom gate slack (landings on integer scroll px can sit a hair short). */
  canOpenEps: 0.005,
  /**
   * The exit is anchored to the hold END (1 + H), so a longer hold (gate G1's
   * 220svh fallback) only lengthens the landed dwell, never the exit:
   *   power-off (picture -> hot line -> dot): [end - 0.18, end - 0.02]
   *   shader dot fades under the relay pixel:  [end - 0.06, end]
   */
  powerOffLead: 0.18,
  powerOffTail: 0.02,
  dotFadeLead: 0.06,
} as const;

/** The hold end (1 + H) at the shipped H = 2.4 (--seam-mac-hold: 240svh). Used until layout is read. */
export const MAC_CINE_END_DEFAULT = 3.4;

/** The landed pose: the middle of the landed dwell (2.735 at H 2.4). Menu/footer jumps, the CTA glide and the static (narrow / reduced-motion) frame all show it. */
export const macLandedC = (end: number) =>
  (MAC_BEATS.bootEnd + (end - MAC_BEATS.powerOffLead)) / 2;

/** data-jump-progress on .portfolio-mac: the landed pose as a fraction of the hold (0.723 at H 2.4). */
export const macJumpProgress = (end: number) =>
  end > 1 ? (macLandedC(end) - 1) / (end - 1) : 0;

export type MacBeat = "orbit" | "land" | "landed" | "poweroff";
export function macBeat(c: number, end: number): MacBeat {
  if (c < MAC_BEATS.floatClickEnd) return "orbit";
  if (c < MAC_BEATS.bootEnd) return "land";
  if (c < end - MAC_BEATS.powerOffLead) return "landed";
  return "poweroff";
}

/**
 * The cine state Macintosh.tsx writes (ScrollTrigger callbacks, no React
 * state) and MacintoshScene reads every frame.
 * - c: cine vh (above), clamped to [0, end].
 * - end: 1 + H, read from layout on refresh.
 * - live: false once the sticky stage has scrolled fully above the viewport
 *   (the scene stops drawing; an IntersectionObserver margin would keep it
 *   running for another ~0.1vh of invisible canvas).
 * - wake: set by the scene's canvas; pokes its demand frame loop back to life
 *   when `live` turns true again.
 */
export interface MacCine {
  c: number;
  end: number;
  live: boolean;
  wake: (() => void) | null;
}
