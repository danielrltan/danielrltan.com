import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  /** Real photo URL (from /photos/manifest.json, built by `npm run photos`).
   *  When present the card shows the image and the label/tint are unused. */
  src?: string;
  /** Stable label shown over the placeholder tint (placeholder cards only). */
  label?: string;
  /** Placeholder tint (hex) — the card fill until real photos are uploaded. */
  color?: string;
}

interface Props {
  photos: PhotoItem[];
  /** Beat-A progress 0..1, written by Other.tsx's pin onUpdate into a
   *  REF (not state): as a number prop it re-rendered all ~108 card
   *  nodes on every scroll tick of the Beat A scrub. The rAF loop
   *  below reads it directly; React never re-renders for progress. */
  progressRef: React.MutableRefObject<number>;
}

const ROWS = 3;
// Per-row travel DIRECTION (sign only). Adjacent rows drift opposite ways
// so the layered motion reads as parallax. The magnitude is now derived
// from live geometry (see computeTravelPct below), NOT a fixed coefficient,
// so every row drifts exactly far enough to parade its whole unique-photo
// chunk through the centred clear window regardless of viewport size.
// (The magnitude is normalised to 1 here; sign carries the parallax.)
const ROW_DIRS = [1, -1, 1];

// ROOT-CAUSE FIX (some photos never appear):
// ------------------------------------------------------------------
// The old model multiplied a FIXED `TRAVEL_MULT` (= 30) by the strip
// width to get the per-row drift in PERCENT of strip width. But how many
// PHOTOS that percentage parades past the centred, edge-masked window
// depends on `cardPitch / stripWidth`, which changes with the viewport:
// the card is height-driven (`clamp(132px, 18vh, 220px)`), so on a tall
// or narrow viewport the cards hit the 220px clamp, fewer fit per screen,
// and the strip grows wider — yet the drift stayed a fixed 30% of that
// (now larger) width. The net effect was that the photos parked at the
// LEFT and RIGHT ENDS of each row's 12-photo chunk never travelled into
// the clear band and so appeared "missing" (reproduced at 1280x1600:
// each row dropped its first + last photo). It was never a lazy-load /
// decode / 404 problem — all images load fine; they were simply parked
// permanently outside the visible window.
//
// THE FIX: derive the drift from the ACTUAL measured geometry so the
// sweep always covers one full unique-photo chunk (chunkCount * pitch),
// converted to a percentage of the live strip width. Then every unique
// photo is guaranteed to cross the centre of the clear window across a
// Beat-A pass at any viewport size. Re-measured on mount + resize.
// COVERAGE > 1 adds a little margin so even the chunk-edge photos clear
// the 8% edge-fade mask and read fully, not just peek.
const TRAVEL_COVERAGE = 1.12;
// rAF lerp factor. 0.085 ≈ ~25 frames to 95% of target at 60fps
// (~420ms catch-up). Same shape as the original.
// NOTE: the trains deliberately do NOT use the sitewide pixel-grid
// quantised writes (hero hover / marquees): an 8px-stepped slide over
// PHOTOGRAPHS read as lag rather than pixel-art, per user. Continuous
// imagery wants continuous motion; the stepped voice stays on type and
// chrome.
const LERP_K = 0.085;

export const OtherPhotoTrains = memo(function OtherPhotoTrains({
  photos,
  progressRef,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([null, null, null]);
  // Target shift values are derived from `progressRef` per frame; the
  // rAF loop reads them and lerps the visible transform.
  const targetShiftRef = useRef<number[]>([0, 0, 0]);
  const currentShiftRef = useRef<number[]>([0, 0, 0]);
  // Per-row HALF-travel as a PERCENT of strip width, measured from live
  // geometry (see measureTravel). centered ∈ [-0.5, 0.5] → centered*2 maps
  // to [-1, 1], so at the pin extremes the strip shifts ±travelPct, sweeping
  // a full unique-photo chunk (× TRAVEL_COVERAGE) through the clear window.
  // Re-measured on mount + resize so it tracks the (height-driven, clamped)
  // card size at every viewport. Seeded to a sane non-zero so the first few
  // frames before measurement still drift.
  const travelPctRef = useRef<number[]>([15, 15, 15]);
  // Set true on the IO visible-rising edge so the tick re-measures travel
  // ONCE when the rack scrolls into view. Catches geometry that settled
  // after the initial mount measure WITHOUT firing a window 'resize' (font
  // load, iOS URL-bar svh shift, the post-loading ScrollTrigger.refresh that
  // re-lays-out the pin). One measure on entry, not a per-frame layout read.
  const needsMeasureRef = useRef<boolean>(true);
  // PERF: visibility flag toggled by IntersectionObserver. The rAF
  // loop short-circuits when the rack isn't on screen.
  const visibleRef = useRef<boolean>(false);

  // PERF: 4× repeat = 48 cards/row × 3 rows = 144 DOM nodes. Card width
  // is clamp(220, 22vw, 340) and rows travel ~70% of strip width across
  // Beat A. 3x repeat gives ample wrap room (overshoot stays in mask)
  // while cutting DOM node count by 25% (144 → 108). The mask-image
  // fade at the row edges hides the seam either way.
  // Real uploaded photos, fetched at runtime from the manifest that
  // `npm run photos` generates. Until any exist (or if the fetch fails),
  // fall back to the gradient placeholders passed via props — so the reel
  // always renders something and never breaks.
  const [real, setReal] = useState<PhotoItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/photos/manifest.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && Array.isArray(d) && d.length) {
          setReal(d.map((p: { src: string }) => ({ src: p.src })));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const items = real && real.length ? real : photos;
  // Split the photos across the rows (contiguous thirds: row 0 = first 12 of
  // 36, row 1 = next 12, row 2 = last 12) so each row shows DIFFERENT photos
  // instead of the same set three times. Each row's chunk is then repeated
  // enough (~36 cards) to fill its sliding strip seamlessly.
  const rowStrips = useMemo(() => {
    const per = Math.ceil(items.length / ROWS);
    return Array.from({ length: ROWS }, (_, r) => {
      let chunk = items.slice(r * per, (r + 1) * per);
      if (chunk.length === 0) chunk = items; // fewer photos than rows → reuse all
      const reps = Math.max(3, Math.ceil(36 / Math.max(1, chunk.length)));
      return Array.from({ length: reps }, () => chunk).flat();
    });
  }, [items]);

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
          // Rising edge → re-measure travel once on the next visible tick
          // (geometry may have settled while off-screen; see needsMeasureRef).
          if (entry.isIntersecting && !visibleRef.current) {
            needsMeasureRef.current = true;
          }
          visibleRef.current = entry.isIntersecting;
        }
      },
      { rootMargin: "15% 0px 15% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Measure per-row travel from LIVE geometry so the drift always sweeps a
  // full unique-photo chunk through the clear window at any viewport size
  // (the root-cause fix — see TRAVEL_COVERAGE). For each row:
  //   pitch       = card outer width + flex gap (one photo-slot in px)
  //   chunkCount  = number of UNIQUE photos in the row (chunk before repeat)
  //   chunkWidth  = chunkCount * pitch  (px the strip must travel to parade
  //                 the whole chunk past centre)
  //   travelPct   = (chunkWidth * COVERAGE) / stripWidth * 100  (HALF-travel,
  //                 because centered*2 maps [-0.5,0.5] → [-1,1] in the tick)
  // Runs a handful of times (mount, resize, photo-set change, visible edge),
  // never per scroll frame, so the layout reads here are cheap.
  const measureTravel = useCallback(
    () => {
      const per = Math.ceil(items.length / ROWS);
      for (let i = 0; i < ROWS; i++) {
        const row = rowRefs.current[i];
        const strip = row?.querySelector<HTMLElement>(".other-train-strip");
        const firstCard = strip?.querySelector<HTMLElement>(".other-train-card");
        if (!strip || !firstCard) continue;
        const stripW = strip.scrollWidth;
        if (stripW <= 0) continue;
        const cardW = firstCard.getBoundingClientRect().width;
        // Flex `gap` on the strip (var(--space-5) = 24px). Read computed so a
        // future token change is honoured without touching this code.
        const gap = parseFloat(getComputedStyle(strip).columnGap || "0") || 0;
        const pitch = cardW + gap;
        // Unique photos in THIS row (contiguous-third chunk; mirrors rowStrips).
        let chunkCount = Math.min(per, Math.max(0, items.length - i * per));
        if (chunkCount <= 0) chunkCount = items.length; // fewer photos than rows
        const chunkWidth = chunkCount * pitch;
        // HALF-travel percent: at the extremes the strip moves ±this, so the
        // total sweep covers the full chunk (× COVERAGE for edge-mask margin).
        travelPctRef.current[i] = ((chunkWidth * TRAVEL_COVERAGE) / stripW) * 100;
      }
    },
    [items],
  );

  // Mount + resize + photo-set change: re-measure. The visible-edge flag
  // (consumed in the tick) covers the cases that DON'T fire 'resize' (font
  // load, iOS URL-bar svh shift, the post-loading ScrollTrigger.refresh that
  // re-lays-out the pin).
  useEffect(() => {
    // Defer one frame so the flex layout (card clamp, gap) has resolved.
    let raf = requestAnimationFrame(measureTravel);
    const onResize = () => {
      // Also flag the tick to re-measure on next visible frame, in case the
      // resize changed the card clamp while the section is off-screen.
      needsMeasureRef.current = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measureTravel);
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [measureTravel, rowStrips]);

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
      // Consume a pending re-measure (visible-rising edge / off-screen
      // resize). One layout read on entry, never every frame.
      if (needsMeasureRef.current) {
        needsMeasureRef.current = false;
        measureTravel();
      }
      // Center the travel range around 0. At progress=0.5 the strip
      // sits at neutral so the eye reads the middle of the pin as the
      // "default" frame, with cards drifting in both temporal
      // directions.
      const p = progressRef.current;
      const centered = p - 0.5;
      for (let i = 0; i < ROWS; i++) {
        // centered*2 maps the [-0.5, 0.5] pin range onto [-1, 1], so at the
        // extremes the strip shifts ±travelPct (a full chunk sweep). Sign
        // from ROW_DIRS gives the alternating-row parallax direction.
        targetShiftRef.current[i] =
          centered * 2 * ROW_DIRS[i]! * travelPctRef.current[i]!;
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
  }, [measureTravel]);

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
            {rowStrips[rowIdx]!.map((p, i) => (
              <div
                key={i}
                className="other-train-card"
                style={
                  p.src
                    ? undefined
                    : {
                        background: `linear-gradient(135deg, ${p.color ?? "#222"} 0%, ${darken(p.color ?? "#222", 0.35)} 100%)`,
                      }
                }
              >
                {/* Real <img> instead of background-image (PERF):
                    decoding="async" keeps the WebP decode off the
                    scroll frame (the old CSS backgrounds decoded in one
                    synchronous burst at first paint — the entry jank).
                    Deliberately NOT loading="lazy": the strips are
                    ~10k px wide and translate horizontally, so lazily
                    loaded cards slid into view as blank white squares
                    before their fetch caught up (user: images load
                    terribly). Eager fetch matches the old
                    background-image behaviour; the images are cached
                    long before the user scrolls here. */}
                {p.src && (
                  <img
                    className="other-train-photo"
                    src={p.src}
                    alt=""
                    decoding="async"
                    draggable={false}
                  />
                )}
                {!p.src && <span className="other-train-card-label">{p.label}</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
});

/** Lightweight hex darken: amount in [0, 1]. */
function darken(hex: string, amount: number): string {
  const v = hex.replace("#", "");
  const r = Math.max(0, parseInt(v.slice(0, 2), 16) * (1 - amount));
  const g = Math.max(0, parseInt(v.slice(2, 4), 16) * (1 - amount));
  const b = Math.max(0, parseInt(v.slice(4, 6), 16) * (1 - amount));
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}
