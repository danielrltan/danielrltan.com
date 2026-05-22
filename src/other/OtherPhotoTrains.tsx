import { useEffect, useMemo, useRef } from "react";

/**
 * Hobby photo trains — three horizontal rows that slide opposite
 * directions as the user scrolls vertically through the section.
 *
 * Smoothness strategy (Awwwards-grade, hopefully):
 *   - Scroll-driven target shift updates per scroll event.
 *   - A continuous rAF loop lerps the ACTUAL strip transform toward
 *     that target each frame.
 *   - Result: even if scroll events come in jumpy chunks (Lenis
 *     smoothing, mouse wheel, etc.), the strips glide smoothly to
 *     their target position.
 *
 * Previous version bound the transform DIRECTLY to scrollY: any
 * jitter in scrollY (which Lenis can introduce when it interpolates
 * between scroll deltas) translated 1:1 to jitter in the strip
 * transform. Lerp factor 0.08 absorbs that.
 */

interface Props {
  photos: { color: string; label: string }[];
  sectionRef: React.RefObject<HTMLElement | null>;
}

const ROWS = 3;
// Slow horizontal travel — every label has time to read.
const ROW_SPEEDS = [0.45, -0.38, 0.5];
// Total travel multiplier (in %) at full section progress. Paired
// with the per-row speed so each row's max travel ~25–28% of the
// strip width.
const TRAVEL_MULT = 110;
// Lerp factor per frame. 0.08 = ~25 frames to reach 95% of target
// at 60fps (~400ms catch-up), smooth without feeling laggy.
const LERP_K = 0.08;

export function OtherPhotoTrains({ photos, sectionRef }: Props) {
  const rowRefs = useRef<Array<HTMLDivElement | null>>([null, null, null]);
  // Target shift values are written from scroll handler; the rAF
  // loop reads them and lerps the visible transform.
  const targetShiftRef = useRef<number[]>([0, 0, 0]);
  const currentShiftRef = useRef<number[]>([0, 0, 0]);

  const repeated = useMemo(
    () => [...photos, ...photos, ...photos],
    [photos],
  );

  useEffect(() => {
    let scrollRaf = 0;
    let loopRaf = 0;

    const updateTargets = () => {
      const el = sectionRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = (vh - r.top) / (vh + r.height);
      const clamped = Math.max(0, Math.min(1, p));
      for (let i = 0; i < ROWS; i++) {
        targetShiftRef.current[i] =
          (clamped - 0.5) * ROW_SPEEDS[i]! * TRAVEL_MULT;
      }
    };

    const onScroll = () => {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = requestAnimationFrame(updateTargets);
    };

    // Continuous lerp loop — runs every frame, glides the actual
    // strip transform toward the target. Always rAF, never tied to
    // scroll events directly.
    const tick = () => {
      for (let i = 0; i < ROWS; i++) {
        const cur = currentShiftRef.current[i]!;
        const tgt = targetShiftRef.current[i]!;
        const next = cur + (tgt - cur) * LERP_K;
        currentShiftRef.current[i] = next;
        const row = rowRefs.current[i];
        if (row) {
          row.style.transform = `translate3d(${-next}%, 0, 0)`;
        }
      }
      loopRaf = requestAnimationFrame(tick);
    };

    updateTargets();
    // Snap the initial position to avoid a 25-frame slide-in from 0
    // when the section is already partially visible on mount.
    for (let i = 0; i < ROWS; i++) {
      currentShiftRef.current[i] = targetShiftRef.current[i]!;
    }
    loopRaf = requestAnimationFrame(tick);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(scrollRaf);
      cancelAnimationFrame(loopRaf);
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
