// Module-level singleton bridging the cursor-driven PaintTrail and any
// non-pointer consumer that wants to stamp the same brush onto the
// same canvas (currently: SignatureReplay).
//
// PaintTrail calls `registerBrush` once with its stamp function on
// mount and `null` on unmount. Other modules call `paintAt(x, y)` to
// stamp paint; calls before registration (or while unmounted) are
// silently dropped.
//
// Keeping the brush mechanics inside PaintTrail (single owner of the
// 2D canvas, RAF loop, fade) keeps the rendering coherent — the
// signature inherits the cursor trail's exact look + fade without
// having to be reimplemented.

type StampFn = (
  x: number,
  y: number,
  radiusOverride?: number,
  alphaMult?: number,
) => void;

// Two independent brushes, two independent canvases:
//   - Cursor brush: PaintTrail canvas. Strokes fade out each frame.
//   - Signature brush: SignatureCanvas. Strokes accumulate forever.
// Keeping them on separate canvases means the per-frame fade on the
// cursor canvas can't dissolve the signature, so the signature stays.

let cursorBrush: StampFn | null = null;
let signatureBrush: StampFn | null = null;

export function registerBrush(fn: StampFn | null): void {
  cursorBrush = fn;
}
export function registerSignatureBrush(fn: StampFn | null): void {
  signatureBrush = fn;
}

export function paintAt(x: number, y: number, radius?: number): void {
  cursorBrush?.(x, y, radius);
}
export function paintSignatureAt(
  x: number,
  y: number,
  radius?: number,
  alphaMult?: number,
): void {
  signatureBrush?.(x, y, radius, alphaMult);
}

export function isBrushReady(): boolean {
  return cursorBrush != null;
}
export function isSignatureBrushReady(): boolean {
  return signatureBrush != null;
}

// Signature canvas fade gate. SignatureReplay turns it ON while
// drawing so each stamp's accumulated alpha gets clamped the same
// way the cursor trail's per-frame fade clamps cursor strokes
// (matches the bauhaus wet-paint look). The moment replay ends, the
// flag flips OFF and the finished signature freezes at its current
// state and stays.
let signatureFadeActive = false;
export function setSignatureFade(active: boolean): void {
  signatureFadeActive = active;
}
export function isSignatureFadeActive(): boolean {
  return signatureFadeActive;
}
