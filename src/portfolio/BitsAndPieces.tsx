import { useEffect, useRef, useState, useCallback } from "react";
import "./sections.css";
import "./bits-and-pieces.css";

/**
 * Bits and Pieces: full-bleed accomplishments spread. Stats band
 * (count-up numbers), a category marquee that ticks with scroll, and
 * an asymmetric masonry of cards (featured items take more space).
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

const ENTRIES: Entry[] = [
  {
    category: "Hackathon",
    title: "Hack The 6ix",
    metric: "Finalist",
    context: "Top finalist · 400+",
    blurb: "Revamp universal BMS for second-life EV modules.",
    featured: true,
  },
  {
    category: "Competition",
    title: "IBM Watsonx Orchestrate",
    metric: "Top 50",
    context: "of 2000+",
    blurb: "Global agentic-AI build challenge.",
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
    title: "TD Innovation Sprint",
    metric: "Finalist",
  },
  {
    category: "Competition",
    title: "TRREB 2024",
    metric: "2nd",
    context: "$2,500",
    blurb: "Toronto Regional Real Estate Board student competition.",
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
    blurb: "Western Founders Network.",
    featured: true,
  },
  {
    category: "Leadership",
    title: "Director of Outreach",
    blurb: "Tech for Social Impact.",
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
  index,
  direction,
  revealed,
  tileRef,
}: {
  entry: Entry;
  index: number;
  direction: "left" | "right";
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
        transitionDelay: `${(index % 6) * 60}ms`,
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
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      return () => io.disconnect();
    }

    let raf = 0;
    const update = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const p = (vh - r.top) / (vh + r.height);
      const clamped = Math.max(0, Math.min(1, p));
      if (marqueeRef.current) {
        marqueeRef.current.style.transform = `translate3d(${-clamped * 36}%, 0, 0)`;
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
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-bp">
      <div className="bp-marquee" aria-hidden>
        <div ref={marqueeRef} className="bp-marquee-strip">
          {Array.from({ length: 3 }).map((_, k) => (
            <span key={k}>
              HACKATHON &middot; COMPETITION &middot; GRANT &middot;
              LEADERSHIP &middot; SCHOLARSHIP &middot;{" "}
            </span>
          ))}
        </div>
      </div>

      <div className="bp-layout">
        <header className="bp-head">
          <span className="section-marker bp-marker">05</span>
          <span className="section-index bp-index">
            05 / 06 &middot; Bits and pieces
          </span>
          <h2 className="bp-title">The trophy wall.</h2>
          <p className="bp-blurb">
            The extras: awards, grants, leadership, scholarships.
            What the timeline above doesn&rsquo;t have room for.
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
            const direction = i % 2 === 0 ? "left" : "right";
            return (
              <BpTile
                key={i}
                entry={e}
                index={i}
                direction={direction}
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
