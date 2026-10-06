import { SEAM, SEAM_MQ, ease } from "../motion";
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
 * then hangs almost still in mid-air (a shallow arc down and left) while the
 * dark Mac housing scrolls away 1:1 and Work rises underneath, and lands on
 * Work's node 0 ([data-seam-target="work-node-0"], W3) when Work's top reaches
 * SEAM.relayDockAt (28%). At that same scroll position the overlay hides, node
 * 0 lights and the spine starts drawing from it (Work.tsx 'work-spine').
 *
 * Why it barely moves on screen: the source (the CRT centre on the released
 * sticky stage) and the target (node 0) both travel 1:1 with scroll, so the
 * lerp between them reads as a slow glide, not a flight. Flat paint only: a
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
// Arc depth of the glide as a fraction of vh, bowing toward the lower left.
const ARC_VH = 0.06;

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
  let ctxRef: SeamCtx | null = null;

  const work = () => document.querySelector<HTMLElement>(".portfolio-work");

  const draw = (p: number, ctx: SeamCtx) => {
    if (!dot) return;
    if (!n0 || p <= 0 || p >= 1) {
      dot.style.opacity = "0";
      return;
    }
    const vh = ctx.vh;
    const s = start + p * ctx.len;
    const crt = seamBus.crtLocal ?? fallback;
    const S = { x: stickyLeft + crt.x, y: hold.stageTopAt(s) + crt.y };
    const T = { x: n0.x, y: workTop + n0.y - s };
    const w = ease.inOutCubic(seg(p, a, 1));
    // Unit normal of the S -> T chord, the one pointing down-left.
    const dx = T.x - S.x;
    const dy = T.y - S.y;
    const d = Math.hypot(dx, dy) || 1;
    let nx = -dy / d;
    let ny = dx / d;
    if (ny - nx < 0) {
      nx = -nx;
      ny = -ny;
    }
    const bow = ARC_VH * vh * Math.sin(Math.PI * w);
    const x = lerp(S.x, T.x, w) + nx * bow;
    const y = lerp(S.y, T.y, w) + ny * bow;
    const size = w < 0.92 ? SEAM.relayPx : lerp(SEAM.relayPx, n0.size, seg(w, 0.92, 1));
    dot.style.transform = `translate3d(${(x - size / 2).toFixed(2)}px, ${(y - size / 2).toFixed(2)}px, 0) scale(${(size / SEAM.relayPx).toFixed(4)})`;
    dot.style.opacity = clamp01(seg(p, 0, a)).toFixed(3);
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
