// src/scroll.ts: the page's scroll core (motion spec §2).
//
// Owns the Lenis singleton (moved out of portfolio/Keypad.tsx, which still
// calls ensureLenis() at the same moment so creation timing is unchanged), the
// scroll-lock reasons, and every PROGRAMMATIC scroll on the site.
//
// Rules this module enforces (spec §0):
//   - Lenis (LENIS in motion.ts) is the only wheel smoother.
//   - Programmatic scroll never uses the wheel curve: from-rest scrolls use the
//     SCROLL presets (ease-in-out, duration scaled to distance), and scrolls
//     longer than SCROLL.cutThresholdVh viewports cut behind a cover.
//   - Native `behavior: "smooth"` is never used (it ignores reduced motion and
//     fights Lenis).
//
// Locks are a set of named reasons ("loader", "menu", "jump", ...). While any
// is held Lenis is stopped and <html> carries an inline overflow:hidden (the
// smoke test reads documentElement.style.overflow). Lenis's start() calls
// reset(), which kills any in-flight tween, so a SMOOTH request made while a
// lock is held is downgraded to an instant cut (see scrollToY).

import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  DUR,
  LENIS,
  SCROLL,
  presetDuration,
  reducedMotion,
} from "./motion";
import { SECTION_REGISTRY } from "./sectionRegistry";

gsap.registerPlugin(ScrollTrigger);

export type ScrollMode = "auto" | "smooth" | "cut";
export interface ScrollOpts {
  /** default "glide"; "jump" = mode "auto" + registry-friendly defaults */
  preset?: "glide" | "nudge" | "jump";
  /** default "auto" for preset "jump", else "smooth" */
  mode?: ScrollMode;
  /** cut only; default true. Pass false when the caller already hides the page (menu scrim) */
  cover?: boolean;
  /** seconds; overrides the distance-scaled preset duration */
  duration?: number;
  /** seconds; overrides the preset cap (Mac CTA: 1.2) */
  maxDuration?: number;
  easing?: (t: number) => number;
  /** alias for { mode: "cut", cover: false } */
  immediate?: boolean;
  /** default TRUE: locks block user input, never programmatic scroll */
  force?: boolean;
  /** default false: true = user wheel cannot interrupt the tween */
  lock?: boolean;
  offset?: number;
  onComplete?: () => void;
}
export interface ScrollJumpEvent {
  phase: "start" | "end";
  mode: "smooth" | "cut";
  from: number;
  to: number;
}

// ── Lenis singleton ─────────────────────────────────────────────────────────
// Module scope so StrictMode's double-mount in dev doesn't spin up a competing
// instance.
let lenisInstance: Lenis | null = null;

/** The live Lenis instance, or null before the first ensureLenis(). */
export function getLenis(): Lenis | null {
  return lenisInstance;
}

/**
 * Create the Lenis singleton (idempotent). The tuning values live in
 * motion.ts `LENIS`; the history behind them is recorded below.
 */
export function ensureLenis(): void {
  if (lenisInstance || typeof window === "undefined") return;
  // Lenis tuning (values in motion.ts LENIS) balances smoothness against
  // responsiveness. PERF / FEEL: duration dropped 0.95s → 0.6s after the owner
  // reported the page feeling "laggy and unusable". The longer duration was
  // amplifying perceived jank: every wheel impulse spread its work over ~57
  // frames, and any per-frame stall during that window read as the entire
  // page hitching. 0.6s still feels glided (vs. the bare-OS 0ms native scroll)
  // while keeping each impulse resolved in ~36 frames: fewer chances for an
  // outlier frame to register.
  //
  // wheelMultiplier bumped 0.85 → 1.0 so a single wheel notch moves a sensible
  // distance even though each impulse is shorter.
  //
  // TOUCH: smooth-scroll is intentionally OFF on touch. `syncTouch:false`
  // means a finger drag uses the OS's native momentum/rubber-band scrolling,
  // which on mobile GPUs feels crisper and lower-latency than re-interpolating
  // every touch delta through Lenis's lerp (that path reads as laggy on a
  // phone). GSAP ScrollTrigger still updates from the native scroll, so the
  // pinned keypad/Mac/footer sections stay in sync. touchMultiplier stays at
  // the neutral 1 (it only scales deltas when syncTouch is on).
  const lenis = new Lenis({
    ...LENIS,
    // Reduced motion: no wheel smoothing (spec §2.2.1); kept live below.
    smoothWheel: LENIS.smoothWheel && !reducedMotion.value,
  });
  lenisInstance = lenis;
  // Force scroll-origin sync: without it, if Lenis initializes after the
  // browser has scrolled (cache restore), Lenis snapshots whatever position the
  // scroller is at and treats it as 0. MUST run before any lock is applied
  // below: scrollTo() without `force` is a no-op on a stopped instance.
  lenis.scrollTo(0, { immediate: true });
  lenis.on("scroll", ScrollTrigger.update);
  gsap.ticker.add((time) => lenis.raf(time * 1000));
  // Disable GSAP's lag smoothing: Lenis already manages frame pacing;
  // competing interpolators jitter the pin engagement.
  gsap.ticker.lagSmoothing(0);

  reducedMotion.subscribe((v) => {
    lenis.options.smoothWheel = LENIS.smoothWheel && !v;
  });

  // Refresh closes the stale-limit window: ScrollTrigger pins change the
  // document height on refresh, and Lenis's own ResizeObserver lags it.
  ScrollTrigger.addEventListener("refresh", () => lenis.resize());

  // Locks requested before Lenis existed (only the inline overflow applied).
  applyLocks();

  // Loader lock, EDGE-triggered. The old observer re-synced on EVERY <html>
  // class mutation, so Lenis's own lenis-* class churn (lenis-stopped,
  // lenis-scrolling) called start() and silently undid any other stop(): the
  // menu lock never held. Only a real loading-active flip reaches the lock now.
  // Seed first: main.tsx adds loading-active before React mounts, so the
  // observer would never see that "added" change.
  const html = document.documentElement;
  let lastLoading = html.classList.contains("loading-active");
  if (lastLoading) lockScroll("loader");
  new MutationObserver(() => {
    const now = html.classList.contains("loading-active");
    if (now === lastLoading) return;
    lastLoading = now;
    if (now) lockScroll("loader");
    else unlockScroll("loader");
  }).observe(html, { attributes: true, attributeFilter: ["class"] });
}

// ── Locks ───────────────────────────────────────────────────────────────────
const locks = new Set<string>();

function applyLocks() {
  const locked = locks.size > 0;
  if (lenisInstance) {
    if (locked) lenisInstance.stop();
    else lenisInstance.start();
  }
  if (typeof document !== "undefined") {
    document.documentElement.style.overflow = locked ? "hidden" : "";
  }
}

/** Block user scroll input for `reason` ("loader" | "menu" | "jump" | …). */
export function lockScroll(reason: string): void {
  if (locks.has(reason)) return;
  locks.add(reason);
  if (locks.size === 1) applyLocks();
}

/** Release `reason`. A reason that isn't held is a strict no-op. */
export function unlockScroll(reason: string): void {
  if (!locks.delete(reason)) return;
  if (locks.size === 0) applyLocks();
}

export function isScrollLocked(): boolean {
  return locks.size > 0;
}

// ── Jump events ─────────────────────────────────────────────────────────────
const jumpSubs = new Set<(e: ScrollJumpEvent) => void>();

/**
 * Subscribe to programmatic scroll jumps. On `{phase:"end", mode:"cut"}`
 * followers should snap to the target in the same frame. Returns unsubscribe.
 */
export function onScrollJump(cb: (e: ScrollJumpEvent) => void): () => void {
  jumpSubs.add(cb);
  return () => {
    jumpSubs.delete(cb);
  };
}

function emit(e: ScrollJumpEvent) {
  jumpSubs.forEach((f) => {
    try {
      f(e);
    } catch (err) {
      console.error(err);
    }
  });
}

// ── Cover (cut transitions) ─────────────────────────────────────────────────
let coverEl: HTMLDivElement | null = null;
function getCover(): HTMLDivElement {
  if (!coverEl || !coverEl.isConnected) {
    coverEl = document.createElement("div");
    coverEl.className = "scroll-cover";
    coverEl.setAttribute("aria-hidden", "true");
    document.body.appendChild(coverEl);
    // Flush style so the element's opacity-0 start state is committed before
    // the caller adds .is-on; otherwise the first cover on a page skips its
    // stepped transition and pops straight to opacity 1.
    void coverEl.offsetWidth;
  }
  return coverEl;
}

// Slack past DUR.coverIn before the cover-in wait gives up on transitionend
// (the CSS transition only starts at the next style recalc, so it ends a
// frame or so after the nominal duration).
const COVER_IN_SAFETY_MS = 50;

/**
 * Resolve once the cover is actually OPAQUE: on the opacity transitionend, or
 * immediately if it's already at 1 (a second cut while the first holds it),
 * or after DUR.coverIn + COVER_IN_SAFETY_MS as a safety net. Awaiting a plain
 * DUR.coverIn from classList.add is not enough: the transition starts at the
 * next recalc and steps(3, jump-end) only reaches 1 at its very end, so the
 * cut frame would paint the jump through a 0.67 cover.
 */
function coverOpaque(el: HTMLElement): Promise<void> {
  if (getComputedStyle(el).opacity === "1") return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer = 0;
    const done = () => {
      el.removeEventListener("transitionend", onEnd);
      window.clearTimeout(timer);
      resolve();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === "opacity") done();
    };
    el.addEventListener("transitionend", onEnd);
    timer = window.setTimeout(done, DUR.coverIn * 1000 + COVER_IN_SAFETY_MS);
  });
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

// ── Geometry helpers ────────────────────────────────────────────────────────
function currentY(): number {
  return lenisInstance ? lenisInstance.animatedScroll : window.scrollY;
}

function maxY(): number {
  if (lenisInstance) return lenisInstance.limit;
  const d = document.documentElement;
  return Math.max(0, d.scrollHeight - window.innerHeight);
}

/** Document top of an element; a pinned element resolves through its .pin-spacer. */
function docTop(el: Element): number {
  const parent = el.parentElement;
  const box = parent && parent.classList.contains("pin-spacer") ? parent : el;
  return box.getBoundingClientRect().top + window.scrollY;
}

function resolveY(target: number | HTMLElement, offset = 0): number {
  const y = typeof target === "number" ? target : docTop(target);
  return Math.min(maxY(), Math.max(0, y + offset));
}

// ── Programmatic scroll ─────────────────────────────────────────────────────

// The in-flight smooth scroll's finisher. A new programmatic scroll supersedes
// it: its `end` is emitted and its onComplete/promise settle right away,
// instead of a stale `end` arriving from its safety timeout mid-way through
// the next scroll.
let settleActiveSmooth: (() => void) | null = null;

// Bumped by every scrollToY call. A covered cut still waiting on its cover
// checks it before cutting, so a newer programmatic scroll supersedes it
// instead of being overridden by a late teleport.
let scrollSeq = 0;
// Which covered cut currently owns the cover; only the owner lifts it, so an
// older cut's cleanup can't drop the cover out from under a newer one.
let coverOwner = 0;

/** Instant jump + ScrollTrigger.update + synchronous `end` emit. */
function cutNow(y: number, from: number) {
  if (lenisInstance) lenisInstance.scrollTo(y, { immediate: true, force: true });
  else window.scrollTo(0, y);
  ScrollTrigger.update();
  emit({ phase: "end", mode: "cut", from, to: y });
}

/**
 * Scroll to an absolute Y (or an element's document top).
 *
 * - preset "glide" (default) / "nudge": smooth, eased in-out, duration scaled
 *   to distance (SCROLL presets in motion.ts).
 * - preset "jump": mode "auto" = smooth under SCROLL.cutThresholdVh viewports,
 *   a covered cut beyond.
 * - Reduced motion: always an instant cut, no cover.
 * - While any scroll lock is held, a smooth request is downgraded to an
 *   uncovered cut (Lenis's start() would kill the tween on unlock).
 *
 * The decision and any uncovered cut run SYNCHRONOUSLY, so fire-and-forget
 * callers (the legacy scrollToSection) see the new position immediately.
 */
export function scrollToY(target: number | HTMLElement, opts: ScrollOpts = {}): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  settleActiveSmooth?.();
  const seq = ++scrollSeq;
  const presetName = opts.preset ?? "glide";
  const preset = presetName === "nudge" ? SCROLL.nudge : SCROLL.glide;
  const from = currentY();
  const y = resolveY(target, opts.offset);
  const dy = y - from;
  const vh = window.innerHeight || 1;

  let mode: ScrollMode = opts.mode ?? (presetName === "jump" ? "auto" : "smooth");
  let cover = opts.cover ?? true;
  if (opts.immediate) {
    mode = "cut";
    cover = false;
  }
  if (reducedMotion.value) {
    mode = "cut";
    cover = false;
  }
  if (mode === "auto") {
    mode = Math.abs(dy) > SCROLL.cutThresholdVh * vh ? "cut" : "smooth";
  }
  if (mode === "smooth" && isScrollLocked()) {
    mode = "cut";
    cover = false;
  }

  if (mode === "cut") {
    if (!cover) {
      cutNow(y, from);
      opts.onComplete?.();
      return Promise.resolve();
    }
    return (async () => {
      const el = getCover();
      coverOwner = seq;
      el.classList.add("is-on");
      // Wait until the cover is fully opaque, then one more frame so at least
      // one opaque frame is on screen before the teleport. The cut runs in a
      // rAF callback, so the frame that paints the new scrollY is covered.
      await coverOpaque(el);
      await nextFrame();
      if (seq !== scrollSeq) {
        // Superseded while covering: the newer scroll owns the page. Lift the
        // cover only if no newer covered cut has taken it over.
        if (coverOwner === seq) el.classList.remove("is-on");
        return;
      }
      lockScroll("jump");
      try {
        // Re-resolve: layout can shift under the cover (lazy sections).
        cutNow(resolveY(target, opts.offset), from);
        // Two frames under the opaque cover so ScrollTrigger followers and the
        // WebGL scenes render the new position before the reveal.
        await nextFrame();
        await nextFrame();
      } finally {
        unlockScroll("jump");
        if (coverOwner === seq) el.classList.remove("is-on");
      }
      opts.onComplete?.();
    })();
  }

  // Smooth.
  const duration =
    opts.duration ?? presetDuration(dy, vh, preset, opts.maxDuration);
  const easing = opts.easing ?? preset.easing;
  emit({ phase: "start", mode: "smooth", from, to: y });
  if (!lenisInstance) {
    // Lenis not running yet: immediate, never native smooth.
    window.scrollTo(0, y);
    ScrollTrigger.update();
    emit({ phase: "end", mode: "smooth", from, to: y });
    opts.onComplete?.();
    return Promise.resolve();
  }
  const lenis = lenisInstance;
  return new Promise<void>((resolve) => {
    let done = false;
    let timer = 0;
    // `end` is emitted and the promise resolves on every exit (arrival,
    // supersede, cancel), but the caller's onComplete means ARRIVAL only,
    // as with lenis.scrollTo's own onComplete (spec §2.2.3).
    const finish = (arrived: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      if (settleActiveSmooth === settle) settleActiveSmooth = null;
      emit({ phase: "end", mode: "smooth", from, to: y });
      if (arrived) opts.onComplete?.();
      resolve();
    };
    const atTarget = () => Math.abs(currentY() - y) <= 1;
    // Supersede / safety timeout: arrived only if we're actually there. The
    // timeout covers a user wheel cancelling the tween (Lenis's onComplete
    // never fires then).
    const settle = () => finish(atTarget());
    timer = window.setTimeout(settle, (duration + 0.25) * 1000);
    settleActiveSmooth = settle;
    lenis.scrollTo(y, {
      duration,
      easing,
      force: opts.force ?? true,
      lock: opts.lock ?? false,
      onComplete: () => finish(true),
    });
  });
}

/**
 * Jump to a registry section (index or label). Lands on the section's pin at
 * `data-jump-progress` (section element attribute, wins) or the registry's
 * `jumpProgress`; otherwise on the section's document top. Default preset
 * "jump". No analytics: callers keep their own track().
 */
export function jumpToSection(which: number | string, opts: ScrollOpts = {}): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const entry =
    typeof which === "number"
      ? SECTION_REGISTRY[which]
      : SECTION_REGISTRY.find((e) => e.label.toLowerCase() === which.toLowerCase());
  if (!entry) return Promise.resolve();
  const el = document.querySelector<HTMLElement>(entry.selector);
  if (!el) return Promise.resolve();
  const progress = Number(el.dataset.jumpProgress ?? entry.jumpProgress);
  const st = entry.pinId ? ScrollTrigger.getById(entry.pinId) : undefined;
  const y =
    st && Number.isFinite(progress)
      ? st.start + progress * (st.end - st.start)
      : docTop(el);
  return scrollToY(y, { preset: "jump", ...opts });
}

// ── Legacy API (kept for existing importers; re-exported from Keypad.tsx) ───

/**
 * Smooth-scroll to an absolute Y (or an element). Now the SCROLL.glide preset
 * instead of the Lenis wheel curve. Callers that pass an explicit `duration`
 * keep the Lenis expo-out curve they were tuned against (Mac CTA, hero settle)
 * until their owners migrate to scrollToY.
 */
export function scrollToSection(
  target: number | HTMLElement,
  opts?: { duration?: number; immediate?: boolean },
): void {
  void scrollToY(target, {
    preset: "glide",
    duration: opts?.duration,
    easing: opts?.duration != null ? LENIS.easing : undefined,
    immediate: opts?.immediate,
  });
}

/**
 * Middle-button PAN / auto-scroll: jump the page to an ABSOLUTE Y immediately
 * (no lerp) via the shared Lenis singleton, so the autoscroll tracks the
 * caller's own running target at a direct, snappy, predictable rate. Routing
 * through Lenis (rather than window.scrollTo, which Lenis would lerp straight
 * back) keeps GSAP ScrollTrigger + the pinned sections in sync. The caller owns
 * the target (accumulating it frame to frame) so nothing compounds: reading
 * Lenis's smoothed `.scroll` back each frame scrolled ~3x too fast.
 * ensureLenis() is idempotent.
 */
export function panScrollTo(y: number): void {
  if (typeof window === "undefined") return;
  ensureLenis();
  if (lenisInstance) {
    lenisInstance.scrollTo(y, { immediate: true });
  } else {
    window.scrollTo(0, y);
  }
}

/** = lockScroll("menu") / unlockScroll("menu"). */
export function setScrollLocked(locked: boolean): void {
  if (locked) lockScroll("menu");
  else unlockScroll("menu");
}

// Debug mirror for the measurement tools / e2e probes (like __heroMotion).
if (typeof window !== "undefined") {
  (window as unknown as { __scroll?: unknown }).__scroll = {
    scrollToY,
    jumpToSection,
    getLenis,
    isScrollLocked,
    onScrollJump,
  };
}
