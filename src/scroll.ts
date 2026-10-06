// src/scroll.ts: the page's scroll core (motion spec §2).
//
// Owns the Lenis singleton (moved out of portfolio/Keypad.tsx, which still
// calls ensureLenis() at the same moment so creation timing is unchanged), the
// scroll-lock reasons, and every PROGRAMMATIC scroll on the site.
//
// NO LENIS ON TOUCH-PRIMARY DEVICES (MQ.touchPrimary: phones, tablets without
// a trackpad). Even with syncTouch:false, Lenis registers NON-passive
// touchstart/touchmove/touchend listeners on window, which makes every finger
// scroll wait on the main thread before the compositor may move the page (the
// very jank syncTouch:false was meant to avoid). There the page scrolls fully
// natively: ensureLenis() still installs the loader lock, getLenis() stays
// null (every consumer handles null: heroWipe and ScrollTrigger fall back to
// the window scroll event, Work reads window.scrollY), smooth programmatic
// scrolls run on a small rAF tween (nativeTween below) instead of
// lenis.scrollTo, and a held lock blocks touch scrolling with its own
// touchmove guard, which exists only while a lock is held. Decided once, at
// install: a hybrid that changes primary input mid-session keeps its engine.
//
// Rules this module enforces (spec §0):
//   - Lenis (LENIS in motion.ts) is the only wheel smoother.
//   - Programmatic scroll never uses the wheel curve: from-rest scrolls use the
//     SCROLL presets (ease-in-out, duration scaled to distance), and scrolls
//     longer than SCROLL.cutThresholdVh viewports cut behind a cover.
//   - Native `behavior: "smooth"` is never used (it ignores reduced motion and
//     fights Lenis).
//
// Locks are a set of named reasons ("loader", "menu", "jump:<seq>", ...).
// While any is held Lenis is stopped and <html> carries an inline
// overflow:hidden (the smoke test reads documentElement.style.overflow).
// Lenis's start() calls reset(), which kills any in-flight tween, so a SMOOTH
// request made while a lock is held is downgraded to an instant cut (see
// scrollToY).
//
// It also owns two page-wide ScrollTrigger refresh rules (see "Refresh
// discipline" below): triggers refresh in DOM order whatever their creation
// order, and a viewport resize keeps the reader on the same section beat.

import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import {
  DUR,
  LENIS,
  MQ,
  SCROLL,
  matches,
  presetDuration,
  reducedMotion,
} from "./motion";
import { SECTION_REGISTRY } from "./sectionRegistry";
// Direct import, never the ./seams barrel: seam.ts imports this module.
import { isHoldTrigger } from "./seams/holds";

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
// ensureLenis() ran (with or without creating Lenis; see the header).
let coreInstalled = false;
// Touch-primary install: Lenis deliberately absent, smooth scrolls tween natively.
let nativeMode = false;

/** The live Lenis instance, or null before the first ensureLenis() and always
 *  on touch-primary devices (native scroll; see the header). */
export function getLenis(): Lenis | null {
  return lenisInstance;
}

/**
 * Create the Lenis singleton (idempotent). The tuning values live in
 * motion.ts `LENIS`; the history behind them is recorded below.
 */
export function ensureLenis(): void {
  if (coreInstalled || typeof window === "undefined") return;
  coreInstalled = true;
  if (matches(MQ.touchPrimary)) {
    // Native scroll (see the header): ScrollTrigger already listens to the
    // window scroll event itself; only the locks + loader lock below remain.
    nativeMode = true;
  } else {
    createLenis();
  }

  // Locks requested before the core existed (only the inline overflow applied).
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

function createLenis(): void {
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
}

// ── Locks ───────────────────────────────────────────────────────────────────
const locks = new Set<string>();

// Native mode's stand-in for a stopped Lenis, which preventDefault()s every
// touchmove/wheel while stopped: overflow:hidden on <html> alone does not stop
// a finger panning the page on iOS. Non-passive, but it only exists while a
// lock is held (menu open, a covered cut), never during normal scrolling.
const blockTouchScroll = (e: TouchEvent) => {
  if (e.cancelable) e.preventDefault();
};
let touchGuard = false;

function applyLocks() {
  const locked = locks.size > 0;
  if (lenisInstance) {
    if (locked) lenisInstance.stop();
    else lenisInstance.start();
  }
  if (nativeMode && typeof window !== "undefined") {
    // A stopped Lenis also kills its in-flight tween (stop() -> reset()).
    if (locked) activeTween?.cancel();
    if (locked !== touchGuard) {
      touchGuard = locked;
      if (locked) window.addEventListener("touchmove", blockTouchScroll, { passive: false });
      else window.removeEventListener("touchmove", blockTouchScroll);
    }
  }
  if (typeof document !== "undefined") {
    document.documentElement.style.overflow = locked ? "hidden" : "";
  }
}

// ── Native tween (touch-primary only) ───────────────────────────────────────
// lenis.scrollTo's stand-in where Lenis is absent: the same duration + easing,
// stepped in rAF with instant window.scrollTo (never native `smooth`, spec §0).
// ScrollTrigger and every scroll listener follow from the real scroll events.
// A finger on the glass always takes over (a tween fighting a drag frame by
// frame is worse than an interrupted glide); wheel / keys take over unless the
// caller asked for `lock` (as with Lenis's lock option).
interface Tween {
  cancel(): void;
}
let activeTween: Tween | null = null;

function nativeTween(
  y: number,
  duration: number,
  easing: (t: number) => number,
  lock: boolean,
  onArrive: () => void,
): Tween {
  activeTween?.cancel();
  const from = window.scrollY;
  const t0 = performance.now();
  let raf = 0;
  let live = true;
  const inputs = lock ? ["touchstart"] : ["touchstart", "wheel", "keydown"];
  const tween: Tween = {
    cancel() {
      if (!live) return;
      live = false;
      cancelAnimationFrame(raf);
      for (const t of inputs) window.removeEventListener(t, takeOver, true);
      if (activeTween === tween) activeTween = null;
    },
  };
  const takeOver = () => tween.cancel();
  const step = (now: number) => {
    if (!live) return;
    const t = duration > 0 ? Math.min(1, (now - t0) / (duration * 1000)) : 1;
    window.scrollTo(0, from + (y - from) * easing(t));
    if (t >= 1) {
      tween.cancel();
      onArrive();
      return;
    }
    raf = requestAnimationFrame(step);
  };
  for (const t of inputs) window.addEventListener(t, takeOver, { passive: true, capture: true });
  activeTween = tween;
  raf = requestAnimationFrame(step);
  return tween;
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
  activeTween?.cancel();
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
 * callers see the new position immediately.
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
      // Owner-scoped reason: a newer covered cut that starts during this
      // one's two-frame hold takes its own reason, so this cut's release
      // below can't re-enable input under the newer cut.
      const reason = `jump:${seq}`;
      lockScroll(reason);
      try {
        // Re-resolve: layout can shift under the cover (lazy sections).
        cutNow(resolveY(target, opts.offset), from);
        // Two frames under the opaque cover so ScrollTrigger followers and the
        // WebGL scenes render the new position before the reveal.
        await nextFrame();
        await nextFrame();
      } finally {
        unlockScroll(reason);
        if (coverOwner === seq) el.classList.remove("is-on");
      }
      // Superseded during the hold: the newer scroll owns the landing.
      if (seq === scrollSeq) opts.onComplete?.();
    })();
  }

  // Smooth.
  const duration =
    opts.duration ?? presetDuration(dy, vh, preset, opts.maxDuration);
  const easing = opts.easing ?? preset.easing;
  emit({ phase: "start", mode: "smooth", from, to: y });
  if (!lenisInstance && !nativeMode) {
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
    let tween: Tween | null = null;
    // `end` is emitted and the promise resolves on every exit (arrival,
    // supersede, cancel), but the caller's onComplete means ARRIVAL only,
    // as with lenis.scrollTo's own onComplete (spec §2.2.3).
    const finish = (arrived: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      // Native: a superseded / timed-out tween must stop writing scrollY
      // (lenis.scrollTo replaces its own tween; ours has to be told).
      tween?.cancel();
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
    if (!lenis) {
      tween = nativeTween(y, duration, easing, opts.lock ?? false, () => finish(true));
      return;
    }
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
 * Jump to a registry section (index or label). Lands on the section's
 * `pinId` trigger (a GSAP pin, or a seam hold trigger from softHold) at
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
      : docTop(el) - (parseFloat(getComputedStyle(el).scrollMarginTop) || 0);
  return scrollToY(y, { preset: "jump", ...opts });
}

// ── Pan API ─────────────────────────────────────────────────────────────────

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
  activeTween?.cancel();
  if (lenisInstance) {
    lenisInstance.scrollTo(y, { immediate: true });
  } else {
    window.scrollTo(0, y);
  }
}

// ── Refresh discipline ──────────────────────────────────────────────────────
//
// 1. DOM-ORDER REFRESH. ScrollTrigger.refresh() re-measures triggers in its
// internal array order, and a pin's start only includes the spacers of pins
// refreshed BEFORE it. That array is creation order (or, once any trigger sets
// refreshPriority, a sort on live getBoundingClientRect() tops, which is
// wrong for a pin that is fixed mid-scroll). Sections that create their
// triggers only above a breakpoint (desktop pins, then the seam hold triggers
// that replace them) are created AFTER the ones that always exist when a
// narrow load is widened (an iPad rotation); in creation order the later
// sections then refreshed first, against a layout missing the earlier
// sections' length. Every refresh now orders triggers by refreshPriority
// (desc), then document order (ancestor before descendant); ties keep
// creation order (stable sort), which softHold relies on: its writer is
// created after its hold trigger on the same section and reads the hold's
// fresh start/end.
// Overriding the static sort also covers the built-in no-argument call that
// refresh makes when any trigger has a refreshPriority (StatusBar's -10s).

function domOrder(a: ScrollTrigger, b: ScrollTrigger): number {
  const pa = a.vars.refreshPriority ?? 0;
  const pb = b.vars.refreshPriority ?? 0;
  if (pa !== pb) return pb - pa;
  // Same rule as GSAP's default: containerAnimation triggers refresh last.
  const ca = a.vars.containerAnimation ? 1 : 0;
  const cb = b.vars.containerAnimation ? 1 : 0;
  if (ca !== cb) return ca - cb;
  // Element-less / detached triggers (numeric starts) after element ones, so
  // the comparator stays a total order.
  const ea = a.trigger && a.trigger.isConnected ? a.trigger : null;
  const eb = b.trigger && b.trigger.isConnected ? b.trigger : null;
  if (!ea || !eb) return ea ? -1 : eb ? 1 : 0;
  if (ea === eb) return 0;
  const pos = ea.compareDocumentPosition(eb);
  if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1; // incl. b inside a
  if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

// 2. KEEP THE BEAT ACROSS A RESIZE. Pin and hold lengths are viewport-relative
// (spec §3; seam holds are svh tokens in src/seams/stack.css), so a resize
// changes every spacer / tall section above the reader while ScrollTrigger
// restores the same ABSOLUTE scrollY: 1440x900 -> 1280x720 at Work p0.5 used
// to land in Play. The section geometry is cached after every refresh; when a
// refresh follows a viewport change, the pre-resize position is located in
// the cached geometry (registry section + pin progress, or the fraction of
// the section after its pin) and restored in the new geometry with an
// immediate cut. The intent survives the follow-up refreshes of a breakpoint
// flip (pins re-created a frame later) for RESTORE_WINDOW_MS, and is dropped
// by any user input or programmatic scroll. Height-only changes on a coarse
// pointer (mobile URL bar, on-screen keyboard) never restore: that would
// fight touch momentum.

interface SectionGeom {
  top: number;
  pin: number;
}
type Geom = Array<SectionGeom | null>;
interface BeatLoc {
  i: number;
  seg: "pin" | "rest";
  /** fraction within the segment */
  f: number;
  /** fraction within the whole section (fallback when the pin came or went) */
  s: number;
  /** the section's pin (hold) length when located: 0 = it had none */
  srcPin: number;
}

const RESTORE_WINDOW_MS = 2000;

function measureGeom(): Geom {
  return SECTION_REGISTRY.map((e) => {
    const el = document.querySelector<HTMLElement>(e.selector);
    if (!el) return null;
    const st = e.pinId ? ScrollTrigger.getById(e.pinId) : undefined;
    // A GSAP pin, or a seam hold trigger (src/seams/softHold.ts: a non-pinning
    // trigger over an inner sticky's span). Either way [start, end] is the
    // held beat range a resize should keep the reader inside.
    const pin = st && (st.pin || isHoldTrigger(st)) ? Math.max(0, st.end - st.start) : 0;
    return { top: docTop(el), pin };
  });
}

/** Section i's span: [top, pinEnd] is the pin, [pinEnd, next] the rest. */
function span(g: Geom, i: number, max: number) {
  const a = g[i]!;
  let next = max;
  for (let j = i + 1; j < g.length; j++) {
    const b = g[j];
    if (b) {
      next = b.top;
      break;
    }
  }
  const pinEnd = a.top + a.pin;
  return { top: a.top, pin: a.pin, pinEnd, next: Math.max(next, pinEnd) };
}

function locateBeat(y: number, g: Geom, max: number): BeatLoc | null {
  let i = -1;
  g.forEach((a, k) => {
    if (a && a.top <= y + 0.5) i = k;
  });
  if (i < 0) return null;
  const sp = span(g, i, max);
  const s = (y - sp.top) / Math.max(1, sp.next - sp.top);
  if (sp.pin > 0 && y <= sp.pinEnd) return { i, seg: "pin", f: (y - sp.top) / sp.pin, s, srcPin: sp.pin };
  const rest = sp.next - sp.pinEnd;
  return { i, seg: "rest", f: rest > 0 ? (y - sp.pinEnd) / rest : 0, s, srcPin: sp.pin };
}

function resolveBeat(loc: BeatLoc, g: Geom, max: number): number | null {
  if (!g[loc.i]) return null;
  const sp = span(g, loc.i, max);
  if (loc.seg === "pin") {
    return sp.pin > 0 ? sp.top + loc.f * sp.pin : sp.top + loc.s * (sp.next - sp.top);
  }
  // The hold CAME back (e.g. 1440 -> 860 -> 1440, or an iPad rotated to
  // portrait and back): below the breakpoint the whole section was "rest",
  // so f is a whole-section fraction. Mapping it onto the rest AFTER the
  // restored hold threw the reader past every hold (onto the Mac's
  // power-off); use the whole-section fraction, mirroring the pin branch.
  if (loc.srcPin === 0 && sp.pin > 0) return sp.top + loc.s * (sp.next - sp.top);
  return sp.pinEnd + loc.f * (sp.next - sp.pinEnd);
}

function docMax(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

let geomCache: { w: number; h: number; max: number; geom: Geom } | null = null;
// Last scrollY seen while the viewport still matched geomCache.
let stableY = 0;
// User input after the viewport changed but before the refresh: the reader
// has already moved in the new layout, so don't yank them back.
let inputSinceResize = false;
let restoreIntent: { loc: BeatLoc; until: number; seq: number } | null = null;

function viewportChanged(): boolean {
  if (!geomCache) return false;
  if (window.innerWidth !== geomCache.w) return true;
  if (window.innerHeight === geomCache.h) return false;
  return !window.matchMedia("(pointer: coarse)").matches;
}

function hasJumpLock(): boolean {
  for (const r of locks) if (r.startsWith("jump:")) return true;
  return false;
}

function installRefreshDiscipline() {
  const st = ScrollTrigger as unknown as { __danSort?: boolean };
  if (typeof window === "undefined" || st.__danSort) return;
  st.__danSort = true;

  const baseSort = ScrollTrigger.sort.bind(ScrollTrigger);
  ScrollTrigger.sort = ((func?: (a: ScrollTrigger, b: ScrollTrigger) => number) =>
    baseSort(func ?? domOrder)) as typeof ScrollTrigger.sort;

  ScrollTrigger.addEventListener("refreshInit", () => {
    // Runs before refresh reverts and re-measures: order the array now (the
    // built-in sort, when it runs, goes through the override above too).
    ScrollTrigger.sort();
    const now = performance.now();
    if (geomCache && viewportChanged()) {
      const loc = inputSinceResize ? null : locateBeat(stableY, geomCache.geom, geomCache.max);
      restoreIntent = loc ? { loc, until: now + RESTORE_WINDOW_MS, seq: scrollSeq } : null;
    } else if (restoreIntent && (now > restoreIntent.until || restoreIntent.seq !== scrollSeq)) {
      restoreIntent = null;
    }
  });

  ScrollTrigger.addEventListener("refresh", () => {
    const geom = measureGeom();
    const intent = restoreIntent;
    if (
      intent &&
      performance.now() <= intent.until &&
      intent.seq === scrollSeq &&
      !settleActiveSmooth &&
      !hasJumpLock()
    ) {
      // Lenis's own refresh listener may not have run yet; its limit clamps
      // the cut.
      lenisInstance?.resize();
      const y = resolveBeat(intent.loc, geom, docMax());
      if (y != null) {
        const to = Math.round(Math.min(maxY(), Math.max(0, y)));
        const from = currentY();
        if (Math.abs(to - from) > 1) cutNow(to, from);
      }
    }
    geomCache = { w: window.innerWidth, h: window.innerHeight, max: docMax(), geom };
    stableY = window.scrollY;
    inputSinceResize = false;
  });

  window.addEventListener(
    "scroll",
    () => {
      if (geomCache && window.innerWidth === geomCache.w && window.innerHeight === geomCache.h) {
        stableY = window.scrollY;
      }
    },
    { passive: true },
  );
  const onInput = () => {
    restoreIntent = null;
    if (viewportChanged()) inputSinceResize = true;
  };
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
    window.addEventListener(type, onInput, { passive: true, capture: true });
  }
}
installRefreshDiscipline();

// Debug mirror for the measurement tools / e2e probes (like __heroMotion).
if (typeof window !== "undefined") {
  (window as unknown as { __scroll?: unknown }).__scroll = {
    scrollToY,
    jumpToSection,
    getLenis,
    isScrollLocked,
    onScrollJump,
    ScrollTrigger,
  };
}
