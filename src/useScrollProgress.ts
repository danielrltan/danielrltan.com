import { useEffect, useRef, useState } from "react";

/**
 * Returns the current window scroll progress as a 0..1 number where
 * 0 = top of page and 1 = bottom of page (last possible scroll
 * position). Updates on scroll events at full rAF cadence, no
 * throttling, fine because the only consumer is camera math that
 * also runs every frame.
 */
export function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);
  // Holds the last value we emitted to React. Change-detection here turns
  // every-scroll-frame setState (one re-render per frame, even on no-op
  // identical values) into setState-only-on-change (re-render solely when
  // the rounded-equal float actually moves).
  const last = useRef(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const max = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const next = Math.max(0, Math.min(1, window.scrollY / max));
      if (next === last.current) return;
      last.current = next;
      setProgress(next);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return progress;
}
