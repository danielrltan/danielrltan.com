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
// Relative speed per row. Sign = direction. Slowed dramatically
// from [1.6, -1.3, 1.1] → [0.45, -0.38, 0.5] per user feedback:
// "scrolling here increments these too fast, you need to slow down
// scrolling here and allow these all to get shown." The strips
// were sliding by faster than the eye could pick out individual
// hobby labels.
const ROW_SPEEDS = [0.45, -0.38, 0.5];

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
        // "rest position" at section midpoint. Travel multiplier
        // 280 → 110: paired with the slower ROW_SPEEDS, total
        // travel per row across the full section scroll is now
        // ~50% of strip width (was ~450%). Every hobby label has
        // time to be read instead of blurring past.
        const shift = (clamped - 0.5) * speed * 110;
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
