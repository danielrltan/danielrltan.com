import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DECAY, clampDt } from "../motion";
import { onScrollJump } from "../scroll";

/**
 * Photo trains (the Recents section): three horizontal rows of photo cards
 * that slide in opposite directions as the page scrolls through the section.
 * Reads a parent-supplied progress instead of scrollY:
 *
 *   - Photos.tsx writes `progress` (0..1, the "photos-train" span) on every
 *     ScrollTrigger update and calls `wakeRef.current()`.
 *   - A rAF loop damps each row's px shift toward a per-row TARGET derived
 *     from that progress (dt-based, DECAY.soft, so the glide feels the same
 *     at 60 and 120 Hz), rounded to device pixels.
 *   - Once every row has converged the loop writes nothing and SLEEPS until
 *     the next wake (progress change, visibility edge, resize, cut jump).
 *   - A programmatic cut jump lands the rows on target in one frame.
 *
 * Layout: 3 horizontal rows of wide rectangular photo cards stacked
 * vertically. Adjacent rows scroll in opposite directions so the
 * layered motion reads as parallax.
 *
 *     row 1   L→R   ─── card card card card card card ───
 *     row 2   R→L   ─── card card card card card card ───
 *     row 3   L→R   ─── card card card card card card ───
 *
 * Each row repeats the photo vocabulary (repeat count derived from live
 * geometry) so cards never run out as the strip slides; cards hard-clip at
 * the row edges.
 */

interface PhotoItem {
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
  /** Pin progress 0..1, written by Photos.tsx's pin onUpdate into a
   *  REF (not state): as a number prop it re-rendered all ~108 card
   *  nodes on every scroll tick. The rAF loop below reads it directly;
   *  React never re-renders for progress. */
  progressRef: React.MutableRefObject<number>;
  /** Filled by this component with a "progress changed, run the loop"
   *  callback; Photos.tsx calls it from its trigger's onUpdate. */
  wakeRef?: React.MutableRefObject<(() => void) | null>;
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
// (Motion pass note: the measure below was silently dead until now. It
// queried `.other-train-strip` INSIDE the strip element itself, found
// nothing, and every row ran on the 15% seed. It now measures the strip
// directly, in px, and applies COVERAGE to the FULL sweep as documented.)
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
// full sweep (progress 0 → 1) covers one unique-photo chunk
// (chunkCount * pitch) × COVERAGE. Then every unique photo crosses the
// centre of the clear window across a pass at any viewport size.
// Re-measured on mount + resize + visible edge. COVERAGE > 1 adds a little
// margin so even the chunk-edge photos read fully, not just peek. If the
// parade reads too slow, raise it (spec: 1.12 → 1.3).
const TRAVEL_COVERAGE = 1.12;
// Never slide a strip end into its row: cap the half-travel at the strip's
// overhang past the row edge, minus this many px of safety.
const TRAVEL_EDGE_GUARD_PX = 24;
// Follow rate: DECAY.soft (τ ≈ 167ms), frame-rate independent.
// NOTE: the trains deliberately do NOT use the sitewide pixel-grid
// quantised writes (hero hover / marquees): an 8px-stepped slide over
// PHOTOGRAPHS read as lag rather than pixel-art, per user. Continuous
// imagery wants continuous motion (rounded only to DEVICE pixels, so the
// photos stay crisp); the stepped voice stays on type and chrome.
const FOLLOW_RATE = DECAY.soft;
// Converged when every row is this close to its target (px). ~0.002% of a
// ~6000px strip; below it the loop snaps to target, writes once, sleeps.
const CONVERGE_PX = 0.12;

export const OtherPhotoTrains = memo(function OtherPhotoTrains({
  photos,
  progressRef,
  wakeRef,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // The three sliding STRIPS (one per row; the row box clips them).
  const rowRefs = useRef<Array<HTMLDivElement | null>>([null, null, null]);
  // Per-row HALF-travel in px, measured from live geometry (see
  // measureTravel). centered ∈ [-0.5, 0.5] → centered*2 maps to [-1, 1], so
  // at the span extremes the strip shifts ±travelPx. Seeded to a sane
  // non-zero so the first frames before measurement still drift.
  const travelPxRef = useRef<number[]>([900, 900, 900]);
  // Starts/resumes the (sleeping) follow loop; set by the loop effect.
  const wakeLoopRef = useRef<() => void>(() => {});
  // Set true on the IO visible-rising edge so the tick re-measures travel
  // ONCE when the rack scrolls into view. Catches geometry that settled
  // after the initial mount measure WITHOUT firing a window 'resize' (font
  // load, iOS URL-bar svh shift, the post-loading ScrollTrigger.refresh that
  // re-lays-out the pin). One measure on entry, not a per-frame layout read.
  const needsMeasureRef = useRef<boolean>(true);
  // PERF: visibility flag toggled by IntersectionObserver. Off-screen the
  // loop lands the rows on target and sleeps instead of gliding.
  const visibleRef = useRef<boolean>(false);

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

  // IntersectionObserver: the follow loop only glides while the rack is on
  // screen. It stops scheduling frames in two cases: (a) section off-screen
  // (rows land on target first), (b) every row has converged. Either way
  // the CPU is free until the next wake.
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
          // Either edge runs the loop: rising to follow, falling so it can
          // land the rows on target and go to sleep.
          wakeLoopRef.current();
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
  //   travelPx    = chunkWidth * COVERAGE / 2  (HALF-travel: centered*2 maps
  //                 [-0.5,0.5] → [-1,1] in the tick, so the full sweep is
  //                 chunkWidth * COVERAGE), capped at the strip's overhang
  // Runs a handful of times (mount, resize, photo-set change, visible edge),
  // never per scroll frame, so the layout reads here are cheap.
  const measureTravel = useCallback(
    () => {
      const per = Math.ceil(items.length / ROWS);
      for (let i = 0; i < ROWS; i++) {
        const strip = rowRefs.current[i];
        const firstCard = strip?.querySelector<HTMLElement>(".other-train-card");
        if (!strip || !firstCard) continue;
        const stripW = strip.offsetWidth;
        const rowW = strip.parentElement?.clientWidth ?? 0;
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
        const overhang = Math.max(0, (stripW - rowW) / 2 - TRAVEL_EDGE_GUARD_PX);
        travelPxRef.current[i] = Math.min(
          (chunkWidth * TRAVEL_COVERAGE) / 2,
          overhang,
        );
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
    let raf = requestAnimationFrame(() => {
      measureTravel();
      wakeLoopRef.current();
    });
    const onResize = () => {
      // Also flag the tick to re-measure on next visible frame, in case the
      // resize changed the card clamp while the section is off-screen.
      needsMeasureRef.current = true;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        measureTravel();
        wakeLoopRef.current();
      });
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [measureTravel, rowStrips]);

  useEffect(() => {
    const cur = [0, 0, 0];
    const tgt = [0, 0, 0];
    // Last device-px value written per row (NaN = never), so a converged or
    // sub-device-px step writes nothing.
    const written = [NaN, NaN, NaN];
    let loopRaf = 0;
    let running = false;
    let lastT = 0;
    // Land on target (no glide): the first frame after mount (the section
    // may already be mid-span) and the frame after a programmatic cut jump.
    let snapNext = true;

    const write = (i: number) => {
      const strip = rowRefs.current[i];
      if (!strip) return;
      const dpr = window.devicePixelRatio || 1;
      // Negative: a positive shift slides the strip left (as before).
      const px = Math.round(-cur[i]! * dpr) / dpr;
      if (px === written[i]) return;
      written[i] = px;
      strip.style.transform = `translate3d(${px}px, 0, 0)`;
    };

    const tick = (now: number) => {
      // Real rAF dt (first frame after a wake: one nominal frame).
      const dt = lastT ? clampDt((now - lastT) / 1000) : 1 / 60;
      lastT = now;
      const visible = visibleRef.current;
      // Consume a pending re-measure (visible-rising edge / off-screen
      // resize). One layout read on entry, never every frame.
      if (visible && needsMeasureRef.current) {
        needsMeasureRef.current = false;
        measureTravel();
      }
      // Center the travel range around 0: at progress 0.5 the strip sits at
      // neutral, with cards drifting in both directions either side.
      const centered = progressRef.current - 0.5;
      for (let i = 0; i < ROWS; i++) {
        // Sign from ROW_DIRS gives the alternating-row parallax direction.
        tgt[i] = centered * 2 * ROW_DIRS[i]! * travelPxRef.current[i]!;
      }
      // Off-screen there is nothing to glide for: land and sleep.
      const snap = snapNext || !visible;
      snapNext = false;
      const k = 1 - Math.exp(-FOLLOW_RATE * dt);
      let converged = true;
      for (let i = 0; i < ROWS; i++) {
        const d = tgt[i]! - cur[i]!;
        if (snap || Math.abs(d) < CONVERGE_PX) cur[i] = tgt[i]!;
        else {
          cur[i] = cur[i]! + d * k;
          converged = false;
        }
        write(i);
      }
      if (converged) {
        // Sleep until the next wake (progress update, IO edge, resize, cut).
        running = false;
        lastT = 0;
        return;
      }
      loopRaf = requestAnimationFrame(tick);
    };

    const wake = () => {
      if (running) return;
      running = true;
      loopRaf = requestAnimationFrame(tick);
    };
    wakeLoopRef.current = wake;
    if (wakeRef) wakeRef.current = wake;
    const stopJumps = onScrollJump((e) => {
      if (e.phase !== "end" || e.mode !== "cut") return;
      snapNext = true;
      wake();
    });
    wake();
    return () => {
      stopJumps();
      cancelAnimationFrame(loopRaf);
      running = false;
      wakeLoopRef.current = () => {};
      if (wakeRef) wakeRef.current = null;
    };
  }, [measureTravel, progressRef, wakeRef]);

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
