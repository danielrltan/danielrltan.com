import { useState } from "react";

/**
 * ONE coherent device-capability tier, resolved ONCE synchronously before React
 * mounts (see initTier(), called from main.tsx) and written as `data-tier` on
 * <html>. It is the single source of truth that gates the heaviest WebGL/SVG
 * costs on weak hardware while leaving capable hardware byte-identical.
 *
 * WHY pre-paint + synchronous: the hero ring (the single heaviest first-screen
 * feature) is a lazy three.js chunk. If we classified in a post-mount effect,
 * that chunk could already begin importing/compiling before a 'low' verdict
 * lands — a flash of the heavy ring then a swap, plus a wasted shader compile on
 * exactly the weakest GPUs. Resolving here, before createRoot, lets the hero
 * mount-time branch pick the static fallback so three.js never imports on low.
 *
 * PROBE PHILOSOPHY — DOWNGRADE-ONLY: start 'standard' and only ever drop to
 * 'low' on a PRESENT weak signal. Missing APIs (Safari/Firefox expose no
 * deviceMemory) must NEVER force low. False negatives (missing a weak GPU) are
 * safe — they just leave it 'standard'; false positives that demote capable
 * hardware are the thing to avoid, so the renderer denylist is deliberately
 * tight (Iris Xe, UHD 620/630/650, Apple, bare 'Mesa'/desktop-Linux are all
 * explicitly NOT matched).
 *
 * ...WITH ONE EXCEPTION worth knowing before you touch a threshold: "a false
 * negative is safe" holds only where 'low' selects a cheaper FALLBACK (the hero
 * ring, the Hobbies DPR cap) — there, over-rating a device just forgoes a
 * saving. In useSectionCanvasMount 'low' is instead a PROTECTION (it routes to
 * the approach-gate rather than mounting every section canvas eagerly), so
 * there an over-rating is a real regression. That consumer therefore gates on
 * isTouchPrimary() as well as the tier, rather than trusting 'low' to stand in
 * for "shouldn't hold four WebGL contexts at once".
 *
 * FAIL-LOUD: the low tier must be served by REAL, visibly-intentional fallbacks
 * (a static brand-equivalent hero ring, the same DOM section fallbacks phones
 * already get) — never a blank gap or a silent cheap fake. A data-tier attribute
 * with nothing reading it would be an inert no-op.
 */

export type Tier = "low" | "standard" | "high";

const ORDER: Tier[] = ["low", "standard", "high"];
const rank = (t: Tier) => ORDER.indexOf(t);
const lowerOf = (a: Tier, b: Tier): Tier => (rank(a) <= rank(b) ? a : b);

// A janky session demotes the NEXT load (see demoteTier). Session-scoped so it
// resets in a fresh tab — a one-off GC stall shouldn't brand the machine forever.
const STORE_KEY = "perfTier";

function readPersistedDemote(): Tier | null {
  try {
    const s = sessionStorage.getItem(STORE_KEY);
    return s === "low" || s === "standard" || s === "high" ? (s as Tier) : null;
  } catch {
    return null;
  }
}

/** UNMASKED_RENDERER from a throwaway 1x1 GL context, then release it. */
function rendererString(): string | null {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl") ||
      c.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const raw = dbg
      ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return typeof raw === "string" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * TIGHT software / old-weak-iGPU denylist. Downgrade-only, so a missed weak GPU
 * just stays 'standard' (safe). Must NOT match capable parts: Iris/Iris Xe,
 * UHD 620/630/650, Apple, and bare 'Mesa'/desktop-Linux are explicitly excluded.
 */
function isWeakRenderer(r: string): boolean {
  const s = r.toLowerCase();
  // Software rasterizers (incl. headless): always weak.
  if (/swiftshader|llvmpipe|softpipe|microsoft basic render|software/.test(s))
    return true;
  if (/intel/.test(s)) {
    if (/iris/.test(s)) return false; // Iris / Iris Plus / Iris Xe are fine
    if (/uhd graphics 6[2-5]0/.test(s)) return false; // 620/630/650 are fine
    // Bare "HD Graphics" (no model number) → ancient.
    const afterHd = s.split("hd graphics")[1] ?? "";
    if (/\bhd graphics\b/.test(s) && !/\d/.test(afterHd.slice(0, 6))) return true;
    if (/hd graphics [3-5]\d{3}/.test(s)) return true; // HD 3000–5xxx
    if (/(hd|uhd) graphics 5\d{2}/.test(s)) return true; // HD/UHD 5xx
    if (/uhd graphics 60[05]/.test(s)) return true; // UHD 600 / 605
  }
  // OLD MOBILE PARTS. Same discipline as the Intel ladder above: name only
  // genuinely old (pre-~2018) silicon, never a whole vendor. This is now the
  // main route to 'low' for a weak phone, since the cores rule no longer
  // applies on touch and the memory floor there is <=2 — without it, an old
  // 4GB handset would read 'standard'. Current parts are deliberately NOT
  // matched: Adreno 6xx/7xx/8xx, every Mali-G, and Apple GPU all fall through
  // to 'standard'. A missed weak GPU just stays 'standard' (safe,
  // downgrade-only); a false match would demote capable hardware and recreate
  // the static-ring bug, so anything uncertain is left out.
  if (/adreno \(tm\) [2-5]\d{2}/.test(s)) return true; // Adreno 2xx–5xx
  if (/mali-t\d{3}/.test(s)) return true; // Mali-T6xx/T7xx/T8xx (Mali-G untouched)
  if (/mali-4\d{2}/.test(s)) return true; // Mali-400 era
  if (/powervr (sgx|rogue)/.test(s)) return true; // PowerVR SGX / Rogue
  return false;
}

let touchPrimaryCache: boolean | null = null;

/**
 * TOUCH-PRIMARY: a device whose PRIMARY input is a finger — phones and tablets.
 *
 * The ANDed query is deliberate and load-bearing. A touchscreen Windows laptop
 * has a trackpad, so it reports hover:hover / pointer:fine as its primary input
 * and does NOT match — it stays on the desktop rules and keeps the low-tier
 * protection this file exists to give it. A bare `(pointer: coarse)`, or
 * maxTouchPoints / "ontouchstart", would rescue exactly that weak hardware and
 * defeat the point. Note this is INTENTIONALLY not the same test as
 * HeroGlyphRing's IS_SMALL_SCREEN / HobbiesScene's `ontouchstart`: those ask
 * "is this a small or touch-capable viewport" (a narrow desktop window counts),
 * whereas this asks "is the primary input a finger" (it must not).
 *
 * Read once and cached, like the tier itself.
 */
export function isTouchPrimary(): boolean {
  if (touchPrimaryCache !== null) return touchPrimaryCache;
  touchPrimaryCache =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  return touchPrimaryCache;
}

function probe(): Tier {
  if (typeof navigator === "undefined" || typeof window === "undefined")
    return "standard";

  // Diagnostic override: ?tier=low|standard|high forces a tier, so the exact
  // experience each class of hardware gets can be checked on any machine (mirrors
  // the existing ?introFreeze= / ?sign= dev affordances). Never set in normal use.
  try {
    const o = new URLSearchParams(window.location.search).get("tier");
    if (o === "low" || o === "standard" || o === "high") return o as Tier;
  } catch {
    /* ignore */
  }

  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 0;
  const mem = nav.deviceMemory; // undefined on Safari/Firefox — treat as unknown
  const dpr = window.devicePixelRatio || 1;

  const touchPrimary = isTouchPrimary();

  let tier: Tier = "standard";

  // HIGH only on a clearly strong machine (and not a hi-DPR panel that would
  // multiply fragment cost). Unknown memory is allowed to pass — downgrade-only.
  if (cores >= 8 && (mem === undefined || mem >= 8) && dpr <= 2) tier = "high";

  // LOW on a PRESENT weak signal (never on a missing one).
  //
  // The cores rule is DESKTOP-ONLY. On WebKit hardwareConcurrency is not a core
  // count at all — it's an anti-fingerprinting bucket, literally
  // `numberOfProcessorCores() < 8 ? 4 : 8` (WebCore/page/NavigatorBase.cpp).
  // Every A-series iPhone is 6 cores, so EVERY iPhone reports exactly 4 and no
  // iPhone can ever report 8. A desktop `<=4` floor therefore demoted 100% of
  // iPhones to 'low' — the exact "false positive that demotes capable hardware"
  // this file's header forbids, and the reason the hero ring shipped as a static
  // image on phones. The rule is also INVERTED on touch: Chromium reports the
  // raw count, so a cheap octa-core budget Android reports 8 and sails past it
  // while an iPhone 17 Pro is demoted. It carries no capability signal on touch,
  // so the honest move is not to read it there at all.
  if (!touchPrimary && cores > 0 && cores <= 4) tier = "low";
  // The memory floor drops to <=2 on touch. Chrome rounds deviceMemory to the
  // nearest allowed bucket and clamps it (Android: 1/2/4/8), and real "6GB"
  // hardware reports ~5.7GB of physical memory, which rounds DOWN to 4 — so the
  // desktop `<=4` floor swept in the entire low AND mid range of the Android
  // install base, capable GPUs included. On Android `<=2` is what's left as a
  // genuinely low-RAM present signal. iOS/Firefox expose no deviceMemory at all,
  // so `mem === undefined` still never forces low.
  if (mem !== undefined && mem <= (touchPrimary ? 2 : 4)) tier = "low";

  // Still ambiguous: one throwaway renderer-string read, downgrade-only.
  if (tier !== "low") {
    const r = rendererString();
    if (r && isWeakRenderer(r)) tier = "low";
  }

  // A prior janky session can only LOWER the verdict, never raise it.
  const persisted = readPersistedDemote();
  if (persisted) tier = lowerOf(tier, persisted);

  return tier;
}

let cached: Tier | null = null;

/**
 * Resolve the tier once and write `data-tier` on <html>. Call from main.tsx
 * BEFORE createRoot so the hero's mount-time branch can read it.
 */
export function initTier(): Tier {
  if (cached) return cached;
  cached = probe();
  try {
    document.documentElement.setAttribute("data-tier", cached);
  } catch {
    /* SSR / no-DOM: ignore */
  }
  return cached;
}

export function getTier(): Tier {
  return cached ?? initTier();
}

export function isLowTier(): boolean {
  return getTier() === "low";
}

/**
 * One-way demote (high→standard→low). Updates data-tier live (cheap CSS effects
 * only) and persists for the NEXT load. It deliberately does NOT remount any
 * live WebGL — yanking a running ring mid-scroll would be jarring; the heavier
 * static fallbacks take effect on the next load. Wired to App.tsx's slow-frame
 * FPS canary as a safety net for machines the static probe rated too high.
 */
export function demoteTier(): Tier {
  const cur = getTier();
  const next = ORDER[Math.max(0, rank(cur) - 1)]!;
  if (next !== cur) {
    cached = next;
    try {
      document.documentElement.setAttribute("data-tier", next);
    } catch {
      /* ignore */
    }
  }
  try {
    sessionStorage.setItem(STORE_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}

/**
 * Read the tier in a component. Resolves once at mount; the live tier never
 * UPGRADES mid-session and a demote intentionally doesn't remount, so a single
 * read is correct (no subscription needed).
 */
export function useTier(): Tier {
  const [t] = useState(getTier);
  return t;
}
