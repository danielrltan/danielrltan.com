import { useEffect, useRef } from "react";

/**
 * Right-edge vertical progress rail. Thin track + travelling bar +
 * section ticks. Tick positions are tuned to land with StatusBar's
 * section-badge label swaps.
 */
const TICK_POSITIONS = [0.0, 0.10, 0.22, 0.36, 0.52, 0.66, 0.80, 0.92];

const ACTIVE_TICK = "var(--accent)";
const INACTIVE_TICK = "rgba(13, 14, 16, 0.28)";

export function ScrollRail() {
  // OLD: consumed useScrollProgress()'s continuous value, so the whole rail
  // subtree (bar height %, 8 tick colors, % label) reconciled every scroll
  // frame the float moved (one React render + 10 vdom diffs per frame).
  // NEW: ref + CSS-var idiom (mirrors StatusBar) — a single rAF/scroll
  // handler writes a CSS var + the label textContent and toggles only the
  // tick(s) that crossed; the component itself never re-renders on scroll.
  const containerRef = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const tickRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    let raf = 0;
    let lastProgress = -1;
    // -1 so the first paint forces every tick into its correct color.
    let lastActiveCount = -1;
    const update = () => {
      const max = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const progress = Math.max(0, Math.min(1, window.scrollY / max));
      if (progress === lastProgress) return;
      lastProgress = progress;

      // Drive bar height + label position off one CSS var via calc().
      containerRef.current?.style.setProperty(
        "--rail-progress",
        String(progress),
      );

      const label = labelRef.current;
      if (label) {
        label.textContent = String(Math.round(progress * 100)).padStart(2, "0");
      }

      // Number of ticks whose threshold has been passed (progress >= t).
      // Positions are ascending, so this count == active prefix length.
      let activeCount = 0;
      for (const t of TICK_POSITIONS) {
        if (progress >= t) activeCount++;
      }
      if (activeCount !== lastActiveCount) {
        // Only touch ticks whose state actually flipped this frame.
        const lo = Math.min(activeCount, lastActiveCount < 0 ? 0 : lastActiveCount);
        const hi = lastActiveCount < 0 ? TICK_POSITIONS.length : Math.max(activeCount, lastActiveCount);
        for (let i = lo; i < hi; i++) {
          const el = tickRefs.current[i];
          if (el) el.style.background = i < activeCount ? ACTIVE_TICK : INACTIVE_TICK;
        }
        lastActiveCount = activeCount;
      }
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

  return (
    <div
      ref={containerRef}
      aria-hidden
      style={
        {
          position: "fixed",
          right: 28,
          top: "18%",
          bottom: "18%",
          width: 1,
          background: "var(--ink-hairline)",
          zIndex: 30,
          pointerEvents: "none",
          // Initialised here so the first frame (before rAF) reads 0.
          "--rail-progress": "0",
        } as React.CSSProperties
      }
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: -1,
          width: 3,
          height: "calc(var(--rail-progress) * 100%)",
          background: "var(--accent)",
        }}
      />
      {TICK_POSITIONS.map((t, i) => (
        <span
          key={i}
          ref={(el) => {
            tickRefs.current[i] = el;
          }}
          style={{
            position: "absolute",
            left: -3,
            top: `${t * 100}%`,
            width: 7,
            height: 1,
            // Initial color matches progress 0 (only the t=0 tick active);
            // the rAF handler corrects everything on first paint.
            background: t <= 0 ? ACTIVE_TICK : INACTIVE_TICK,
            transition: "background 200ms ease",
          }}
        />
      ))}
      <span
        ref={labelRef}
        style={{
          position: "absolute",
          top: "calc(var(--rail-progress) * 100%)",
          right: 12,
          transform: "translateY(-50%)",
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          letterSpacing: "0.18em",
          color: "var(--ink-muted)",
          fontVariantNumeric: "tabular-nums",
          background: "rgba(238, 240, 243, 0.85)",
          padding: "2px 6px",
          whiteSpace: "nowrap",
        }}
      >
        00
      </span>
    </div>
  );
}
