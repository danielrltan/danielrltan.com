import { useEffect, useMemo, useRef, useState } from "react";

/**
 * HTML photo "trains" — 3 horizontal rows stacked vertically, each
 * sliding sideways at a different rate (alternating directions) as
 * the user scrolls vertically through the section. Provides the
 * "indication of scrolling" the user wanted without forcing the
 * carousel-style 3D treatment of the Photos section.
 */

interface Props {
  photos: { color: string; label: string }[];
  sectionRef: React.RefObject<HTMLElement | null>;
}

const ROWS = 3;
// Each row's relative speed (in row-widths per section-scroll). +1 =
// scroll right as user scrolls down; -1 = scroll left. Mixed signs
// give the parallax-y look.
const ROW_SPEEDS = [1.2, -1.0, 0.8];

export function OtherPhotoTrains({ photos, sectionRef }: Props) {
  const [progress, setProgress] = useState(0);

  // Track vertical scroll progress through the section. Same math
  // as PhotosCarousel — section's vertical position relative to
  // viewport mapped to 0..1.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const el = sectionRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = (vh - r.top) / (vh + r.height);
      setProgress(Math.max(0, Math.min(1, p)));
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

  // For visual continuity each row repeats the photo list twice
  // (with different starting offsets) so the slide never reveals
  // empty space at the edges, regardless of which direction it
  // moves.
  const repeated = useMemo(
    () => [...photos, ...photos, ...photos],
    [photos],
  );

  return (
    <div className="other-trains">
      {Array.from({ length: ROWS }).map((_, rowIdx) => {
        // Negative speeds go right-to-left. translateX is
        // proportional to (progress - 0.5) so each row passes through
        // its "centered" position at section midpoint.
        const speed = ROW_SPEEDS[rowIdx]!;
        const shift = (progress - 0.5) * speed * 200; // percent
        return (
          <div key={rowIdx} className="other-train-row">
            <div
              className="other-train-strip"
              style={{
                transform: `translate3d(${-shift}%, 0, 0)`,
              }}
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
        );
      })}
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
