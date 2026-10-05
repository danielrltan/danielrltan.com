import type { LoadStats } from "../loadStats";

/**
 * One loader look. BootLoader (or the lab page) owns the clock and calls
 * frame() every rAF with the shown progress, until destroy(). Variants write
 * straight to the DOM / canvas: no React, no three.js (first paint must not
 * pull the three chunk), at most a few hundred elements.
 */
export interface LoaderVariant {
  /** p: shown progress 0..1, n: the integer shown (100 only once done).
   *  exit: 0 until the reveal starts, then 0..1 across LOADER_FADE_MS. */
  frame(now: number, p: number, n: number, s: LoadStats, exit: number): void;
  destroy(): void;
}

export interface VariantInfo {
  id: number;
  name: string;
  create(host: HTMLElement, reduced: boolean): LoaderVariant;
  /** The variant paints its own orange field and plays its own exit (iris,
   *  fly-off) over the revealed hero, instead of the scrim's opacity fade. */
  ownsExit?: boolean;
}

export const INK = "#ffffff";
export const ORANGE = "#ff4f00";

/** Text node writer that skips unchanged values (one DOM write per change). */
export function textSlot(el: HTMLElement) {
  let last = "";
  return (s: string) => {
    if (s !== last) {
      last = s;
      el.textContent = s;
    }
  };
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

/** Full-host 2D canvas, DPR capped at 2, refit on resize. */
export function hostCanvas(host: HTMLElement) {
  const c = el("canvas", "ldr-canvas", host);
  const ctx = c.getContext("2d")!;
  const box = { w: 1, h: 1 };
  const fit = () => {
    const r = host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    box.w = Math.max(1, r.width);
    box.h = Math.max(1, r.height);
    c.width = Math.round(box.w * dpr);
    c.height = Math.round(box.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(host);
  return {
    ctx,
    box,
    destroy() {
      ro.disconnect();
      c.remove();
    },
  };
}

/** Mix two #rrggbb colours, t in 0..1. */
export function mix(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number) =>
    Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

/** Damped spring step (semi-implicit Euler). zeta < 1 overshoots. */
export function spring(
  st: { x: number; v: number },
  target: number,
  dt: number,
  k = 170,
  zeta = 0.6,
) {
  st.v += (k * (target - st.x) - 2 * zeta * Math.sqrt(k) * st.v) * dt;
  st.x += st.v * dt;
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const inOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
export const outCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const inCubic = (t: number) => t * t * t;

/** Frame-time delta in seconds, clamped so a stalled tab doesn't explode a
 *  spring. */
export function clock() {
  let last = -1;
  return (now: number) => {
    const dt = last < 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
    last = now;
    return dt;
  };
}

/** Network rate → 0..1 "wind", log scale 20 KB/s .. 10 MB/s; cached = 0.35. */
export const rateLevel = (bps: number) =>
  bps > 0 ? clamp01(Math.log10(bps / 2e4) / 2.7) : 0.35;

/** Fill a polygon of projected points. */
export function poly(ctx: CanvasRenderingContext2D, pts: number[][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}
