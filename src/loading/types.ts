// src/loading/types.ts

interface WireframeMesh {
  name: string;
  center: [number, number, number];
  half: [number, number, number];
  /** 1..5: spatial assembly wave this mesh belongs to. */
  phase: number;
}

export interface WireframeManifest {
  version: number;
  generatedAt: string;
  sourceSha: string | null;
  meshes: WireframeMesh[];
}

export interface AssemblyState {
  /** 0..1: driven by Date.now() since mount, paused while tab hidden. */
  timelinePct: number;
  /** 0..1: bytes / total. Stays at 1 once load completes. */
  bytePct: number;
  /** min(timelinePct, bytePct): what the visible bar shows. */
  combinedPct: number;
  /** 1..5: current spatial phase. Derived from combinedPct via THRESHOLDS. */
  phase: number;
  /** Total bytes streamed so far (rounded to 0.1 MB for display). */
  bytesMB: number;
  /** True once timeline finished AND assets ready AND 30 stable frames. */
  climaxReady: boolean;
  /** True once the climax fade has fully completed (wireframes gone). */
  climaxDone: boolean;
}

export const TIMELINE_FLOOR_MS = 2400;
export const STABLE_FRAMES_REQUIRED = 30;
export const STABLE_FRAME_BUDGET_MS = 22;
/** Max time to keep waiting for STABLE_FRAMES_REQUIRED smooth frames AFTER
 *  assets + the timeline floor are satisfied. The "30 smooth frames" gate
 *  is a reveal-without-jank *preference*; on weak hardware the always-on
 *  room canvas (shadows + physics) may never sustain 30 consecutive
 *  sub-22ms frames, which would trap the visitor on the loading screen
 *  forever. Once assets are ready we give smoothness this long to settle,
 *  then proceed regardless. */
export const STABLE_WAIT_TIMEOUT_MS = 3000;
/** Absolute failsafe: never hold the loading screen past this much
 *  wall-clock loading time, no matter what stalls (a silently-failed
 *  asset so drei.active never clears, untracked physics wasm, a lost
 *  WebGL context). Healthy loads finish in ~3-4s, far under this; this is
 *  a last-resort backstop so a visitor is never stuck indefinitely. */
export const HARD_CEILING_MS = 15000;
export const CLIMAX_DURATION_MS = 400;
export const POST_CLIMAX_HUD_FADE_MS = 320;
/** GLB size in MB: display-only. Real bytes come from useProgress.
 *  room.glb is meshopt-compressed with WebP textures via
 *  scripts/optimize-assets.mjs (raw Blender export is ~22.6 MB). */
export const GLB_TOTAL_MB = 4.0;
/** combinedPct thresholds that unlock each phase. Index = phase - 1.
 *  Includes a sixth upper-bound entry so phase 5's window is bounded
 *  Without it, the `?? 1` fallback in ScrollWireframeRoom pushes phase
 *  5 starts up to ~0.97, well past the envelope's 0.48 fade-out, and
 *  phase 4/5 wireframes (57 of 75 meshes) never reach nonzero opacity.
 *  Compresses the whole assembly into the env-positive window so every
 *  phase has a chance to materialize before the 0.48→0.56 dissolve
 *  hands off to the cover-dome room reveal. */
export const PHASE_THRESHOLDS = [0.0, 0.07, 0.16, 0.26, 0.36, 0.47];
