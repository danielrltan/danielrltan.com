/**
 * Where the hero signature sits on screen. Pure math, no three.js, so the
 * static fallback (low tier / reduced motion) lays the words out exactly like
 * the WebGL hero does.
 *
 * The 3D signature is fitted to a fraction of the viewport width (capped by
 * height) and lifted SIG_CENTER_Y of the height above centre. The returned box
 * is its on-screen rect, padded for the tube's thickness + idle tilt; the
 * words ("hello", "I'm Daniel Tan", "software engineer & designer") sit around
 * it and heroWipe.ts keeps the iris hole off it (.hero-name-box).
 */
export const SIG_CENTER_Y = 0.035;

export interface SigBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
  /** Unpadded signature height in px. */
  height: number;
  /** Phone-width layout: the words move to the gutters. */
  narrow: boolean;
}

export function isNarrow(w: number): boolean {
  return w < 700;
}

/**
 * Signature height as a fraction of the viewport height (the 3D scene scales
 * its group by this x the visible world height, so both stay in sync).
 */
export function sigHeightFrac(w: number, h: number, aspect: number): number {
  const narrow = isNarrow(w);
  const widthFrac = narrow ? 0.9 : 0.5;
  return Math.min(((w / h) * widthFrac) / aspect, narrow ? 0.34 : 0.5);
}

export function signatureBox(w: number, h: number, aspect: number): SigBox {
  const hf = sigHeightFrac(w, h, aspect);
  const wf = (hf * aspect * h) / w;
  const cy = 0.5 - SIG_CENTER_Y;
  const pad = hf * h * 0.1;
  return {
    left: (0.5 - wf * 0.5) * w,
    right: (0.5 + wf * 0.5) * w,
    top: (cy - hf * 0.5) * h - pad,
    bottom: (cy + hf * 0.5) * h + pad,
    height: hf * h,
    narrow: isNarrow(w),
  };
}
