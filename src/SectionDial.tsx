import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { SECTION_REGISTRY } from "./sectionRegistry";
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
 * Motion obeys the project rule: the drum rotation LERPS toward the active
 * section's angle in a rAF loop (never bound directly to scroll), parks when
 * settled, and snaps under prefers-reduced-motion.
 */

const N = SECTION_REGISTRY.length; // 7
const ANGLE = 360 / N; // ~51.43° between faces
const FACE_H = 36; // px height of one number slot
// Radius that tiles N faces of height FACE_H edge-to-edge around the drum.
const RADIUS = Math.round(
  FACE_H / 2 / Math.tan((ANGLE / 2) * (Math.PI / 180)),
); // ≈ 37px

// Mechanical-roll timing. A decaying lerp front-loads the motion — the number
// "flips" almost instantly and the tail crawls, so you can't actually read the
// wheel turning. Instead we run a fixed-duration EASED tween: the drum
// accelerates, rolls the number visibly through the aperture, and decelerates
// into the slot, reading as a real hardware counter. Duration scales with how
// many faces it must travel (each section step rolls for a consistent beat),
// clamped so a multi-section menu jump doesn't drag.
const MS_PER_FACE = 480; // roll time for a single section step
const MIN_ROLL_MS = 300;
const MAX_ROLL_MS = 1200;

// Shortest signed arc from `from` to `to` (so the drum always rolls the short
// way, never 300° around when 60° back is nearer).
function shortestArc(from: number, to: number): number {
  const d = (((to - from) % 360) + 540) % 360 - 180;
  return from + d;
}
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
// easeInOutCubic: accelerate then decelerate. The accel is what sells the
// "wheel spinning up" read that a pure decaying lerp lacks.
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

interface Props {
  activeIdx: number;
  menuOpen: boolean;
  onToggle: () => void;
  cardAria: string;
  isMobile: boolean;
  style?: CSSProperties;
}

export function SectionDial({
  activeIdx,
  menuOpen,
  onToggle,
  cardAria,
  isMobile,
  style,
}: Props) {
  const drumRef = useRef<HTMLDivElement>(null);
  // Rotation lives in a ref (not React state) so the rAF loop mutates the DOM
  // directly and the StatusBar tree never reconciles on a roll frame. The tween
  // is time-based (from→target over `duration`, eased) rather than a decaying
  // lerp, so the drum reads as a real turning wheel.
  const stateRef = useRef({
    current: 0,
    from: 0,
    target: 0,
    startMs: 0,
    duration: 0,
    raf: 0,
    mounted: false,
  });
  const reducedRef = useRef(false);

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
      // left the ±51° neighbours (cos≈0.62) at ~0.79 opacity, so the aperture
      // stacked 00 / 01 / 02 into one unreadable blend (the "weird symbol").
      // Hard-fade anything past ~44° from front to 0; during a roll the rotating
      // pair still briefly co-show (reads as the wheel turning), but at rest a
      // single clean numeral remains.
      const vis = c <= 0.72 ? 0 : Math.pow((c - 0.72) / 0.28, 1.2);
      f.style.opacity = vis.toFixed(3);
      if (i === active) f.setAttribute("data-active", "true");
      else f.removeAttribute("data-active");
    }
  };

  useEffect(() => {
    reducedRef.current =
      typeof window !== "undefined" &&
      !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Roll toward the active section whenever it changes.
  useEffect(() => {
    const s = stateRef.current;
    const goal = -activeIdx * ANGLE;
    // First mount lands on the active face with no spin-up from 0.
    if (!s.mounted) {
      s.mounted = true;
      s.current = goal;
      s.target = goal;
      apply(s.current);
      return;
    }
    const target = shortestArc(s.current, goal);
    // MOBILE: the odometer roll is invisible chrome polish on a phone (the dial
    // is a tiny chit), so skip the per-frame rAF tween and SNAP straight to the
    // target — exactly the reduced-motion path. The drum still lands on the right
    // numeral (apply() runs); we just never spin up the loop. Desktop
    // (isMobile=false) keeps the full mechanical roll, untouched.
    if (reducedRef.current || isMobile) {
      s.current = target;
      s.from = target;
      s.target = target;
      apply(s.current);
      return;
    }
    // (Re)base the tween from wherever the drum is RIGHT NOW, so a section
    // change that lands mid-roll continues smoothly from the current angle
    // instead of snapping. Duration scales with the distance to travel, so each
    // face rolls for a consistent beat (and a big menu jump rolls longer, capped).
    s.from = s.current;
    s.target = target;
    s.startMs = performance.now();
    const dist = Math.abs(target - s.from);
    s.duration = Math.max(
      MIN_ROLL_MS,
      Math.min(MAX_ROLL_MS, (dist / ANGLE) * MS_PER_FACE),
    );
    if (s.raf) return; // a loop is already running; it reads the fresh tween
    const tick = () => {
      const st = stateRef.current;
      const t =
        st.duration > 0
          ? clamp01((performance.now() - st.startMs) / st.duration)
          : 1;
      st.current = st.from + (st.target - st.from) * easeInOutCubic(t);
      apply(st.current);
      if (t >= 1) {
        st.current = st.target;
        apply(st.current);
        st.raf = 0;
        return;
      }
      st.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx]);

  // Cancel any in-flight roll on unmount.
  useEffect(
    () => () => {
      if (stateRef.current.raf) cancelAnimationFrame(stateRef.current.raf);
    },
    [],
  );

  const active = SECTION_REGISTRY[activeIdx] ?? SECTION_REGISTRY[0]!;

  // The hover treatment is now CSS-only (see .snc-dial:hover in
  // crt-channel-menu.css): a calm, SUSTAINED highlight — the ring fades in and
  // a soft orange glow blooms and holds while hovered, with a 1px LIFT (up, not
  // a press-down). The old WAAPI "reticle lock-on" slammed the ring inward and
  // overshot, which read like a click; this reads clearly as hover, leaving the
  // press cue (numblock deep-orange flash on :active) to mean "click".
  return (
    <div
      className="snc-dial"
      role="button"
      tabIndex={0}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      aria-label={cardAria}
      data-mobile={isMobile ? "true" : "false"}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={style}
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
          the dial actually tells you where you are. */}
      <div className="snc-dial-body">
        <span className="snc-dial-label">{active.label}</span>
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
