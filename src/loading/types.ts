// src/loading/types.ts
import { DUR, toMs } from "../motion";

export interface AssemblyState {
  /** 0..1: what the visible counter shows. Elapsed / TIMELINE_FLOOR_MS since
   *  mount, paused while the tab is hidden. (There is no eager asset to
   *  track any more; the loader is purely a paced timeline.) */
  combinedPct: number;
  /** True once the timeline finished AND enough stable frames ran (or the
   *  failsafes fired): the loader has hit 100%. It plays its outro from here. */
  climaxReady: boolean;
  /** True once the loader's progress run finished AND its outro
   *  (LOADER_OUTRO_MS) elapsed — the moment the hero signature may START
   *  drawing. This is the seam that sequences loader → signature (the
   *  signature used to draw concurrently with the loading timeline). */
  loaderDone: boolean;
  /** rAF terminal early-out (loader math is stable past this). Does not
   *  drive the page unlock — html.loading-active drops when the hero
   *  composition settles (see AssemblyController). */
  climaxDone: boolean;
}

/** Minimum wall-clock the loader's 0→100 run takes (the progress bar is
 *  driven by elapsed / this). The heavy 27MB room GLB was removed, so the
 *  load is now trivial and this is purely a pacing floor: long enough for
 *  the pixel meter to read as a deliberate fill, short enough that the
 *  signature (which now plays AFTER the loader, not concurrently) isn't
 *  kept waiting. Was 2400 (tuned for the old wireframe-assembly beat). */
export const TIMELINE_FLOOR_MS = 1200;
/** Consecutive sub-budget frames preferred before declaring the scene
 *  smooth. Lowered from 30: the always-on 3D room (shadows + physics) that
 *  made 30 hard to sustain is gone; only the hero ring canvas renders now,
 *  so a shorter streak is plenty and keeps climaxReady from lagging. */
export const STABLE_FRAMES_REQUIRED = 18;
export const STABLE_FRAME_BUDGET_MS = 22;
/** Time the loader's outro (dim + lift) is given before the signature
 *  starts. loaderDone fires LOADER_OUTRO_MS after climaxReady; the
 *  BootLoader's CSS lift is slightly shorter so it has fully faded out
 *  by the time the signature draws onto the bare orange field. */
export const LOADER_OUTRO_MS = 440;
/** Absolute failsafe for the page unlock: html.loading-active is normally
 *  removed when the hero composition settles, but if that signal never
 *  arrives (an unforeseen stall in the compose path) the scrim is lifted
 *  this long after the loader completes so a visitor is never trapped. */
export const UNLOCK_FAILSAFE_MS = 5000;
/** Loading INTRO reveal (owner: hold the "100", then fade the loader out to
 *  reveal the hero that composed BEHIND it — a real crossfade — and keep scroll
 *  locked until that's done). HERO_HOLD_MS: the minimum the "100" sits on screen
 *  after it reaches 100 before the reveal can start (it ALSO waits for the
 *  `hero-composed` signal, whichever is later). LOADER_FADE_MS: the scrim
 *  fade-out duration, one shared token with the .boot-loader CSS transition
 *  (DUR.slow = --t-slow, 540 ms). REVEAL_FAILSAFE_MS: reveal anyway if
 *  `hero-composed` never arrives.
 *
 *  HERO_HOLD_MS 700 → 500 (motion spec §4.13): the hero's entrance now plays
 *  OVER the fading scrim (`loader-reveal-start`), so the "100" needs less
 *  standing time before the crossfade reads as deliberate. Owner-tunable. */
export const HERO_HOLD_MS = 500;
export const LOADER_FADE_MS = toMs(DUR.slow);
export const REVEAL_FAILSAFE_MS = 2600;
/** Scroll stays LOCKED this long AFTER the loader has fully faded out (the hero
 *  is already revealed), so the user can settle into the hero and process it
 *  before scrolling becomes possible — instead of being "launched abruptly" the
 *  instant the fade ends (owner-flagged). Tunable beat.
 *
 *  900 → 400 (motion spec §4.13): shortened, not removed. With the hero
 *  entrance now visible through the fade, a 900 ms lock after all motion had
 *  stopped read as a dead page. Owner-tunable. */
export const POST_REVEAL_HOLD_MS = 400;
/** Max time to keep waiting for STABLE_FRAMES_REQUIRED smooth frames AFTER
 *  the timeline floor is satisfied. The smooth-frames gate is a
 *  reveal-without-jank *preference*; on weak hardware the hero ring may
 *  never sustain the streak, which would trap the visitor on the loading
 *  screen. Once the timeline is done we give smoothness this long to
 *  settle, then proceed regardless. */
export const STABLE_WAIT_TIMEOUT_MS = 600;
/** Absolute failsafe: never hold the loading screen past this much
 *  wall-clock loading time, no matter what stalls (a lost WebGL context, a
 *  throttled background tab). Healthy loads finish in ~3-4s, far under
 *  this; a last-resort backstop so a visitor is never stuck indefinitely. */
export const HARD_CEILING_MS = 15000;
/** STALE NAMES, kept to avoid churn: there is no "climax" animation or HUD fade
 *  any more. Their only job is their SUM: `climaxDone` (useAssemblyProgress)
 *  fires CLIMAX_DURATION_MS + POST_CLIMAX_HUD_FADE_MS (720 ms) after
 *  climaxReady, and that is purely the progress loop's terminal early-out. It
 *  gates nothing visible (the page unlock rides `loader-revealed`). */
export const CLIMAX_DURATION_MS = 400;
export const POST_CLIMAX_HUD_FADE_MS = 320;
