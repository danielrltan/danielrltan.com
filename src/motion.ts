// src/motion.ts: motion tokens (mirror of the :root motion block in src/index.css).
// Seconds unless suffixed _MS. SSR-safe (guards window).

export const DUR = {
  press: 0.12, fast: 0.18, base: 0.28, med: 0.4, morph: 0.42, slow: 0.54,
  handoff: 0.32, coverIn: 0.12, coverOut: 0.2,
} as const;
export const toMs = (s: number) => Math.round(s * 1000);
export const STAGGER = 0.06;
export const STAGGER_MAX_STEPS = 5;
export const REVEAL_LIFT_PX = 16;
export const CHROME_LIFT_PX = 8;

export const EASE_CSS = {
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  in: "cubic-bezier(0.55, 0, 1, 0.45)",
  bounce: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  soft: "cubic-bezier(0.2, 0.7, 0.2, 1)",        // legacy, do not use in new code
  entrance: "cubic-bezier(0.22, 0.61, 0.36, 1)", // legacy, do not use in new code
  steps4: "steps(4, jump-end)",
} as const;

/** Exact CSS cubic-bezier in JS (Newton-Raphson with bisection fallback), so JS and CSS curves match. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) { const e = sx(t) - x; const d = dx(t); if (Math.abs(e) < 1e-5) return sy(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 20; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-5) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
    return sy(t);
  };
}

export const ease = {
  linear: (t: number) => t,
  out: cubicBezier(0.22, 1, 0.36, 1),
  inOut: cubicBezier(0.65, 0, 0.35, 1),
  in: cubicBezier(0.55, 0, 1, 0.45),
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inCubic: (t: number) => t * t * t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outQuart: (t: number) => 1 - (1 - t) ** 4,
  inQuad: (t: number) => t * t,
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
  outBack: (t: number, s = 1.70158) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
  expoOut: (t: number) => Math.min(1, 1.001 - 2 ** (-10 * t)), // Lenis wheel curve ONLY
};
/** GSAP ease strings (no CustomEase plugin on the site). */
export const GSAP_EASE = { inOut: "power2.inOut", settle: "sine.inOut", out: "power3.out", in: "power2.in" } as const;

/** Exponential decay rates, per second: use with damp(). τ = 1/rate. */
export const DECAY = {
  press: 40,    // τ 25ms: press-down dips
  snap: 24,     // τ 42ms: near-rigid followers (hero dive follower)
  fast: 18,     // τ 55ms: UI followers, press release
  follow: 12,   // τ 83ms: scroll-progress followers (≈ Lenis λ 11.5); touch-only Mac progress
  standard: 10, // τ 100ms: hover weights, signature lerp
  soft: 6,      // τ 167ms: parallax, orbit ring, photo trains
  lazy: 4,      // τ 250ms: ambient glows
} as const;
export const MAX_DT = 0.1;
export const clampDt = (dt: number) => Math.min(Math.max(dt, 0), MAX_DT);
export const damp = (cur: number, target: number, rate: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-rate * clampDt(dt)));
/** Linear rate cap: move toward target by at most maxPerSec*dt. */
export const approach = (cur: number, target: number, maxPerSec: number, dt: number) => {
  const s = maxPerSec * clampDt(dt);
  return cur + Math.max(-s, Math.min(s, target - cur));
};
/** Critically/under-damped spring step (semi-implicit Euler, sub-stepped at <=1/240s). Returns [x, v]. */
export function stepSpring(x: number, v: number, target: number, dt: number, omega: number, zeta = 1): [number, number] {
  let rem = clampDt(dt);
  while (rem > 0) {
    const h = Math.min(rem, 1 / 240);
    v += (-2 * zeta * omega * v - omega * omega * (x - target)) * h;
    x += v * h; rem -= h;
  }
  return [x, v];
}
export const SPRING = { dial: { omega: 20, zeta: 1 } } as const;

/** Lenis wheel config: unchanged values, now named. */
export const LENIS = { duration: 0.6, easing: ease.expoOut, smoothWheel: true, wheelMultiplier: 1, syncTouch: false, touchMultiplier: 1 } as const;
/** Numeric ScrollTrigger scrub is banned site-wide (rule 1). Documented here so reviewers can grep. */
export const SCRUB = false as const;

/** Programmatic scroll presets (consumed by src/scroll.ts). duration = clamp(base + perVh*|Δ|/vh, min, max). */
export const SCROLL = {
  cutThresholdVh: 3,
  glide: { base: 0.4, perVh: 0.14, min: 0.45, max: 0.9, easing: ease.inOutCubic },
  nudge: { base: 0.3, perVh: 0.2, min: 0.3, max: 0.45, easing: ease.outCubic },
} as const;
export function presetDuration(dyPx: number, vh: number, p: { base: number; perVh: number; min: number; max: number }, maxOverride?: number) {
  const d = p.base + p.perVh * (Math.abs(dyPx) / Math.max(1, vh));
  return Math.min(maxOverride ?? p.max, Math.max(p.min, d));
}

/** Hero <-> About contract (see spec §3). Raw = Lenis-smoothed window.scrollY / innerHeight. */
export const HERO = {
  diveStartVh: 0.06, diveEndVh: 0.7,   // raw dive window
  diveMinSec: 0.35,                    // full dive can never play faster than this (flick cap)
  handoffVh: 0.78, showVh: 0.74,       // clear starts at/after handoffVh; returns below showVh
  clearByVh: 0.98,                     // hero fully clear by max(clearByVh, handoffStart + DUR.handoff)
  hudRevealVh: 1.0,
} as const;

// phone: the room-render cut (MQ.roomless below). mobile/narrow unchanged: useIsMobile / About+Work+Mac narrow.
export const BREAKPOINT = { phone: 600, mobile: 768, narrow: 900 } as const;

/**
 * The site's media queries, in one place (CSS mirrors these by hand; keep them in lockstep).
 * - compact: phone-sized, OR any short landscape screen (a phone on its side: 844-932 x 390-430).
 *   A sideways phone is still a phone: it gets the stacked layout, the 2D fallbacks and the
 *   touch HUD, never the pinned desktop scenes sized for a tall window.
 * - narrow: the 900px stacked cut-over (About / Work / Projects), plus short landscape.
 * - roomless: where About drops its room render and the hero fades instead of opening the pixel
 *   iris onto it: <=600 wide, or a phone on its side. Tablets (601-900, incl. iPad mini portrait)
 *   keep the room as the first stacked cell and get the iris.
 * - finePointer: a real mouse or trackpad. Gate cursors and hover-only effects on this, never on width.
 */
const SHORT_LANDSCAPE = "(orientation: landscape) and (max-height: 500px)";
export const MQ = {
  phone: `(max-width: ${BREAKPOINT.mobile}px)`,
  shortLandscape: SHORT_LANDSCAPE,
  compact: `(max-width: ${BREAKPOINT.mobile}px), ${SHORT_LANDSCAPE}`,
  narrow: `(max-width: ${BREAKPOINT.narrow}px), ${SHORT_LANDSCAPE}`,
  roomless: `(max-width: ${BREAKPOINT.phone}px), ${SHORT_LANDSCAPE}`,
  finePointer: "(hover: hover) and (pointer: fine)",
  touchPrimary: "(hover: none) and (pointer: coarse)",
} as const;
export const matches = (q: string) => typeof window !== "undefined" && !!window.matchMedia?.(q).matches;

/** Live prefers-reduced-motion (reacts to OS toggles; replaces the ~20 module-load reads over time). */
export const reducedMotion = (() => {
  const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let value = !!mq?.matches;
  const subs = new Set<(v: boolean) => void>();
  mq?.addEventListener?.("change", (e) => { value = e.matches; subs.forEach((f) => f(value)); });
  return { get value() { return value; }, subscribe(f: (v: boolean) => void) { subs.add(f); return () => { subs.delete(f); }; } };
})();
export const isCoarsePointer = () => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
