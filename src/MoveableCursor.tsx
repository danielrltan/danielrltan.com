import { useEffect, useRef } from "react";

interface Props {
  /** True while the pointer is over a draggable mesh or drawer. */
  hot: boolean;
}

/**
 * Simple white ring + dot that follows the pointer and “opens up” on
 * moveable targets. Position is written to the DOM on pointermove so the
 * whole tree does not re-render every frame.
 */
export function MoveableCursor({ hot }: Props) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      el.style.transform = `translate3d(${e.clientX}px,${e.clientY}px,0) translate(-50%,-50%)`;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div
      ref={root}
      className={`moveable-cursor${hot ? " moveable-cursor--hot" : ""}`}
      aria-hidden
    >
      <span className="moveable-cursor__ring" />
      <span className="moveable-cursor__dot" />
    </div>
  );
}
