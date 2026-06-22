import { useEffect, useRef } from "react";

interface Props {
  /** True while the pointer is over a draggable mesh or drawer. */
  hot: boolean;
}

/**
 * Custom site pointer: a sharp PIXEL-STYLE ARROW in the accent orange with a
 * dark keyline (the site hides the OS cursor with `cursor: none`). A small
 * "rice grain" trails behind the tip on fast movement — the site's
 * rice/pixel motif — and springs back to the tip when the pointer rests.
 * The arrow presses in on click and grows + glows over interactive room
 * meshes (`hot`). Mounted at the App level so it's the cursor everywhere; the
 * keypad and jump-menu layer their own in-canvas cursor treatments on top.
 *
 * Replaces the previous plain ring+dot. The arrow's TIP is the hotspot, so
 * the root element is a 0×0 anchor placed exactly at the pointer and the SVG
 * is drawn with its tip at the local origin.
 */
const TRAIL_SPRING = 0.22; // how fast the grain catches up to the tip
const TRAIL_MAX_PX = 16; // clamp the lag so the grain never flies off

export function MoveableCursor({ hot }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const trail = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const rootEl = root.current;
    const trailEl = trail.current;
    if (!rootEl || !trailEl) return;

    let px = 0;
    let py = 0; // live pointer
    let tx = 0;
    let ty = 0; // trailing grain (springs toward the pointer)
    let revealed = false;
    let frame = 0;
    // Hidden until the first real pointer position so it doesn't ghost at
    // the viewport origin on load (same guard as the old cursor).
    rootEl.style.opacity = "0";

    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      rootEl.style.transform = `translate3d(${px}px,${py}px,0)`;
      if (!revealed) {
        revealed = true;
        rootEl.style.opacity = "1";
        tx = px;
        ty = py; // seed the grain at the tip so it doesn't streak in from (0,0)
      }
    };

    const tick = () => {
      // Spring the grain toward the pointer; the lag (grain − pointer) points
      // opposite the travel direction, i.e. BEHIND the arrow tip.
      tx += (px - tx) * TRAIL_SPRING;
      ty += (py - ty) * TRAIL_SPRING;
      let ox = tx - px;
      let oy = ty - py;
      const len = Math.hypot(ox, oy);
      if (len > TRAIL_MAX_PX) {
        const k = TRAIL_MAX_PX / len;
        ox *= k;
        oy *= k;
      }
      trailEl.style.setProperty("--trail-x", `${ox.toFixed(2)}px`);
      trailEl.style.setProperty("--trail-y", `${oy.toFixed(2)}px`);
      // Fade the grain in with the lag amount so it only shows while moving.
      trailEl.style.opacity = Math.min(1, len / TRAIL_MAX_PX).toFixed(3);
      frame = requestAnimationFrame(tick);
    };

    // Click reaction: pulse a press keyframe on the arrow. Force a reflow so
    // rapid clicks restart it cleanly.
    const onDown = () => {
      rootEl.classList.remove("moveable-cursor--click");
      void rootEl.offsetWidth;
      rootEl.classList.add("moveable-cursor--click");
    };
    const onAnimEnd = (e: AnimationEvent) => {
      if (e.animationName.startsWith("moveable-cursor-press")) {
        rootEl.classList.remove("moveable-cursor--click");
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    rootEl.addEventListener("animationend", onAnimEnd);
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      rootEl.removeEventListener("animationend", onAnimEnd);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={root}
      className={`moveable-cursor${hot ? " moveable-cursor--hot" : ""}`}
      aria-hidden
    >
      {/* Trailing rice grain (behind the tip on motion). */}
      <span ref={trail} className="moveable-cursor__trail" />
      {/* Pixel arrow — tip at the local origin (the hotspot). */}
      <svg
        className="moveable-cursor__arrow"
        viewBox="0 0 11 18"
        width="14"
        height="23"
        aria-hidden
      >
        <path
          d="M0 0 L0 15.2 L3.6 11.8 L6.1 17.6 L8.2 16.6 L5.6 10.9 L10.4 10.9 Z"
          fill="var(--accent, #e87040)"
          stroke="#1b1209"
          strokeWidth="1.1"
          strokeLinejoin="miter"
          paintOrder="stroke"
        />
      </svg>
    </div>
  );
}
