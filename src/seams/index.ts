/**
 * Section seams: the shared primitive for every section-to-section transition
 * (spec .scratch/seams/SPEC.md §4). Sections import from here; scroll.ts
 * imports ./holds directly (never this barrel) to stay out of a module cycle.
 * The layout contract is ./stack.css, imported once by App.tsx.
 */
export { mountSeam, useSeam } from "./seam";
export type { SeamDef, SeamCtx, SeamId } from "./seam";
export { softHold } from "./softHold";
export type { SoftHold } from "./softHold";
export { holdOffset, stageTop } from "./holdMath";
export { oneShot } from "./oneShot";
export { claimOverlay, releaseOverlay, overlayOwner } from "./overlay";
export { SeamLayer } from "./SeamLayer";
export { BAYER4, bayer4, bayer8, hash2, snap, columnHeights, pixelCircle, cellMask } from "./pixel";
export type { CellMaskOpts } from "./pixel";
export { seg, smooth, clamp01, lerp, outBackSoft, ease } from "./curves";
export { seamBus } from "./bus";
export { registerHold, unregisterHold, isHoldTrigger } from "./holds";
export { SEAM, SEAM_MQ } from "../motion";
