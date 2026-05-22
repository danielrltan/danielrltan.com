import { useEffect, useMemo, useRef } from "react";

/**
 * Hobby photo trains — three horizontal rows that slide opposite
 * directions as the user scrolls vertically through the section.
 *
 * Performance note: previous version updated React state on every
 * scroll frame, which reconciled the WHOLE strip + its repeated
 * children on every rAF → janky scroll. Rebuilt to write transforms
 * DIRECTLY to refs in a rAF loop with NO state — the strips
 * themselves never re-render after mount.
 */

interface Props {
  photos: { color: string; label: string }[];
  sectionRef: React.RefObject<HTMLElement | null>;
}

const ROWS = 3;
// Relative speed per row. Sign = direction. Magnitude > 1 means the
// strip moves faster than the user's scroll progress through the
// section.
const ROW_SPEEDS = [1.6, -1.3, 1.1];

export function OtherPhotoTrains({ photos, sectionRef }: Props) {
  const rowRefs = useRef<Array<HTMLDivElement | null>>([null, null, null]);

  // Repeat the photos 3x per row so the strip is always wider than
  // the viewport regardless of which direction it's translating.
  const repeated = useMemo(
    () => [...photos, ...photos, ...photos],
    [photos],
  );

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const el = sectionRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // 0 = section just appeared at viewport bottom
      // 1 = section just exited viewport top
      const p = (vh - r.top) / (vh + r.height);
      const clamped = Math.max(0, Math.min(1, p));
      for (let i = 0; i < ROWS; i++) {
        const row = rowRefs.current[i];
        if (!row) continue;
        const speed = ROW_SPEEDS[i]!;
        // Anchor at (clamped - 0.5) so each row passes through its
        // "rest position" at section midpoint. Width 280% of strip
        // gives meaningful travel even on smaller viewports.
        const shift = (clamped - 0.5) * speed * 280;
        row.style.transform = `translate3d(${-shift}%, 0, 0)`;
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
  }, [sectionRef]);

  return (
    <div className="other-trains">
      {Array.from({ length: ROWS }).map((_, rowIdx) => (
        <div key={rowIdx} className="other-train-row">
          <div
            ref={(el) => {
              rowRefs.current[rowIdx] = el;
            }}
            className="other-train-strip"
          >
            {repeated.map((p, i) => (
              <div
                key={i}
                className="other-train-card"
                style={{
                  background: `linear-gradient(135deg, ${p.color}, ${darken(p.color, 0.35)})`,
                }}
              >
                <span>{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function darken(hex: string, amount: number): string {
  const v = hex.replace("#", "");
  const r = Math.max(0, parseInt(v.slice(0, 2), 16) * (1 - amount));
  const g = Math.max(0, parseInt(v.slice(2, 4), 16) * (1 - amount));
  const b = Math.max(0, parseInt(v.slice(4, 6), 16) * (1 - amount));
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}
