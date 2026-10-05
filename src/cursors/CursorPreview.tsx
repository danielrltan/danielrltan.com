import { useEffect, useRef } from "react";
import { CURSORS, mountCursor } from "./index";

/**
 * ?cursor=N on the live site: swaps MoveableCursor for cursor-lab design N
 * (src/cursors) over the real page. Lazy-loaded by App only when the param is
 * present, so normal visitors never fetch any of it. Same contract as
 * MoveableCursor: a fixed z-10000 layer, html.custom-cursor (which hides the
 * OS arrow, index.css) only once the first mouse move has placed it, and the
 * keypad's `hot` signal counts as hovering something clickable.
 */
export function CursorPreview({ id, hot }: { id: number; hot: boolean }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const engRef = useRef<ReturnType<typeof mountCursor> | null>(null);

  useEffect(() => {
    const layer = layerRef.current;
    const info = CURSORS.find((c) => c.id === id);
    if (!layer || !info) return;
    const eng = mountCursor(info, document.body, layer);
    engRef.current = eng;
    const onFirst = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      document.documentElement.classList.add("custom-cursor");
      window.removeEventListener("pointermove", onFirst);
    };
    window.addEventListener("pointermove", onFirst, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onFirst);
      document.documentElement.classList.remove("custom-cursor");
      eng.destroy();
      engRef.current = null;
    };
  }, [id]);

  useEffect(() => {
    engRef.current?.setHot(hot);
  }, [hot]);

  return (
    <div
      ref={layerRef}
      className="cursor-preview"
      aria-hidden
      style={{ position: "fixed", inset: 0, zIndex: 10000, pointerEvents: "none" }}
    />
  );
}

export default CursorPreview;
