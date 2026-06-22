// src/loading/types.ts

export interface AssemblyState {
  /** 0..1: driven by Date.now() since mount, paused while tab hidden. */
  timelinePct: number;
  /** 0..1: bytes / total. Stays at 1 once load completes. */
  bytePct: number;
  /** min(timelinePct, bytePct): what the visible bar shows. */
  combinedPct: number;
  /** Total bytes streamed so far (rounded to 0.1 MB for display). */
  bytesMB: number;
  /** True once timeline finished AND assets ready AND stable frames:
   *  the loader has hit 100%. The loader plays its outro from here. */
  climaxReady: boolean;
  /** True once the loader's progress run finished AND its outro
   *  (LOADER_OUTRO_MS) elapsed — the moment the hero signature may START
   *  drawing. This is the seam that sequences loader → signature (the
   *  signature used to draw concurrently with the loading timeline). */
  loaderDone: boolean;
  /** rAF terminal early-out (loader math is stable past this). NO LONGER
   *  drives the page unlock — html.loading-active now drops when the hero
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
/** Max time to keep waiting for STABLE_FRAMES_REQUIRED smooth frames AFTER
 *  assets + the timeline floor are satisfied. The "30 smooth frames" gate
 *  is a reveal-without-jank *preference*; on weak hardware the always-on
 *  room canvas (shadows + physics) may never sustain 30 consecutive
 *  sub-22ms frames, which would trap the visitor on the loading screen
 *  forever. Once assets are ready we give smoothness this long to settle,
 *  then proceed regardless. */
export const STABLE_WAIT_TIMEOUT_MS = 600;
/** Absolute failsafe: never hold the loading screen past this much
 *  wall-clock loading time, no matter what stalls (a silently-failed
 *  asset so drei.active never clears, untracked physics wasm, a lost
 *  WebGL context). Healthy loads finish in ~3-4s, far under this; this is
 *  a last-resort backstop so a visitor is never stuck indefinitely. */
export const HARD_CEILING_MS = 15000;
export const CLIMAX_DURATION_MS = 400;
export const POST_CLIMAX_HUD_FADE_MS = 320;
/** Display-only divisor for the loader's byte readout. */
export const GLB_TOTAL_MB = 4.0;
