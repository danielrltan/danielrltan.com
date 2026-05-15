import { useEffect, useRef } from "react";

interface Props {
  /** True while the pointer is over a draggable mesh or drawer. */
  hot: boolean;
}

// Parallax tuning — drift the center dot in the direction of motion so a
// fast flick has trail; small jitter from a steady hand stays at center.
const TRAIL_STRENGTH = 0.45; // how much of the move delta becomes the target
const TRAIL_MAX_PX = 10; // clamp so very fast flicks don't fling it off-screen
const SPRING = 0.22; // per-frame lerp toward the target
const TARGET_DECAY = 0.88; // how fast the target drifts back to 0 when idle

/**
 * White ring + dot cursor. Root translates to the pointer each move; the
 * dot wrapper additionally drifts in the cursor's recent motion direction
 * for a soft trailing feel. Inner `.moveable-cursor__dot` keeps its own
 * CSS `transform: scale(...)` for the hot state, isolated from parallax.
 */
export function MoveableCursor({ hot }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const dotShift = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const rootEl = root.current;
    const shiftEl = dotShift.current;
    if (!rootEl || !shiftEl) return;

    let lastX = 0;
    let lastY = 0;
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let frame = 0;

    const onMove = (e: PointerEvent) => {
      rootEl.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0) translate(-50%,-50%)`;
      // Two cursor "zones": the room (custom cursor) and the PC (system
      // cursor). Any DOM element flagged `data-os-root` (and its
      // descendants) hides the custom cursor smoothly via opacity —
      // matched by `cursor: auto` on the OS root so the system cursor
      // shows in its place.
      const target = e.target as Element | null;
      const overOS = !!target?.closest("[data-os-root]");
      rootEl.style.opacity = overOS ? "0" : "1";

      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const tx = Math.max(
        -TRAIL_MAX_PX,
        Math.min(TRAIL_MAX_PX, dx * TRAIL_STRENGTH),
      );
      const ty = Math.max(
        -TRAIL_MAX_PX,
        Math.min(TRAIL_MAX_PX, dy * TRAIL_STRENGTH),
      );
      // Latest motion overrides previous (no accumulation) so the dot
      // doesn't slingshot when you rapidly change direction.
      targetX = tx;
      targetY = ty;
    };

    const tick = () => {
      curX += (targetX - curX) * SPRING;
      curY += (targetY - curY) * SPRING;
      targetX *= TARGET_DECAY;
      targetY *= TARGET_DECAY;
      shiftEl.style.setProperty("--dot-x", `${curX.toFixed(2)}px`);
      shiftEl.style.setProperty("--dot-y", `${curY.toFixed(2)}px`);
      frame = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={root}
      className={`moveable-cursor${hot ? " moveable-cursor--hot" : ""}`}
      aria-hidden
    >
      <span className="moveable-cursor__ring" />
      <span ref={dotShift} className="moveable-cursor__dot-shift">
        <span className="moveable-cursor__dot" />
      </span>
    </div>
  );
}
