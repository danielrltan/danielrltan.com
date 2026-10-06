import { SEAM, SEAM_MQ } from "../motion";
import { claimOverlay, releaseOverlay } from "../seams/overlay";
import { mountSeam, type SeamCtx } from "../seams/seam";
import { seamBus } from "../seams/bus";
import { clamp01, lerp, seg } from "../seams/curves";
import type { SoftHold } from "../seams/softHold";
import { MAC_BEATS } from "../macintosh/macBeats";

/**
 * Seam 3, projects -> work: the PIXEL RELAY (spec .scratch/seams/SPEC.md §5.3).
 *
 * Owner brief (2026-10-06): "one workstation, one signal, never stopping".
 * The CRT powers off by scroll to a single signal-orange dot (MacintoshScene,
 * uPowerOff / uDot). Across the last 0.06vh of the Mac hold that shader dot
 * fades out exactly under one 12px #ff4f00 DOM pixel on #seam-layer, which
 * then runs like a signal trace (down past Work's title, along the gap under
 * Work's header, down onto the node; rounded corners) while the dark Mac
 * housing scrolls away 1:1 and Work rises underneath, and lands on
 * Work's node 0 ([data-seam-target="work-node-0"], W3) when Work's top reaches
 * SEAM.relayDockAt (28%). At that same scroll position the overlay hides, node
 * 0 lights and the spine starts drawing from it (Work.tsx 'work-spine').
 *
 * The source (the CRT centre on the released sticky stage) and the target
 * (node 0) both travel 1:1 with scroll, so the trace is a fixed shape in
 * Work's frame that rides up with the page while the pixel runs it at a
 * near-constant pace. Flat paint only: a
 * square with two flat square halo rings, no blur, no comet trail (§8).
 *
 * Desktop with a fine pointer only (the single #seam-layer claimant). Touch
 * and phones get W3's one-shot node drop; reduced motion gets nothing (the
 * static landed Mac, a fully drawn spine). If node 0 is missing (Work markup
 * changed) the relay stays off and the shader dot simply fades: nothing
 * dangles.
 *
 * render(p) is a pure function of p (the scroll position is derived from it),
 * so it reverses exactly on scroll-up and lands right after a cut jump.
 */

const ORANGE = "#ff4f00";
// Corner radius (px) of the routed trace, and the clearance the down-lane
// keeps from the right end of Work's title.
const CORNER_PX = 48;
const LANE_CLEAR_PX = 24;
// Speed profile: ease in and out over the first / last 20% with a constant
// cruise between (peak speed 1.25x the mean; an inOutCubic peaks at 1.5x).
const RAMP = 0.2;
const cruise = (t: number) => {
  const v = 1 / (1 - RAMP);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < RAMP) return (v * t * t) / (2 * RAMP);
  if (t > 1 - RAMP) return 1 - (v * (1 - t) * (1 - t)) / (2 * RAMP);
  return v * (t - RAMP / 2);
};

type Pt = { x: number; y: number };
/**
 * A polyline with rounded corners, sampled to a dense point list with
 * cumulative lengths, so a fraction of its length maps to a point. Pure.
 */
function tracePoint(pts: Pt[], f: number): Pt {
  const dense: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1]!;
    const c = pts[i]!;
    const p1 = pts[i + 1]!;
    const l0 = Math.hypot(c.x - p0.x, c.y - p0.y);
    const l1 = Math.hypot(p1.x - c.x, p1.y - c.y);
    const r = Math.min(CORNER_PX, l0 / 2, l1 / 2);
    if (!(r > 0.5)) {
      dense.push(c);
      continue;
    }
    const a = { x: c.x + ((p0.x - c.x) / l0) * r, y: c.y + ((p0.y - c.y) / l0) * r };
    const b = { x: c.x + ((p1.x - c.x) / l1) * r, y: c.y + ((p1.y - c.y) / l1) * r };
    for (let k = 0; k <= 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      dense.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y });
    }
  }
  dense.push(pts[pts.length - 1]!);
  let total = 0;
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    total += Math.hypot(dense[i]!.x - dense[i - 1]!.x, dense[i]!.y - dense[i - 1]!.y);
    cum.push(total);
  }
  const want = clamp01(f) * total;
  for (let i = 1; i < dense.length; i++) {
    if (cum[i]! >= want) {
      const seg0 = cum[i]! - cum[i - 1]!;
      const t = seg0 > 0 ? (want - cum[i - 1]!) / seg0 : 0;
      return { x: lerp(dense[i - 1]!.x, dense[i]!.x, t), y: lerp(dense[i - 1]!.y, dense[i]!.y, t) };
    }
  }
  return dense[dense.length - 1]!;
}

export function mountMacRelay(opts: {
  /** The Mac hold (softHold 'mac-pin'): its pure stageTopAt is the source's y. */
  hold: SoftHold;
  /** .mac-sticky, the stage the CRT centre (seamBus.crtLocal) is relative to. */
  sticky: HTMLElement;
}): () => void {
  const { hold, sticky } = opts;
  // Range: Work top at 106% (= the Mac hold end - dotFadeLead: the hand-off
  // starts as the shader dot starts fading) -> Work top at relayDockAt.
  const startFrac = 1 + MAC_BEATS.dotFadeLead;
  const endFrac = SEAM.relayDockAt;
  // a: the share of the range spent cross-fading over the shader dot (glued).
  const a = MAC_BEATS.dotFadeLead / (startFrac - endFrac);

  let dot: HTMLElement | null = null;
  let lastP = 0;
  // Measured in measure() (doc px): range start, Work doc top, node 0 centre
  // and size relative to Work's doc top, the sticky's left edge, and a
  // fallback CRT centre (the stage centre) for before the scene publishes.
  let start = 0;
  let workTop = 0;
  let n0: { x: number; y: number; size: number } | null = null;
  let stickyLeft = 0;
  let fallback = { x: 0, y: 0 };
  // The trace's lanes (Work-relative px): the down-lane must clear the right
  // end of Work's title (laneMinX, viewport x), and the cross-lane runs in the
  // gap between Work's header and its first row (gapY).
  let laneMinX = -Infinity;
  let gapY = 0;
  let ctxRef: SeamCtx | null = null;

  const work = () => document.querySelector<HTMLElement>(".portfolio-work");

  const draw = (p: number, ctx: SeamCtx) => {
    if (!dot) return;
    if (!n0 || p <= 0 || p >= 1) {
      dot.style.opacity = "0";
      return;
    }
    const s = start + p * ctx.len;
    const crt = seamBus.crtLocal ?? fallback;
    // Everything below is in WORK-relative px (y from Work's top): after the
    // release the CRT and Work both scroll 1:1, so the source is (almost) a
    // fixed point of Work's frame and the trace is a fixed shape that rides
    // up with Work while the pixel runs along it.
    const wt = workTop - s; // Work's top on screen
    const S = { x: stickyLeft + crt.x, y: hold.stageTopAt(s) + crt.y - wt };
    const T = { x: n0.x, y: n0.y };
    const lane = Math.max(S.x, laneMinX);
    const w = cruise(seg(p, a, 1));
    const q = tracePoint(
      [S, { x: lane, y: gapY }, { x: T.x, y: gapY }, T],
      w,
    );
    const x = q.x;
    const y = q.y + wt;
    const size = w < 0.92 ? SEAM.relayPx : lerp(SEAM.relayPx, n0.size, seg(w, 0.92, 1));
    dot.style.transform = `translate3d(${(x - size / 2).toFixed(2)}px, ${(y - size / 2).toFixed(2)}px, 0) scale(${(size / SEAM.relayPx).toFixed(4)})`;
    // Opaque by half-way through the cross-fade: two identical squares
    // cross-faded linearly dip to ~75% coverage mid-way (a visible blink);
    // the pixel is on top, so it can be fully in while the dot fades below.
    dot.style.opacity = clamp01(seg(p, 0, a / 2)).toFixed(3);
  };

  return mountSeam({
    id: "projects-work",
    when: SEAM_MQ.fine,
    trigger: work,
    start: `top ${Math.round(startFrac * 100)}%`,
    end: `top ${Math.round(endFrac * 100)}%`,
    measure(ctx) {
      ctxRef = ctx;
      const el = work();
      const sy = window.scrollY;
      workTop = el ? el.getBoundingClientRect().top + sy : 0;
      start = workTop - startFrac * ctx.vh;
      const sr = sticky.getBoundingClientRect();
      stickyLeft = sr.left;
      fallback = { x: sticky.offsetWidth / 2, y: sticky.offsetHeight / 2 };
      const t = document.querySelector<HTMLElement>('[data-seam-target="work-node-0"]');
      if (el && t) {
        const r = t.getBoundingClientRect();
        n0 = {
          x: r.left + r.width / 2,
          y: r.top + sy + r.height / 2 - workTop,
          size: Math.max(1, Math.min(r.width, r.height)),
        };
        // Owner-facing reason for the route (2026-10-06 filmstrip review): a
        // straight glide from the CRT centre to node 0 dragged the pixel
        // through the "Experience" title, where it read as a stray glyph.
        // Instead the signal runs like a trace: down past the title's right
        // end, left along the gap under the header, down onto the node.
        const title = el.querySelector("h2");
        if (title) {
          const range = document.createRange();
          range.selectNodeContents(title);
          const tr = range.getBoundingClientRect();
          laneMinX = tr.width > 0 ? tr.right + LANE_CLEAR_PX + SEAM.relayPx / 2 : -Infinity;
        } else laneMinX = -Infinity;
        const head = el.querySelector("header") ?? title;
        const headBottom = head ? head.getBoundingClientRect().bottom + sy - workTop : n0.y - 4 * SEAM.relayPx;
        const row = t.closest("li");
        const rowTop = row ? row.getBoundingClientRect().top + sy - workTop : n0.y - 2 * SEAM.relayPx;
        gapY = Math.min((headBottom + rowTop) / 2, n0.y - SEAM.relayPx);
      } else n0 = null;
    },
    render(p, ctx) {
      lastP = p;
      draw(p, ctx);
    },
    activate(on) {
      if (on && n0) {
        dot = claimOverlay("projects-work");
        if (!dot) return;
        const st = dot.style;
        st.position = "absolute";
        st.left = "0";
        st.top = "0";
        st.width = `${SEAM.relayPx}px`;
        st.height = `${SEAM.relayPx}px`;
        st.background = ORANGE;
        // Two flat square halo rings (no blur): the signal's glow, in pixels.
        st.boxShadow = "0 0 0 2px rgba(255,79,0,.25), 0 0 0 4px rgba(255,79,0,.12)";
        st.transformOrigin = "0 0";
        st.willChange = "transform, opacity";
        st.opacity = "0";
        if (ctxRef) draw(lastP, ctxRef);
      } else {
        dot = null;
        releaseOverlay("projects-work");
      }
    },
    final() {
      // Nothing to show: reduced motion / touch have no overlay.
    },
    reset() {
      dot = null;
      releaseOverlay("projects-work");
    },
  });
}
