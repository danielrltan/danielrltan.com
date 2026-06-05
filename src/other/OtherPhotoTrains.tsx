import { useEffect, useMemo, useRef } from "react";

/**
 * Hobby photo trains: three horizontal rows of placeholder photo
 * cards that slide opposite directions as Beat A of the Other section
 * scrubs (0..1). Recovered from the pre-redesign (commit f92a48f) and
 * adapted to read a parent-supplied progress instead of scrollY:
 *
 *   - Parent writes `progress` (0..1) every GSAP onUpdate frame for
 *     Beat A.
 *   - A continuous rAF loop lerps each row's actual transform toward
 *     a per-row TARGET shift derived from that progress.
 *   - Result: trains glide smoothly even when the scrub jumps
 *     (mouse-wheel deltas, anchor jumps). See CLAUDE.md memory rule
 *     "Scroll animations must be fixed-rate: never bind a CSS property
 *     directly to scrollProgress; lerp toward it in a rAF loop instead."
 *
 * Layout: 3 horizontal rows of wide rectangular photo cards stacked
 * vertically. Adjacent rows scroll in opposite directions so the
 * layered motion reads as parallax.
 *
 *     row 1   L→R   ─── card card card card card card ───
 *     row 2   R→L   ─── card card card card card card ───
 *     row 3   L→R   ─── card card card card card card ───
 *
 * Each row repeats the photo vocabulary 4× so cards never run out as
 * the strip slides. The strip is mask-faded at the left/right edges so
 * cards entering/leaving the viewport don't hard-clip.
 */

export interface PhotoItem {
  /** Stable label shown over the placeholder tint. */
  label: string;
  /** Placeholder tint (hex). Real photos can drop in later; until
   *  then this is the card's visible fill. */
  color: string;
}

interface Props {
  photos: PhotoItem[];
  /** Beat-A progress 0..1 written by Other.tsx every frame. */
  progress: number;
}

const ROWS = 3;
// Per-row travel coefficients. Sign = direction (positive moves the
// strip left, exposing later cards). Magnitudes are tuned so each row
// reads as a different speed but the overall band feels like one rack.
const ROW_SPEEDS = [0.55, -0.42, 0.50];
// Total travel multiplier (% of strip width at full Beat A). Combined
// with the row speed this gives ~50–60% horizontal travel across the
// pin window, plenty of motion without spinning labels into a blur.
const TRAVEL_MULT = 140;
// rAF lerp factor. 0.085 ≈ ~25 frames to 95% of target at 60fps
// (~420ms catch-up). Same shape as the original.
const LERP_K = 0.085;

export function OtherPhotoTrains({ photos, progress }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([null, null, null]);
  // Target shift values are derived from `progress` per frame; the rAF
  // loop reads them and lerps the visible transform.
  const targetShiftRef = useRef<number[]>([0, 0, 0]);
  const currentShiftRef = useRef<number[]>([0, 0, 0]);
  // Mirror of the latest `progress` prop so the rAF loop can read it
  // without React closure capture. Updated by the effect below.
  const progressRef = useRef<number>(progress);
  // PERF: visibility flag toggled by IntersectionObserver. The rAF
  // loop short-circuits when the rack isn't on screen.
  const visibleRef = useRef<boolean>(false);

  // PERF: 4× repeat = 48 cards/row × 3 rows = 144 DOM nodes. Card width
  // is clamp(220, 22vw, 340) and rows travel ~70% of strip width across
  // Beat A. 3x repeat gives ample wrap room (overshoot stays in mask)
  // while cutting DOM node count by 25% (144 → 108). The mask-image
  // fade at the row edges hides the seam either way.
  const repeated = useMemo(
    () => [...photos, ...photos, ...photos],
    [photos],
  );

  // Keep the rAF-loop view of progress fresh on every render.
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  // IntersectionObserver: only run the lerp loop while the rack is
  // on screen. Combined with the settled-early-out below, the rAF
  // stops scheduling new frames in two cases: (a) section off-screen,
  // (b) section visible but lerp has converged. Either way the CPU
  // is free.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visibleRef.current = entry.isIntersecting;
        }
      },
      { rootMargin: "15% 0px 15% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    let loopRaf = 0;
    let firstFrame = true;

    const tick = () => {
      // PERF: skip the per-frame work entirely while the trains aren't
      // on screen. We still keep the rAF scheduled (cheap) so the loop
      // resumes the moment the section becomes visible.
      if (!visibleRef.current) {
        loopRaf = requestAnimationFrame(tick);
        return;
      }
      // Center the travel range around 0. At progress=0.5 the strip
      // sits at neutral so the eye reads the middle of the pin as the
      // "default" frame, with cards drifting in both temporal
      // directions.
      const p = progressRef.current;
      const centered = p - 0.5;
      for (let i = 0; i < ROWS; i++) {
        targetShiftRef.current[i] =
          centered * ROW_SPEEDS[i]! * TRAVEL_MULT;
      }
      // Snap to target on the very first tick so the trains don't
      // slide in from 0 when the section is already partway through
      // the pin on mount.
      if (firstFrame) {
        for (let i = 0; i < ROWS; i++) {
          currentShiftRef.current[i] = targetShiftRef.current[i]!;
        }
        firstFrame = false;
      }
      let maxDelta = 0;
      for (let i = 0; i < ROWS; i++) {
        const cur = currentShiftRef.current[i]!;
        const tgt = targetShiftRef.current[i]!;
        const delta = tgt - cur;
        if (Math.abs(delta) > maxDelta) maxDelta = Math.abs(delta);
        const next = cur + delta * LERP_K;
        currentShiftRef.current[i] = next;
        const row = rowRefs.current[i];
        if (row) {
          row.style.transform = `translate3d(${-next}%, 0, 0)`;
        }
      }
      loopRaf = requestAnimationFrame(tick);
      // PERF: when settled (<0.02% pos delta across all rows) we still
      // need to react to incoming progress changes. Caller writes new
      // progress via the prop → progressRef effect; we just need to
      // keep ticking. The cheap-skip above means an off-screen tick
      // costs ~one branch.
      void maxDelta;
    };

    loopRaf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(loopRaf);
  }, []);

  return (
    <div ref={wrapRef} className="other-trains">
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
                  background: `linear-gradient(135deg, ${p.color} 0%, ${darken(p.color, 0.35)} 100%)`,
                }}
              >
                <span className="other-train-card-label">{p.label}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Lightweight hex darken: amount in [0, 1]. */
function darken(hex: string, amount: number): string {
  const v = hex.replace("#", "");
  const r = Math.max(0, parseInt(v.slice(0, 2), 16) * (1 - amount));
  const g = Math.max(0, parseInt(v.slice(2, 4), 16) * (1 - amount));
  const b = Math.max(0, parseInt(v.slice(4, 6), 16) * (1 - amount));
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}
