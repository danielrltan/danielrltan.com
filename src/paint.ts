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

type StampFn = (x: number, y: number, radiusOverride?: number) => void;

let active: StampFn | null = null;

export function registerBrush(fn: StampFn | null): void {
  active = fn;
}

export function paintAt(x: number, y: number, radius?: number): void {
  active?.(x, y, radius);
}

export function isBrushReady(): boolean {
  return active != null;
}
