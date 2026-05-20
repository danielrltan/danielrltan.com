import { useEffect, useRef, useState } from "react";

/**
 * Custom cursor composed of small dots.
 *
 * Design rationale (asked the user to think carefully):
 *
 * - Identity: 5 white "rice" dots + 1 orange accent dot. Same dot
 *   vocabulary as the hero rice-dot background, so the cursor reads
 *   as "of this world" rather than a separate UI element.
 *
 * - Inversion: every outer dot uses mix-blend-mode: difference, so it
 *   self-inverts against any background — white on dark, near-black
 *   on light. The orange center dot intentionally does NOT blend
 *   (mix-blend-mode: normal) so the brand orange always shows through
 *   regardless of background, giving the cursor a permanent warm
 *   anchor point.
 *
 * - Shape vocabulary: TWO states, plus smooth morph between them.
 *   - normal:  5 dots in a tight arrow-leaning cluster (~10px wide).
 *              The eye registers it as a small pointer but with
 *              character — not a single dot, not a hard arrow shape.
 *   - select:  the same 5 dots fan out into an evenly-spaced ring
 *              (~28px diameter) and the orange center scales up.
 *              Reads as "this is clickable" the way a hover-pointer
 *              would, but in the cursor's own language.
 *
 * - Transition: cx / cy / r on each circle are animated via CSS
 *   transitions (240ms, cubic-bezier(0.4, 0, 0.2, 1)) so the morph
 *   between modes feels like a single fluid breathing motion rather
 *   than two separate states snapping.
 *
 * - Tracking: cursor follows raw mousemove (no easing) so the
 *   pointer stays glued to the user's input — that's a basic
 *   responsiveness expectation. Any easing happens in the dot
 *   positions themselves, not in the pointer-follow.
 *
 * - Select detection: pointermove → elementFromPoint → closest
 *   interactive selector. Cheap; no per-element listeners to
 *   maintain as the DOM changes.
 *
 * - Hidden during loading via html.loading-active in index.css.
 */

const RADIUS_DOT_NORMAL = 1.8;
const RADIUS_DOT_SELECT = 1.6;
const RADIUS_CENTER_NORMAL = 1.6;
const RADIUS_CENTER_SELECT = 3.2;

// Tight arrow-leaning cluster (origin at center). Reads as a small
// directional cursor without committing to a single arrow shape.
const NORMAL_DOTS = [
  { x: -3.2, y: -3.0 },
  { x: 1.2, y: -2.6 },
  { x: 3.4, y: 0.6 },
  { x: 0.0, y: 2.6 },
  { x: -3.4, y: 2.4 },
];

// Same 5 dots evenly spaced on a circle.
const SELECT_RING_RADIUS = 13;
const SELECT_DOTS = Array.from({ length: 5 }, (_, i) => {
  const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Math.cos(a) * SELECT_RING_RADIUS,
    y: Math.sin(a) * SELECT_RING_RADIUS,
  };
});

const INTERACTIVE_SELECTOR =
  'button, a[href], [role="button"], [data-cursor="select"], input, textarea, select, summary, label[for]';

export function CursorDots() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"normal" | "select">("normal");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let raf = 0;
    let lastInteractive = false;

    const onMove = (e: PointerEvent) => {
      // Pointer follow is direct — no easing on translate. The dots
      // animate their own positions via CSS transitions; the cursor
      // itself stays glued to the user's hand.
      root.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;

      // Throttle elementFromPoint via rAF so we're not doing it on
      // every single pointermove tick (can fire 200+/s on a fast
      // trackpad).
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const isInteractive =
          !!el && !!(el as Element).closest(INTERACTIVE_SELECTOR);
        if (isInteractive !== lastInteractive) {
          lastInteractive = isInteractive;
          setMode(isInteractive ? "select" : "normal");
        }
      });
    };

    const onLeave = () => {
      root.style.opacity = "0";
    };
    const onEnter = () => {
      root.style.opacity = "1";
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerenter", onEnter);
    document.addEventListener("pointerleave", onLeave);

    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerenter", onEnter);
      document.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const dots = mode === "normal" ? NORMAL_DOTS : SELECT_DOTS;
  const dotRadius =
    mode === "normal" ? RADIUS_DOT_NORMAL : RADIUS_DOT_SELECT;
  const centerRadius =
    mode === "normal" ? RADIUS_CENTER_NORMAL : RADIUS_CENTER_SELECT;

  const SVG_TRANSITION = "cx 240ms cubic-bezier(0.4, 0, 0.2, 1), cy 240ms cubic-bezier(0.4, 0, 0.2, 1), r 220ms cubic-bezier(0.4, 0, 0.2, 1)";

  return (
    <div
      ref={rootRef}
      aria-hidden
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: 40,
        height: 40,
        marginLeft: -20,
        marginTop: -20,
        zIndex: 9999,
        pointerEvents: "none",
        transform: "translate3d(-100px, -100px, 0)",
        transition: "opacity 200ms ease",
      }}
    >
      <svg width="40" height="40" viewBox="-20 -20 40 40">
        {/* Outer rice dots — invert via mix-blend-mode: difference so
            they read against any background colour or value. */}
        {dots.map((d, i) => (
          <circle
            key={i}
            cx={d.x}
            cy={d.y}
            r={dotRadius}
            fill="#ffffff"
            style={{
              mixBlendMode: "difference",
              transition: SVG_TRANSITION,
            }}
          />
        ))}
        {/* Orange center — anchor point that stays orange against
            every background. Touch of warmth, doesn't invert. */}
        <circle
          cx={0}
          cy={0}
          r={centerRadius}
          fill="#e87040"
          style={{ transition: SVG_TRANSITION }}
        />
      </svg>
    </div>
  );
}
