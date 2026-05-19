// src/loading/types.ts

export interface WireframeMesh {
  name: string;
  center: [number, number, number];
  half: [number, number, number];
  /** 1..5 — spatial assembly wave this mesh belongs to. */
  phase: number;
}

export interface WireframeManifest {
  version: number;
  generatedAt: string;
  sourceSha: string | null;
  meshes: WireframeMesh[];
}

export interface AssemblyState {
  /** 0..1 — driven by Date.now() since mount, paused while tab hidden. */
  timelinePct: number;
  /** 0..1 — bytes / total. Stays at 1 once load completes. */
  bytePct: number;
  /** min(timelinePct, bytePct) — what the visible bar shows. */
  combinedPct: number;
  /** 1..5 — current spatial phase. Derived from combinedPct via THRESHOLDS. */
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
/** GLB size in MB — display-only. Real bytes come from useProgress. */
export const GLB_TOTAL_MB = 27.4;
/** combinedPct thresholds that unlock each phase. Index = phase - 1. */
export const PHASE_THRESHOLDS = [0.0, 0.15, 0.4, 0.6, 0.8];
