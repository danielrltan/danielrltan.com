import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { SECTION_REGISTRY } from "./sectionRegistry";
import { DUR, EASE_CSS, SPRING, reducedMotion, stepSpring, toMs } from "./motion";
import { onScrollJump } from "./scroll";
// Own the dial's styles EAGERLY. crt-channel-menu.css was previously imported
// only by NavSpillMenu, which is lazy-loaded on idle (~1.5s) — so the dial
// (rendered immediately by StatusBar) painted UNSTYLED until that chunk landed:
// a tall vertical placeholder showing the bare section number stacked over the
// "About" label (the FOUC the user saw on scroll out of the hero). Importing it
// here folds the dial's CSS into the eager bundle so it's styled from first
// paint. The CSS split never saved anything — the heavy deps (three/drei/gsap)
// live in NavSpillMenu's JS, not this stylesheet.
import "./crt-channel-menu.css";

/**
 * SECTION DIAL — a compact horizontal HUD chit whose section number is a
 * skeuomorphic odometer drum. The numbers live on a REAL CSS-3D cylinder
 * (each face is `rotateX(i·θ) translateZ(R)`); as you navigate the site the
 * drum physically rolls up/down so the current section's number lands in the
 * orange aperture, like a hardware counter wheel. The label + MENU trigger sit
 * beside it so the whole thing is a short horizontal bar (it does not tower
 * down over the scene the way a tall square dial did).
 *
 * Depth is honest, not faked: curvature shading is per-face OPACITY computed
 * from the cosine of each face's angle-from-front (faces curling away fade
 * out) — no glossy/sheen gradients anywhere. The housing speaks the site's
 * block language: flat fills, sharp corners, a hard blur-free box-shadow
 * extrusion, a clip-path notch.
 *
 * Motion obeys the project rule: the drum angle is a critically damped SPRING
 * (motion.ts SPRING.dial) stepped in a rAF loop toward the active section's
 * angle (never bound directly to scroll). It parks when settled and snaps
 * under reduced motion, on mobile, while the dial is hidden, and on a cut jump.
 */

const N = SECTION_REGISTRY.length; // 8
const ANGLE = 360 / N; // 45° between faces
const FACE_H = 36; // px height of one number slot
// Radius that tiles N faces of height FACE_H edge-to-edge around the drum.
const RADIUS = Math.round(
  FACE_H / 2 / Math.tan((ANGLE / 2) * (Math.PI / 180)),
); // ≈ 43px

// Mechanical roll (motion spec W7.8). The drum angle follows a critically
// damped spring (ω 20 rad/s, ζ 1: a single-face step settles in ~250 ms).
// A new section RETARGETS the spring without touching its velocity, so a fast
// scroll through several sections keeps the wheel spinning instead of
// stopping dead at each boundary (the old fixed-duration ease-in-out tween
// re-based from zero velocity on every retarget and hitched).
const DIAL_SPRING = SPRING.dial;
/** Parked once within this many degrees and deg/s of the target. */
const SETTLE_DEG = 0.02;
const SETTLE_VEL = 0.5;
/** The label swaps once the drum has covered this fraction of the arc that
 *  remained at the retarget, so the word changes as the numeral crosses the
 *  aperture (not the instant the roll starts). */
const LABEL_SWAP_AT = 0.5;
/** Label crossfade (s). */
const LABEL_FADE_S = DUR.press;
/** Rolls that start this soon after a cut jump's `end` snap instead: the
 *  section change a cut causes commits a frame or two after the event. */
const CUT_SNAP_WINDOW_MS = 250;

// Shortest signed arc from `from` to `to` (so the drum always rolls the short
// way, never 300° around when 60° back is nearer).
function shortestArc(from: number, to: number): number {
  const d = (((to - from) % 360) + 540) % 360 - 180;
  return from + d;
}

export type DialHudState = "hidden" | "menu" | "shown";

interface Props {
  activeIdx: number;
  menuOpen: boolean;
  onToggle: () => void;
  cardAria: string;
  isMobile: boolean;
  /** HUD chrome state (see HUD CHROME in crt-channel-menu.css). Anything but
   *  "shown" also makes rolls snap: nobody is watching the drum. */
  hud?: DialHudState;
  /** Entrance delay (CSS time) applied to the shown state. */
  hudDelay?: string;
  style?: CSSProperties;
}

export function SectionDial({
  activeIdx,
  menuOpen,
  onToggle,
  cardAria,
  isMobile,
  hud = "shown",
  hudDelay = "0s",
  style,
}: Props) {
  const drumRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const ghostRef = useRef<HTMLSpanElement>(null);
  // The label's JSX child is FROZEN at the mount-time label: from then on the
  // text is written imperatively (at the LABEL_SWAP_AT point of the roll), and
  // a changing JSX child would make React overwrite it on every activeIdx
  // render, swapping the word at the START of the roll again.
  const [initialLabel] = useState(
    () => (SECTION_REGISTRY[activeIdx] ?? SECTION_REGISTRY[0]!).label,
  );
  // Drum state lives in a ref (not React state) so the rAF loop mutates the
  // DOM directly and the StatusBar tree never reconciles on a roll frame.
  const stateRef = useRef({
    x: 0, // drum angle (deg)
    v: 0, // angular velocity (deg/s)
    target: 0,
    from: 0, // angle at the last retarget (label swap progress is measured from here)
    labelIdx: activeIdx, // section whose label is showing
    pendingLabel: activeIdx, // section whose label should show once LABEL_SWAP_AT is crossed
    raf: 0,
    lastT: 0,
    mounted: false,
    cutSnapUntil: 0,
  });
  // Latest props for the rAF loop / jump subscriber without re-subscribing.
  const snapPropRef = useRef(false);
  snapPropRef.current = isMobile || hud !== "shown";

  // Write the drum rotation + per-face curvature opacity + active flag to the
  // DOM. Active face = the one whose world angle is nearest the front (0°),
  // derived from the rotation itself so it always matches the visual.
  const apply = (rot: number) => {
    const drum = drumRef.current;
    if (!drum) return;
    drum.style.transform = `rotateX(${rot.toFixed(3)}deg)`;
    const active = (((Math.round(-rot / ANGLE) % N) + N) % N);
    const faces = drum.children;
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i] as HTMLElement;
      // World angle of face i, normalised to [-180, 180].
      const world = (((i * ANGLE + rot) % 360) + 540) % 360 - 180;
      const c = Math.cos((world * Math.PI) / 180);
      // Only the FRONT-most face shows. The shallow old falloff (pow(c,0.7))
      // left the neighbours at ~0.79 opacity, so the aperture stacked
      // 00 / 01 / 02 into one unreadable blend (the "weird symbol"). Hard-fade
      // anything past ~44° from front to 0; during a roll the rotating pair
      // still briefly co-show (reads as the wheel turning), but at rest a
      // single clean numeral remains.
      const vis = c <= 0.72 ? 0 : Math.pow((c - 0.72) / 0.28, 1.2);
      f.style.opacity = vis.toFixed(3);
      if (i === active) f.setAttribute("data-active", "true");
      else f.removeAttribute("data-active");
    }
  };

  // Swap the readout to section `idx`: a DUR.press crossfade (incoming label
  // over the outgoing ghost), or a plain text write when `instant`.
  const showLabel = (idx: number, instant: boolean) => {
    const s = stateRef.current;
    s.labelIdx = idx;
    s.pendingLabel = idx;
    const label = labelRef.current;
    const ghost = ghostRef.current;
    if (!label) return;
    const text = (SECTION_REGISTRY[idx] ?? SECTION_REGISTRY[0]!).label;
    if (label.textContent === text) return;
    const prev = label.textContent ?? "";
    label.textContent = text;
    if (instant || reducedMotion.value || typeof label.animate !== "function") {
      if (ghost) ghost.textContent = "";
      return;
    }
    const opts: KeyframeAnimationOptions = {
      duration: toMs(LABEL_FADE_S),
      easing: EASE_CSS.out,
    };
    label.animate([{ opacity: 0 }, { opacity: 1 }], opts);
    if (ghost) {
      ghost.textContent = prev;
      const out = ghost.animate([{ opacity: 1 }, { opacity: 0 }], opts);
      out.onfinish = () => {
        // Only the latest fade clears the ghost (an older one finishing late
        // must not blank a newer outgoing label).
        if (ghost.getAnimations().length === 0) ghost.textContent = "";
      };
    }
  };

  // Jump to the target now (drum + label), parking any running roll.
  const snapToTarget = () => {
    const s = stateRef.current;
    if (s.raf) {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
    }
    s.x = s.target;
    s.v = 0;
    s.from = s.target;
    apply(s.x);
    showLabel(s.pendingLabel, true);
  };

  const tick = () => {
    const s = stateRef.current;
    const now = performance.now();
    const dt = (now - s.lastT) / 1000;
    s.lastT = now;
    [s.x, s.v] = stepSpring(s.x, s.v, s.target, dt, DIAL_SPRING.omega, DIAL_SPRING.zeta);
    const settled =
      Math.abs(s.target - s.x) < SETTLE_DEG && Math.abs(s.v) < SETTLE_VEL;
    if (settled) {
      s.x = s.target;
      s.v = 0;
    }
    apply(s.x);
    if (s.pendingLabel !== s.labelIdx) {
      const arc = s.target - s.from;
      const covered = Math.abs(arc) < 1e-6 ? 1 : (s.x - s.from) / arc;
      if (settled || covered >= LABEL_SWAP_AT) showLabel(s.pendingLabel, false);
    }
    if (settled) {
      s.raf = 0;
      return;
    }
    s.raf = requestAnimationFrame(tick);
  };

  // Roll toward the active section whenever it changes.
  useEffect(() => {
    const s = stateRef.current;
    const goal = -activeIdx * ANGLE;
    // First mount lands on the active face with no spin-up from 0.
    if (!s.mounted) {
      s.mounted = true;
      s.x = goal;
      s.target = goal;
      s.from = goal;
      s.v = 0;
      apply(s.x);
      showLabel(activeIdx, true);
      return;
    }
    s.target = shortestArc(s.x, goal);
    s.from = s.x;
    s.pendingLabel = activeIdx;
    // Snap instead of rolling when nobody would see (or want) the roll:
    // reduced motion, MOBILE (the roll is invisible polish on a tiny chit),
    // the dial hidden (HUD not in yet / menu open), or a cut jump just landed.
    if (
      reducedMotion.value ||
      snapPropRef.current ||
      performance.now() < s.cutSnapUntil
    ) {
      snapToTarget();
      return;
    }
    // Retarget only: x and v carry on, so a roll in progress continues
    // smoothly (velocity-continuous) toward the new face.
    if (s.raf) return; // a loop is already running; it reads the new target
    s.lastT = performance.now();
    s.raf = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx]);

  // Cut jump (menu jump, covered jump-to-top, footer): snap the drum to where
  // it's going in the same frame, and snap the retarget the cut causes.
  useEffect(
    () =>
      onScrollJump((e) => {
        if (e.phase !== "end" || e.mode !== "cut") return;
        stateRef.current.cutSnapUntil = performance.now() + CUT_SNAP_WINDOW_MS;
        snapToTarget();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Cancel any in-flight roll on unmount.
  useEffect(
    () => () => {
      if (stateRef.current.raf) cancelAnimationFrame(stateRef.current.raf);
      stateRef.current.raf = 0;
    },
    [],
  );

  // The hover treatment is now CSS-only (see .snc-dial:hover in
  // crt-channel-menu.css): a calm, SUSTAINED highlight — the ring fades in and
  // a soft orange glow blooms and holds while hovered, with a 1px LIFT (up, not
  // a press-down). The old WAAPI "reticle lock-on" slammed the ring inward and
  // overshot, which read like a click; this reads clearly as hover, leaving the
  // press cue (numblock deep-orange flash on :active) to mean "click".
  return (
    <div
      className="snc-dial hud-chrome"
      role="button"
      tabIndex={0}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-label={cardAria}
      data-mobile={isMobile ? "true" : "false"}
      data-hud={hud}
      inert={hud === "hidden"}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{ ...style, ["--hud-delay" as string]: hudDelay }}
    >
      {/* Orange number block: the 3D drum rolls vertically inside it. */}
      <div className="snc-dial-numblock" aria-hidden>
        <div className="snc-dial-window">
          <div className="snc-dial-drum" ref={drumRef}>
            {SECTION_REGISTRY.map((s, i) => (
              <div
                key={s.number}
                className="snc-dial-face"
                style={{
                  transform: `rotateX(${i * ANGLE}deg) translateZ(${RADIUS}px)`,
                }}
              >
                <span className="snc-dial-num">{s.number}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* White readout body: the CURRENT section's title (Work, Play, ...) so
          the dial actually tells you where you are. Text written by showLabel;
          the ghost carries the outgoing word through the crossfade. */}
      <div className="snc-dial-body">
        <span className="snc-dial-label" ref={labelRef}>
          {initialLabel}
        </span>
        <span className="snc-dial-label-ghost" ref={ghostRef} aria-hidden />
      </div>

      {/* Trigger: grid glyph that fills orange on hover/open so the bar reads
          as a button (the "MENU" word was stating the obvious). */}
      <div className="snc-dial-trigger" aria-hidden>
        <span className="snc-dial-grid">
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}
