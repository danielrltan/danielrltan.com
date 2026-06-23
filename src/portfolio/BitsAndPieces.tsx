import { useEffect, useRef, useState, useCallback } from "react";
import "./sections.css";
import "./bits-and-pieces.css";
import { ScrambleText } from "./ScrambleText";

/**
 * Bits and Pieces: full-bleed accomplishments spread. Stats band
 * (count-up numbers), a category marquee that ticks with scroll, and
 * a uniform card grid led by a hero row of the three marquee wins
 * (same width as the rest, but taller with a bigger pulled-out metric).
 * Cards reveal via IntersectionObserver as they enter viewport.
 */

type Category =
  | "Hackathon"
  | "Competition"
  | "Grant"
  | "Leadership"
  | "Scholarship";

interface Entry {
  category: Category;
  title: string;
  /** Pulled-out metric: printed huge in the card's "stat slot". */
  metric?: string;
  /** Optional smaller secondary metric (e.g. "Top 50 / 2000+"). */
  context?: string;
  blurb?: string;
  /** Featured items get a larger card. */
  featured?: boolean;
}

// DOM order IS visual order: the three featured wins lead so they pack into
// the top row as a uniform hero band (taller cards + bigger metric), then the
// supporting items follow in category groups. With 3 featured + 9 supporting
// and a 3-up grid, every row fills cleanly (1 hero row + 3 supporting rows),
// so card edges align top-to-bottom with no ragged trailing column.
const ENTRIES: Entry[] = [
  // --- Hero row: the three marquee placements, each with a verified metric ---
  {
    category: "Hackathon",
    title: "Hack The 6ix",
    metric: "Finalist",
    context: "Top 1% · 400+",
    blurb: "Revamp universal BMS for second-life EV modules.",
    featured: true,
  },
  {
    category: "Competition",
    title: "WFN Odyssey Cup",
    metric: "1st",
    context: "$500",
    blurb: "Western Founders Network annual venture competition.",
    featured: true,
  },
  {
    category: "Competition",
    title: "TRREB 2024",
    metric: "2nd",
    context: "$2,500",
    blurb: "Toronto Regional Real Estate Board student competition.",
    // Third hero: carries a verified metric ("2nd") + context ("$2,500"), so
    // it earns the headline row alongside Hack The 6ix and WFN Odyssey.
    featured: true,
  },
  // --- Supporting grid ---
  {
    category: "Competition",
    title: "IBM Watsonx Orchestrate",
    metric: "Top 50",
    context: "of 2000+",
    blurb: "Global agentic-AI build challenge.",
  },
  {
    category: "Competition",
    title: "TD Innovation Sprint",
    metric: "Finalist",
  },
  {
    category: "Grant",
    title: "Ontario Summer Company",
    metric: "$3,000",
    blurb: "Small-business operating grant, summer 2023.",
  },
  {
    category: "Scholarship",
    title: "Western Scholarship of Distinction",
    metric: "$3,500",
  },
  {
    category: "Scholarship",
    title: "National Merit Scholarship",
    metric: "$2,000",
  },
  {
    category: "Scholarship",
    title: "Chris Binns-Smith Memorial",
    metric: "$5,000",
  },
  {
    category: "Leadership",
    title: "Director of Flagship",
    blurb: "Western AI Club.",
  },
  {
    category: "Leadership",
    title: "VP of Design",
    // Not featured: a leadership role has no honest pulled-out metric (the
    // résumé lists only the title + org), and inventing one ("Co-Founder"
    // etc.) would be worse than none — so it stays a regular card rather than
    // padding the hero row with an empty metric. Copy unchanged.
    blurb: "Western Founders Network.",
  },
  {
    category: "Leadership",
    title: "VP of Marketing",
    blurb: "Tethos.",
  },
];

// $3000 (Ontario Summer Company grant) + $500 (WFN Odyssey) + $2500 (TRREB)
// + $3500 (Western Scholarship of Distinction) + $2000 (National Merit)
// + $5000 (Chris Binns-Smith Memorial) = $16,500 total. Scholarships were
// previously labelled "Awarded" with no dollar figure and excluded from the
// stat: they had real amounts on the resume, so they're now itemised on
// each card AND rolled into the headline number.
const TOTAL_GRANTS_USD = 16500;
const TOTAL_WINS = ENTRIES.filter(
  (e) => e.category === "Hackathon" || e.category === "Competition",
).length;
const TOTAL_LEADERSHIP = ENTRIES.filter((e) => e.category === "Leadership").length;

function formatMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${n}`;
}

interface CountUpProps {
  to: number;
  active: boolean;
  format?: (n: number) => string;
}

/**
 * Per-card reveal tile. Reveal state is driven by the PARENT's shared
 * IntersectionObserver (passed in as `revealed` prop) rather than each
 * tile creating its own observer. This eliminates 12 separate IO instances.
 * OLD: O(n) observers (one per tile). NEW: O(1) — single shared observer.
 */
function BpTile({
  entry,
  direction,
  delaySteps,
  revealed,
  tileRef,
}: {
  entry: Entry;
  direction: "left" | "right";
  /** Per-card reveal-stagger step count (visual reading order, 0-based).
      Delay resolves to calc(var(--stagger) * delaySteps) so it rides the
      shared motion-spine token instead of a hardcoded ms value. */
  delaySteps: number;
  revealed: boolean;
  tileRef: (el: HTMLLIElement | null) => void;
}) {

  // Single accessible label per card so a screen reader announces the
  // whole accomplishment as one unit ("Hackathon. Hack The 6ix.
  // Finalist, Top finalist · 400+.") rather than four disconnected
  // fragments. Visual sub-elements are aria-hidden below.
  const label = [
    entry.category,
    entry.title,
    entry.metric,
    entry.context,
    entry.blurb,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <li
      ref={tileRef}
      className={[
        "bp-tile",
        `bp-tile--${entry.category.toLowerCase()}`,
        entry.featured ? "bp-tile--featured" : "",
        `bp-tile--from-${direction}`,
        revealed ? "is-revealed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        // Stagger rides the --stagger spine token. delaySteps is the card's
        // VISUAL reading-order position (row-then-column), recomputed from the
        // resolved grid in the parent — so the reveal sweeps in screen order
        // even though grid-auto-flow:dense + span-3 featured cards make the
        // visual order diverge from DOM order.
        transitionDelay: `calc(var(--stagger) * ${delaySteps})`,
      }}
    >
      <article className="bp-tile-inner" aria-label={label}>
        <span className="bp-tile-cat" aria-hidden>
          {entry.category}
        </span>
        <h3 className="bp-tile-title" aria-hidden>
          {entry.title}
        </h3>
        {entry.metric && (
          <span className="bp-tile-metric" aria-hidden>
            {entry.metric}
          </span>
        )}
        {entry.context && (
          <span className="bp-tile-context" aria-hidden>
            {entry.context}
          </span>
        )}
        {entry.blurb && (
          <p className="bp-tile-blurb" aria-hidden>
            {entry.blurb}
          </p>
        )}
      </article>
    </li>
  );
}

function CountUp({ to, active, format = (n) => `${n}` }: CountUpProps) {
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // Reduced motion: skip the tween, render the final value immediately.
  const [n, setN] = useState(reduceMotion ? to : 0);
  useEffect(() => {
    if (!active) return;
    if (reduceMotion) {
      setN(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const dur = 1100;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setN(Math.round(to * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, active, reduceMotion]);
  // The animating digits are aria-hidden: a live count-up would spam
  // the SR with intermediate numbers. The static final value is exposed
  // via aria-label on the stat (see markup below).
  return (
    <span aria-hidden>{format(n)}</span>
  );
}

/** Per-card reveal choreography derived from the RESOLVED grid layout
    (not DOM index). `direction` is the edge the card sweeps in from;
    `delaySteps` is its visual reading-order position (× --stagger). */
interface TileChoreo {
  direction: "left" | "right";
  delaySteps: number;
}

export function BitsAndPieces() {
  const sectionRef = useRef<HTMLElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const [statsActive, setStatsActive] = useState(false);

  // ONE shared IntersectionObserver for all tile reveal latches.
  // OLD: 12 observers (one per BpTile), each created + torn down independently.
  // NEW: O(1) observers total; per-tile cost is one observe() call, one unobserve().
  const [revealedSet, setRevealedSet] = useState<ReadonlySet<number>>(new Set());
  const tileEls = useRef<(HTMLLIElement | null)[]>([]);
  const sharedIoRef = useRef<IntersectionObserver | null>(null);

  // Reveal choreography per tile, keyed by DOM index. Defaults to a sane
  // DOM-order sweep (alternating edges, sequential stagger) so the first
  // paint is never un-choreographed; the layout effect below replaces it
  // with grid-position-aware values once the resolved layout is readable.
  const [choreo, setChoreo] = useState<readonly TileChoreo[]>(() =>
    ENTRIES.map((_, i) => ({
      direction: i % 2 === 0 ? "left" : "right",
      delaySteps: i % 6,
    })),
  );

  // Stable ref-callback factory so tile elements register into tileEls by index.
  // useCallback with a stable closure prevents React from recreating the
  // callback identity on each parent render (which would unmount/remount
  // the ref every cycle and re-observe already-revealed tiles).
  const makeTileRef = useCallback(
    (i: number) => (el: HTMLLIElement | null) => {
      tileEls.current[i] = el;
      if (el && sharedIoRef.current) sharedIoRef.current.observe(el);
    },
    [],
  );

  useEffect(() => {
    // Mobile (<=768px): the tile entrance is gated OFF in CSS (tiles render in
    // place), so the reveal observer would do nothing visible. Skip attaching
    // it entirely — calmer + cheaper on a phone. makeTileRef no-ops its
    // observe() while sharedIoRef stays null; the CSS override keeps every tile
    // visible. Desktop keeps the shared reveal observer.
    if (
      typeof window !== "undefined" &&
      window.matchMedia?.("(max-width: 768px)").matches
    ) {
      return;
    }
    // Same rootMargin as the old per-tile observer.
    const io = new IntersectionObserver(
      (entries) => {
        let changed = false;
        const next = new Set(revealedSet);
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = tileEls.current.indexOf(entry.target as HTMLLIElement);
            if (idx !== -1 && !next.has(idx)) {
              next.add(idx);
              changed = true;
              io.unobserve(entry.target);
            }
          }
        }
        if (changed) setRevealedSet(next);
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    sharedIoRef.current = io;
    // Observe any tile elements already mounted (handles StrictMode double-mount).
    for (const el of tileEls.current) {
      if (el) io.observe(el);
    }
    return () => {
      io.disconnect();
      sharedIoRef.current = null;
    };
    // revealedSet intentionally excluded: we mutate via the closure copy `next`
    // and only call setRevealedSet when something genuinely changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recompute reveal direction + stagger from the RESOLVED layout GEOMETRY,
  // so the sweep follows on-screen position rather than DOM order. With
  // grid-auto-flow:dense and span-3 featured cards the two diverge: a card
  // late in the DOM can pack into an early visual slot.
  //
  // NB: we measure with getBoundingClientRect(), NOT getComputedStyle()'s
  // gridColumnStart/gridRowStart — for AUTO-PLACED grid items the latter
  // returns the specified track string ("span 2"/"span 3"/"auto"), never the
  // browser-resolved line, so it can't tell us where a card actually landed.
  // The rect gives us real pixel x/y. We bucket cards into visual rows by
  // rounded top (subpixel jitter would otherwise split one row in two),
  // order by row-then-x for the stagger, and pick the sweep edge from which
  // half of the grid's width the card's center sits in. Re-runs on resize
  // (breakpoints change the column count, hence the packing).
  useEffect(() => {
    const computeChoreo = () => {
      const placements = tileEls.current
        .map((el, i) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return { i, centerX: r.left + r.width / 2, rowKey: Math.round(r.top) };
        })
        .filter((p): p is { i: number; centerX: number; rowKey: number } => p !== null);
      if (placements.length === 0) return;
      // Grid horizontal center from the spread of tile centers (no extra ref
      // needed): cards left of it sweep in from the left, the rest from right.
      const minX = placements.reduce((m, p) => Math.min(m, p.centerX), Infinity);
      const maxX = placements.reduce((m, p) => Math.max(m, p.centerX), -Infinity);
      const centerX = (minX + maxX) / 2;
      // Visual reading order → stagger step: sort a copy by row then x.
      const ordered = [...placements].sort((a, b) =>
        a.rowKey !== b.rowKey ? a.rowKey - b.rowKey : a.centerX - b.centerX,
      );
      const stepByIndex = new Map<number, number>();
      ordered.forEach((p, order) => stepByIndex.set(p.i, order % 6));
      const next: TileChoreo[] = ENTRIES.map((_, i) => ({
        // Single-column breakpoints collapse minX===maxX===centerX; "<" is
        // false for all, so every card sweeps from the right — fine for a
        // 1-col stack where there is no left/right axis to honour.
        direction: (placements.find((p) => p.i === i)?.centerX ?? centerX) < centerX
          ? "left"
          : "right",
        delaySteps: stepByIndex.get(i) ?? i % 6,
      }));
      setChoreo(next);
    };

    // Defer one frame so the grid has resolved before we read it.
    let raf = requestAnimationFrame(computeChoreo);
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(computeChoreo);
    };
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setStatsActive(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "-20% 0px" },
    );
    io.observe(el);

    // Marquee slides horizontally driven by the section's vertical
    // scroll progress against the viewport. rAF-paced, direct
    // transform write: no React reconcile per scroll tick.
    // Honour prefers-reduced-motion: skip the scroll listener entirely
    // so the decorative strip stays static.
    // #23 PERF: also skip on COARSE pointers (touch). The marquee is a
    // barely-perceptible ghost strip; on phones it's trimmed/hidden via CSS,
    // and the scroll-coupled getBoundingClientRect + transform write per
    // frame isn't worth the battery for an effect the user can't see. Leave
    // the strip at its resting transform.
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const coarsePointer =
      window.matchMedia?.("(hover: none), (pointer: coarse)").matches ?? false;
    // <=768px: the marquee is trimmed/hidden in CSS, so don't pay the
    // per-frame getBoundingClientRect + transform write to slide a strip the
    // phone barely shows. Leave it at its resting transform. (Covers the rare
    // narrow-but-fine-pointer case the coarsePointer guard misses.)
    const narrow =
      window.matchMedia?.("(max-width: 768px)").matches ?? false;
    if (reduceMotion || coarsePointer || narrow) {
      return () => io.disconnect();
    }

    let raf = 0;
    // Only do the per-scroll-frame rect read + transform write while the
    // section is near the viewport. The marquee sits near the bottom of the
    // page, so for most of the scroll it was reading getBoundingClientRect
    // every frame for nothing. A persistent observer gates it; entering the
    // viewport schedules one refresh so the transform is never stale.
    let marqueeVisible = false;
    // PIXEL-STEPPED slide (sitewide pixel-motion language): the strip's
    // scroll-coupled travel is snapped to a 12px grid before it touches
    // the DOM, so the giant ghost categories TICK across the section in
    // discrete jumps instead of gliding sub-pixel. Strip width is cached
    // (scrollWidth forces layout; once + on resize is free), and the
    // transform is only written when the snapped value changes.
    const MARQUEE_GRID = 12;
    let stripW = 0;
    let lastQ = NaN;
    const measureStrip = () => {
      stripW = marqueeRef.current?.scrollWidth ?? 0;
    };
    const update = () => {
      if (!marqueeVisible) return;
      if (stripW === 0) measureStrip();
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = (vh - r.top) / (vh + r.height);
      const clamped = Math.max(0, Math.min(1, p));
      const q =
        Math.round((clamped * 0.36 * stripW) / MARQUEE_GRID) * MARQUEE_GRID;
      if (q !== lastQ && marqueeRef.current) {
        lastQ = q;
        marqueeRef.current.style.transform = `translate3d(${-q}px, 0, 0)`;
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    const onResize = () => {
      measureStrip();
      onScroll();
    };
    const visIo = new IntersectionObserver(
      (entries) => {
        const wasVisible = marqueeVisible;
        for (const entry of entries) marqueeVisible = entry.isIntersecting;
        if (marqueeVisible && !wasVisible) onScroll();
      },
      { rootMargin: "25% 0px 25% 0px" },
    );
    visIo.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      io.disconnect();
      visIo.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-bp">
      <div className="bp-marquee" aria-hidden>
        <div ref={marqueeRef} className="bp-marquee-strip">
          {Array.from({ length: 3 }).map((_, k) => (
            <span key={k}>
              HACKATHON / COMPETITION / GRANT / LEADERSHIP /
              SCHOLARSHIP /{" "}
            </span>
          ))}
        </div>
      </div>

      <div className="bp-layout">
        <header className="bp-head">
          <span className="section-marker bp-marker">05</span>
          <span className="section-index bp-index">
            05 / 06 &middot; Honours
          </span>
          <h2 className="bp-title">
            <ScrambleText text="The trophy wall" />
          </h2>
          <p className="bp-blurb">
            Awards, grants, leadership, scholarships, whatever the timeline doesn&rsquo;t have room for.
          </p>
        </header>

        {/* Summary metrics as a definition list: the animated digits
            are aria-hidden (see CountUp), so each stat carries a static
            aria-label with the final value for assistive tech. */}
        <dl className="bp-stats">
          <div
            className="bp-stat"
            aria-label={`${formatMoney(TOTAL_GRANTS_USD)} in awards and funding`}
          >
            <dd className="bp-stat-num">
              <CountUp
                to={TOTAL_GRANTS_USD}
                active={statsActive}
                format={formatMoney}
              />
            </dd>
            <dt className="bp-stat-label">in awards &amp; funding</dt>
          </div>
          <div className="bp-stat-rule" aria-hidden />
          <div
            className="bp-stat"
            aria-label={`${TOTAL_WINS} competition placements`}
          >
            <dd className="bp-stat-num">
              <CountUp to={TOTAL_WINS} active={statsActive} />
            </dd>
            <dt className="bp-stat-label">competition placements</dt>
          </div>
          <div className="bp-stat-rule" aria-hidden />
          <div
            className="bp-stat"
            aria-label={`${TOTAL_LEADERSHIP} leadership roles`}
          >
            <dd className="bp-stat-num">
              <CountUp to={TOTAL_LEADERSHIP} active={statsActive} />
            </dd>
            <dt className="bp-stat-label">leadership roles</dt>
          </div>
        </dl>

        <ul className="bp-grid" aria-label="Awards, grants, scholarships and leadership roles">
          {ENTRIES.map((e, i) => {
            const c = choreo[i] ?? { direction: "left" as const, delaySteps: 0 };
            return (
              <BpTile
                key={i}
                entry={e}
                direction={c.direction}
                delaySteps={c.delaySteps}
                revealed={revealedSet.has(i)}
                tileRef={makeTileRef(i)}
              />
            );
          })}
        </ul>
      </div>
    </section>
  );
}
