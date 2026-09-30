import { useCallback, useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./sections.css";
import "./bits-and-pieces.css";
import { ScrambleText } from "./ScrambleText";
import { useReveal } from "./useReveal";
import { ease, reducedMotion } from "../motion";

gsap.registerPlugin(ScrollTrigger);

/**
 * Bits and Pieces: full-bleed accomplishments spread. Stats band
 * (count-up numbers), a ghosted category marquee that slides with scroll,
 * and a uniform card grid led by a hero row of the three marquee wins
 * (same width as the rest, but taller with a bigger pulled-out metric).
 *
 * Header, stats and every card use the shared `[data-reveal]` primitive
 * (useReveal + sections.css): a batch-staggered rise, latched once. The
 * count-up starts on the stats' reveal and writes textContent directly, so
 * the section never re-renders after mount.
 */

/** Count-up duration (ms): exempt "character" timing (spec §1.3). */
const COUNT_UP_MS = 1100;
/**
 * Ghost marquee travel as a fraction of the strip's width over the section's
 * full pass through the viewport (spec W5.6: 0.10, was 0.36). Tune here.
 */
const GHOST_TRAVEL = 0.1;

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

type CountFormat = "money" | "int";
const FORMATS: Record<CountFormat, (n: number) => string> = {
  money: formatMoney,
  int: (n) => `${n}`,
};

/**
 * Per-card tile. The reveal class is written imperatively by useReveal on the
 * [data-reveal] node, so the className here must stay reveal-free (a re-render
 * would otherwise drop `.is-revealed`).
 */
function BpTile({ entry }: { entry: Entry }) {
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
      data-reveal=""
      className={[
        "bp-tile",
        `bp-tile--${entry.category.toLowerCase()}`,
        entry.featured ? "bp-tile--featured" : "",
      ]
        .filter(Boolean)
        .join(" ")}
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

/**
 * Count-up digits. Rendered once at 0 (final value under reduced motion);
 * runCountUps() animates the text node when the stats reveal. The animating
 * digits are aria-hidden: a live count-up would spam the SR with intermediate
 * numbers. The static final value is exposed via aria-label on the stat.
 */
function CountUp({ to, format = "int" }: { to: number; format?: CountFormat }) {
  const initial = reducedMotion.value ? to : 0;
  return (
    <span aria-hidden data-count-to={to} data-count-format={format}>
      {FORMATS[format](initial)}
    </span>
  );
}

/** Animate every [data-count-to] under `root` from 0 (time-based, ease-out
 *  cubic), writing textContent only when the formatted string changes. */
function runCountUps(root: Element): () => void {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-count-to]")).map(
    (el) => ({
      el,
      to: Number(el.dataset.countTo) || 0,
      fmt: FORMATS[el.dataset.countFormat as CountFormat] ?? FORMATS.int,
      last: el.textContent ?? "",
    }),
  );
  const write = (t: number) => {
    for (const n of nodes) {
      const text = n.fmt(Math.round(n.to * t));
      if (text !== n.last) {
        n.last = text;
        n.el.textContent = text;
      }
    }
  };
  if (reducedMotion.value) {
    write(1);
    return () => {};
  }
  let raf = 0;
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - start) / COUNT_UP_MS));
    write(ease.outCubic(t));
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function BitsAndPieces() {
  const sectionRef = useRef<HTMLElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const stopCountRef = useRef<() => void>(() => {});

  // Shared reveal primitive over the whole section (header, stats, tiles).
  // The count-up starts on the stats' own reveal.
  const onReveal = useCallback((el: Element) => {
    if (el.classList.contains("bp-stats")) {
      stopCountRef.current();
      stopCountRef.current = runCountUps(el);
    }
  }, []);
  useReveal(sectionRef, { onReveal });
  useEffect(() => () => stopCountRef.current(), []);

  // Ghost marquee: slides the giant category strip sideways with the
  // section's pass through the viewport. Driven by ScrollTrigger (the site's
  // single scroll clock, already Lenis-smoothed: no scrub, no second
  // smoother) through a gsap.quickSetter; no window scroll listener, no
  // per-frame layout reads. The strip width is cached on every
  // ScrollTrigger refresh. Rounded to device pixels, not to a coarse grid
  // (the old 12px quantisation juddered in Lenis's deceleration tail).
  // Skipped (strip stays at rest) under reduced motion, on coarse pointers,
  // and <=768px, where the strip is trimmed/hidden in CSS.
  useEffect(() => {
    const el = sectionRef.current;
    const strip = marqueeRef.current;
    if (!el || !strip) return;
    const coarsePointer =
      window.matchMedia?.("(hover: none), (pointer: coarse)").matches ?? false;
    const narrow = window.matchMedia?.("(max-width: 768px)").matches ?? false;
    if (reducedMotion.value || coarsePointer || narrow) return;

    const setX = gsap.quickSetter(strip, "x", "px") as (v: number) => void;
    let stripW = strip.scrollWidth;
    let lastX = NaN;
    const apply = (progress: number) => {
      const dpr = window.devicePixelRatio || 1;
      const x = Math.round(-progress * GHOST_TRAVEL * stripW * dpr) / dpr;
      if (x !== lastX) {
        lastX = x;
        setX(x);
      }
    };
    const st = ScrollTrigger.create({
      trigger: el,
      start: "top bottom",
      end: "bottom top",
      onRefresh: (self) => {
        stripW = strip.scrollWidth;
        apply(self.progress);
      },
      onUpdate: (self) => apply(self.progress),
    });
    apply(st.progress);
    return () => {
      st.kill();
      gsap.set(strip, { clearProps: "transform" });
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
        <header className="bp-head" data-reveal="">
          <span className="section-marker bp-marker">05</span>
          <span className="section-index bp-index">
            05 / 07 &middot; Honours
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
        <dl className="bp-stats" data-reveal="">
          <div
            className="bp-stat"
            aria-label={`${formatMoney(TOTAL_GRANTS_USD)} in awards and funding`}
          >
            <dd className="bp-stat-num">
              <CountUp to={TOTAL_GRANTS_USD} format="money" />
            </dd>
            <dt className="bp-stat-label">in awards &amp; funding</dt>
          </div>
          <div className="bp-stat-rule" aria-hidden />
          <div
            className="bp-stat"
            aria-label={`${TOTAL_WINS} competition placements`}
          >
            <dd className="bp-stat-num">
              <CountUp to={TOTAL_WINS} />
            </dd>
            <dt className="bp-stat-label">competition placements</dt>
          </div>
          <div className="bp-stat-rule" aria-hidden />
          <div
            className="bp-stat"
            aria-label={`${TOTAL_LEADERSHIP} leadership roles`}
          >
            <dd className="bp-stat-num">
              <CountUp to={TOTAL_LEADERSHIP} />
            </dd>
            <dt className="bp-stat-label">leadership roles</dt>
          </div>
        </dl>

        <ul className="bp-grid" aria-label="Awards, grants, scholarships and leadership roles">
          {ENTRIES.map((e, i) => (
            <BpTile key={i} entry={e} />
          ))}
        </ul>
      </div>
    </section>
  );
}
