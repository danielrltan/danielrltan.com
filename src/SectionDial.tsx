import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import { SECTION_REGISTRY } from "./sectionRegistry";

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

// Shortest signed arc from `from` to `to` (so the drum always rolls the short
// way, never 300° around when 60° back is nearer).
function shortestArc(from: number, to: number): number {
  const d = (((to - from) % 360) + 540) % 360 - 180;
  return from + d;
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
  // directly and the StatusBar tree never reconciles on a roll frame.
  const stateRef = useRef({ current: 0, target: 0, raf: 0, mounted: false });
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
      // cos<=0 → facing away → invisible; else a gentle falloff toward the rim.
      f.style.opacity = c <= 0.02 ? "0" : Math.pow(c, 0.7).toFixed(3);
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
    s.target = shortestArc(s.current, goal);
    if (reducedRef.current) {
      s.current = s.target;
      apply(s.current);
      return;
    }
    if (s.raf) return; // a loop is already running; it reads the new target
    const tick = () => {
      const st = stateRef.current;
      const d = st.target - st.current;
      if (Math.abs(d) < 0.05) {
        st.current = st.target;
        apply(st.current);
        st.raf = 0;
        return;
      }
      st.current += d * 0.16; // fixed-rate lerp (never bound to scroll)
      apply(st.current);
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
