import { useEffect, useRef } from "react";

interface Props {
  /** True while the pointer is over a draggable mesh or drawer. */
  hot: boolean;
}

// Parallax tuning — drift the center dot in the direction of motion so a
// fast flick has trail; small jitter from a steady hand stays at center.
const TRAIL_STRENGTH = 5;
const TRAIL_MAX_PX = 5;
const SPRING = 0.16;
const TARGET_DECAY = 0;

/**
 * White ring + dot cursor for the *room* zone only. Visibility is
 * controlled by the parent — this component is unmounted entirely when
 * the desk view is active (so the OS gets the native system cursor).
 * No per-event DOM-target detection here; that approach was fragile
 * against drei's `<Html>` portal restructuring.
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
