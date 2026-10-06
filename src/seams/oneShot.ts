import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { onScrollJump } from "../scroll";

gsap.registerPlugin(ScrollTrigger);

/**
 * ONE-SHOT arming for touch / phone seam variants (spec §4.3, rule §0.8).
 *
 * Touch scroll is threaded: a JS transform written per scroll frame lags it by
 * a frame and judders. So phones get time-based variants instead: when the
 * element crosses a viewport line, `play(1)` runs a short WAAPI animation or a
 * class toggle; crossing back up (or leaving, per `rearm`) plays it back with
 * `play(-1)`. Built on a NON-scrub ScrollTrigger (enter / leave-back
 * callbacks), which fires on native touch scroll and is not a per-frame write.
 *
 * Plays run a microtask after the crossing, so a cut jump (whose
 * ScrollTrigger.update fires the crossing right before its {end, cut} event)
 * snaps to the landing side's end state with no animation instead. A mount
 * below the line also snaps (no replay of what the visitor never saw happen).
 * Snapping uses `snap(dir)` when given, else `play(dir)` with the returned
 * Animation finished at once: class-toggle callers should pass `snap`.
 */
export function oneShot(opts: {
  /** In-flow element. */
  el: Element;
  /** Viewport fraction its top/centre must cross (default 0.7). */
  line?: number;
  edge?: "top" | "center";
  /** Time-based play (WAAPI / class toggle). */
  play: (dir: 1 | -1) => Animation | Promise<void> | void;
  /** 'leave-back' (default): crossing back up resets. 'leave': also resets once the element has left the top. */
  rearm?: "leave-back" | "leave";
  /** Set the end state for dir with no animation (cut jumps, mount below the line). */
  snap?: (dir: 1 | -1) => void;
}): () => void {
  const line = opts.line ?? 0.7;
  const edge = opts.edge ?? "top";
  const rearmOnLeave = opts.rearm === "leave";

  let state: 0 | 1 = 0;
  let queued: 1 | -1 | null = null;
  let current: Animation | null = null;

  const asAnim = (r: unknown): Animation | null =>
    r && typeof (r as Animation).finish === "function" ? (r as Animation) : null;
  const snapTo = (dir: 1 | -1) => {
    current?.finish();
    current = null;
    if (opts.snap) opts.snap(dir);
    else asAnim(opts.play(dir))?.finish();
  };
  const flush = () => {
    if (queued === null) return;
    const d = queued;
    queued = null;
    current = asAnim(opts.play(d));
  };
  // The first decision after the trigger has real positions (its first
  // toggle or refresh, whichever ScrollTrigger runs first) is a silent snap:
  // a mount below the line lands finished, never replays.
  let primed = false;
  const request = (dir: 1 | -1) => {
    const want = dir === 1 ? 1 : 0;
    if (!primed) {
      primed = true;
      state = want;
      if (dir === 1) snapTo(1);
      return;
    }
    if (want === state) return;
    state = want;
    queued = dir;
    queueMicrotask(flush);
  };

  // Takes the trigger (onRefresh can run inside create(), before `st` is bound).
  const sideOf = (t: ScrollTrigger): 1 | -1 => {
    const s = t.scroll();
    return s >= t.start && (!rearmOnLeave || s <= t.end) ? 1 : -1;
  };
  const st = ScrollTrigger.create({
    trigger: opts.el,
    start: `${edge} ${line * 100}%`,
    end: rearmOnLeave ? "bottom top" : undefined,
    onEnter: () => request(1),
    onLeaveBack: () => request(-1),
    onLeave: rearmOnLeave ? () => request(-1) : undefined,
    onEnterBack: rearmOnLeave ? () => request(1) : undefined,
    onRefresh: (self) => {
      if (!primed) request(sideOf(self));
    },
  });

  const offJump = onScrollJump((e) => {
    if (e.phase !== "end" || e.mode !== "cut") return;
    primed = true;
    const d = sideOf(st);
    const want = d === 1 ? 1 : 0;
    // The cut's own ScrollTrigger.update may already have flipped `state` and
    // queued a play: that counts as a change. Otherwise only a running play is
    // finished (a cut that lands on the same side replays nothing).
    const changed = want !== state || queued !== null;
    state = want;
    queued = null;
    if (changed) snapTo(d);
    else if (current) {
      current.finish();
      current = null;
    }
  });

  return () => {
    offJump();
    st.kill();
    queued = null;
    current?.cancel();
    current = null;
  };
}
