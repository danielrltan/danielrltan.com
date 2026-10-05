import type { LoadStats } from "../loadStats";

/**
 * One loader look. BootLoader (or the lab page) owns the clock and calls
 * frame() every rAF with the shown progress, until destroy(). Variants write
 * straight to the DOM / canvas: no React, no three.js (first paint must not
 * pull the three chunk), at most a few hundred elements.
 */
export interface LoaderVariant {
  /** p: shown progress 0..1, n: the integer shown (100 only once done). */
  frame(now: number, p: number, n: number, s: LoadStats): void;
  destroy(): void;
}

export interface VariantInfo {
  id: number;
  name: string;
  create(host: HTMLElement, reduced: boolean): LoaderVariant;
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
