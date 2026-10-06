/**
 * Progress curves for seam renders. Every seam render is a pure function of
 * scroll progress (spec §0.3), so these are plain functions of p, never of time.
 */
export { ease } from "../motion";

export const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** Local progress of p across [a, b], clamped: 0 before a, 1 after b. */
export const seg = (p: number, a: number, b: number) =>
  b === a ? (p >= b ? 1 : 0) : clamp01((p - a) / (b - a));

/** Smoothstep of a clamped t. */
export const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * easeOutBack with a SOFT overshoot: the peak is 1 + 4s³ / 27(s+1)², so
 * s = 1.25 tops out at 1.057 (the stock s = 1.70158 overshoots to 1.10). The
 * zero-g rise settles with a tiny bob, never a bounce (spec §5.4: <= 1.06).
 */
const BACK_SOFT = 1.25;
export const outBackSoft = (t: number) => {
  const x = clamp01(t) - 1;
  return 1 + (BACK_SOFT + 1) * x * x * x + BACK_SOFT * x * x;
};
