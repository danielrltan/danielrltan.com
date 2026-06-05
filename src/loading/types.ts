// src/loading/types.ts

export interface WireframeMesh {
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
export const CLIMAX_DURATION_MS = 400;
export const POST_CLIMAX_HUD_FADE_MS = 320;
/** GLB size in MB: display-only. Real bytes come from useProgress. */
export const GLB_TOTAL_MB = 27.4;
/** combinedPct thresholds that unlock each phase. Index = phase - 1.
 *  Includes a sixth upper-bound entry so phase 5's window is bounded
 *  Without it, the `?? 1` fallback in ScrollWireframeRoom pushes phase
 *  5 starts up to ~0.97, well past the envelope's 0.48 fade-out, and
 *  phase 4/5 wireframes (57 of 75 meshes) never reach nonzero opacity.
 *  Compresses the whole assembly into the env-positive window so every
 *  phase has a chance to materialize before the 0.48→0.56 dissolve
 *  hands off to the cover-dome room reveal. */
export const PHASE_THRESHOLDS = [0.0, 0.06, 0.14, 0.22, 0.30, 0.40];
