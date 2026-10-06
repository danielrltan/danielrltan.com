import { useEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SEAM_MQ, reducedMotion } from "../motion";
import { onScrollJump } from "../scroll";
import { refreshScrollOnLoaderLift, requestScrollRefresh } from "../portfolio/scrollRefresh";
import { clamp01 } from "./curves";

gsap.registerPlugin(ScrollTrigger);

/**
 * mountSeam / useSeam: the ONLY way a section seam binds to scroll (spec §4.1).
 *
 * Owner brief (2026-10-06 seam overhaul): "one workstation, one signal, never
 * stopping": something on screen moves 1:1 with the wheel at every section
 * boundary. The rules that keep that smooth live here, once, instead of in
 * eight hand-rolled scroll handlers:
 * - one non-scrub ScrollTrigger per seam on an IN-FLOW trigger (never a
 *   sticky element: a trigger measured on a stuck element gets wrong starts
 *   after a refresh). Lenis is the only smoother: no numeric scrub, no pin, no
 *   snap, no refreshPriority.
 * - render(p) is a pure function of progress, so a seam reverses exactly on
 *   scroll-up and lands correctly after a cut jump (re-rendered synchronously
 *   with ctx.jumping = true; one-shot `cross` side effects latch silently).
 * - layout is read only in measure() (onRefreshInit); render only writes, and
 *   is deduped to one device px of travel.
 * - reduced motion: no trigger, just final() (a static, fully revealed end
 *   state). A gate that is off (when() false) runs the touch/phone fallback,
 *   or final() when there is none. Gates are re-evaluated live on reduced
 *   motion and on the MQ flips they depend on.
 * - window.__seams[id] mirrors { p, active, mode } in every build: smoke and
 *   the acceptance probes read it.
 */

export type SeamId =
  | "hero-about"
  | "about-projects"
  | "projects-work"
  | "work-play"
  | "play-honours"
  | "honours-recents"
  | "recents-contact"
  | "contact-footer"
  | (string & {}); // sub-seams, e.g. 'work-spine', 'mac-cine'

export interface SeamCtx {
  /** Viewport, measured at refresh. */
  vw: number;
  vh: number;
  /** Last scroll direction. */
  dir: 1 | -1;
  /** st.end - st.start in px. */
  len: number;
  /** True inside a cut-jump landing render. */
  jumping: boolean;
}

export interface SeamDef {
  /** ScrollTrigger id `seam:${id}` (debug + uniqueness). */
  id: SeamId;
  /** MUST be an in-flow element, never a sticky one (spec §0.5). */
  trigger: () => Element | null;
  start: string | ((st: ScrollTrigger) => number);
  end: string | ((st: ScrollTrigger) => number);
  /** Default SEAM_MQ.desk; re-evaluated on MQ / reduced-motion change. */
  when?: () => boolean;
  /** onRefreshInit ONLY: the single place layout is read. */
  measure?: (ctx: SeamCtx) => void;
  /** Pure, idempotent; writes only (spec §0.4). */
  render: (p: number, ctx: SeamCtx) => void;
  /** One-shot side effects when p crosses `at` (down = forward). Silent on cut jumps and at mount. */
  cross?: { at: number; down?: () => void; up?: () => void }[];
  /** onToggle: will-change, visibility, overlay claim. */
  activate?: (on: boolean) => void;
  /** Static end state: reduced motion and gate-off without a fallback. */
  final: () => void;
  /** Undo every write (called on unmount / gate flip). */
  reset?: () => void;
  /** Phone/touch variant (usually oneShot(...)); runs when when() is false and motion is OK. Returns its teardown. */
  fallback?: () => () => void;
}

type SeamMode = "scroll" | "fallback" | "final";
interface SeamMirror {
  p: number;
  active: boolean;
  mode: SeamMode;
}

declare global {
  interface Window {
    __seams?: Record<string, SeamMirror>;
  }
}

export function mountSeam(def: SeamDef): () => void {
  if (typeof window === "undefined") return () => {};
  const when = def.when ?? SEAM_MQ.desk;
  const ctx: SeamCtx = { vw: window.innerWidth, vh: window.innerHeight, dir: 1, len: 0, jumping: false };
  const mirror: SeamMirror = { p: 0, active: false, mode: "final" };
  (window.__seams ??= {})[def.id] = mirror;

  const crosses = (def.cross ?? []).slice().sort((a, b) => a.at - b.at);
  let latched: boolean[] = crosses.map(() => false);
  // Latches are primed silently from the first progress a mount sees: a seam
  // mounting mid-page must not fire every `down` it is already past.
  let primed = false;
  // Live crosses run a microtask late, so a cut jump (whose ScrollTrigger.update
  // runs synchronously right before its {end, cut} event) can drop them: on a
  // cut the latch state is set without calling the side effects.
  let pending: Array<() => void> = [];
  let flushQueued = false;
  const flush = () => {
    flushQueued = false;
    const run = pending;
    pending = [];
    run.forEach((f) => f());
  };

  let st: ScrollTrigger | null = null;
  let undoFallback: (() => void) | null = null;
  let lastKey = NaN;
  let lastP = NaN;

  const runCrosses = (p: number) => {
    if (!crosses.length) return;
    if (!primed || ctx.jumping) {
      latched = crosses.map((c) => p >= c.at);
      primed = true;
      return;
    }
    const forward = !(p < lastP);
    const order = forward ? crosses.map((_, i) => i) : crosses.map((_, i) => crosses.length - 1 - i);
    for (const i of order) {
      const c = crosses[i]!;
      const now = p >= c.at;
      if (now === latched[i]) continue;
      latched[i] = now;
      const f = now ? c.down : c.up;
      if (f) pending.push(f);
    }
    if (pending.length && !flushQueued) {
      flushQueued = true;
      queueMicrotask(flush);
    }
  };

  const apply = (p: number, force = false) => {
    // Dedupe on one device px of travel: no write without movement.
    const key = Math.round(p * ctx.len);
    if (!force && key === lastKey) return;
    lastKey = key;
    runCrosses(p);
    lastP = p;
    mirror.p = p;
    def.render(p, ctx);
  };

  const fromTrigger = (self: ScrollTrigger, force = false) => {
    ctx.dir = self.direction < 0 ? -1 : 1;
    ctx.len = Math.max(0, self.end - self.start);
    apply(clamp01(self.progress), force);
  };
  const onLive = (self: ScrollTrigger) => fromTrigger(self);

  const desired = (): SeamMode => {
    if (reducedMotion.value) return "final";
    if (when()) return "scroll";
    return def.fallback ? "fallback" : "final";
  };

  const build = () => {
    const mode = desired();
    mirror.mode = mode;
    if (mode === "final") {
      def.reset?.();
      def.final();
      return;
    }
    if (mode === "fallback") {
      undoFallback = def.fallback!();
      return;
    }
    const el = def.trigger();
    if (!el) {
      // Section not in the DOM (yet): the static end state is always safe.
      mirror.mode = "final";
      def.final();
      return;
    }
    st = ScrollTrigger.create({
      id: `seam:${def.id}`,
      trigger: el,
      start: def.start,
      end: def.end,
      invalidateOnRefresh: true,
      onRefreshInit: () => {
        ctx.vw = window.innerWidth;
        ctx.vh = window.innerHeight;
        def.measure?.(ctx);
        // New geometry at the same scroll px must still re-render.
        lastKey = NaN;
      },
      onRefresh: (self) => fromTrigger(self, true),
      onUpdate: onLive,
      onEnter: onLive,
      onLeave: onLive,
      onEnterBack: onLive,
      onLeaveBack: onLive,
      onToggle: (self) => {
        mirror.active = self.isActive;
        def.activate?.(self.isActive);
      },
    });
  };

  const teardown = () => {
    if (st) {
      st.kill();
      st = null;
    }
    if (mirror.active) {
      mirror.active = false;
      def.activate?.(false);
    }
    if (undoFallback) {
      const u = undoFallback;
      undoFallback = null;
      u();
    }
    def.reset?.();
    pending = [];
    primed = false;
    lastKey = NaN;
    lastP = NaN;
  };

  // Remount only when the outcome changes (an MQ flip that leaves the gate
  // where it was must not reset a running seam).
  const onGateChange = () => {
    if (desired() === mirror.mode) return;
    teardown();
    build();
    requestScrollRefresh();
  };

  const offJump = onScrollJump((e) => {
    if (e.phase !== "end" || e.mode !== "cut") return;
    pending = []; // the cut's live crosses: latched, never called
    if (!st) return;
    // Re-render the landing synchronously from the trigger's own range (not
    // st.progress, which ScrollTrigger may not have re-read yet).
    const len = Math.max(0, st.end - st.start);
    const p = len > 0 ? clamp01((st.scroll() - st.start) / len) : st.scroll() >= st.end ? 1 : 0;
    ctx.len = len;
    ctx.jumping = true;
    try {
      apply(p, true);
    } finally {
      ctx.jumping = false;
    }
  });
  const offRm = reducedMotion.subscribe(onGateChange);
  const mqls = SEAM_MQ.queries.map((q) => window.matchMedia(q));
  mqls.forEach((m) => m.addEventListener("change", onGateChange));
  const offLift = refreshScrollOnLoaderLift();

  build();

  return () => {
    offJump();
    offRm();
    mqls.forEach((m) => m.removeEventListener("change", onGateChange));
    offLift();
    teardown();
    if (window.__seams?.[def.id] === mirror) delete window.__seams[def.id];
  };
}

/** React wrapper: mounts the seam in an effect (null = nothing), re-mounting when deps change. */
export function useSeam(def: SeamDef | null, deps: unknown[]): void {
  useEffect(() => {
    if (!def) return;
    return mountSeam(def);
  }, deps);
}
