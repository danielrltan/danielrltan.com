import { useEffect, useRef, useState } from "react";
import "./sections.css";
import "./bits-and-pieces.css";

/**
 * "Bits and pieces" — extras section. Replaces the 3D photo carousel
 * with a pure HTML treatment for accomplishments / awards / leadership
 * roles. Pinned-feel via scroll-driven reveal but no GSAP — each card
 * pops in on IntersectionObserver, slightly staggered.
 *
 * Visual style: arranged as a "trophy case" — a 3-column grid of
 * compact cards, each card pairs a category eyebrow with the
 * accomplishment title and (optionally) a one-line blurb. Each card
 * has a small accent stripe to give the wall texture without going
 * cute or kitsch.
 */

interface Entry {
  category: "Hackathon" | "Competition" | "Grant" | "Leadership" | "Scholarship";
  title: string;
  blurb?: string;
  /** Pulled-out metric line (e.g. "$3,000", "Top 50 / 2000+", "Finalist"). */
  metric?: string;
}

const ENTRIES: Entry[] = [
  {
    category: "Hackathon",
    title: "Hack The 6ix — Finalist",
    metric: "Top finalist / 400+",
    blurb: "Revamp battery-management project — universal BMS for second-life EV modules.",
  },
  {
    category: "Competition",
    title: "IBM watsonx Orchestrate Challenge",
    metric: "Top 50 / 2000+",
    blurb: "Global agentic-AI build challenge.",
  },
  {
    category: "Competition",
    title: "WFN Odyssey Cup",
    metric: "1st Place · $500",
    blurb: "Western Founders Network annual venture competition.",
  },
  {
    category: "Competition",
    title: "TD Innovation Sprint",
    metric: "Finalist",
  },
  {
    category: "Competition",
    title: "2024 TRREB Contest",
    metric: "2nd Place · $2,500",
    blurb: "Toronto Regional Real Estate Board student competition.",
  },
  {
    category: "Grant",
    title: "Ontario Summer Company Grant",
    metric: "$3,000",
    blurb: "Small-business operating grant through Ontario's 2023 summer program.",
  },
  {
    category: "Scholarship",
    title: "Western Scholarship of Distinction",
    metric: "Awarded",
  },
  {
    category: "Scholarship",
    title: "National Merit Scholarship",
    metric: "Awarded",
  },
  {
    category: "Scholarship",
    title: "Chris Binns-Smith Memorial",
    metric: "Awarded",
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
  },
  {
    category: "Leadership",
    title: "Director of Outreach",
    blurb: "Tech for Social Impact.",
  },
];

/**
 * Lightweight latched-in-view hook (same pattern as the original
 * Work timeline). Cards animate once and stay.
 */
function useInViewOnce<T extends HTMLElement>(): [
  React.RefObject<T | null>,
  boolean,
] {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setSeen(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function EntryCard({ entry, index }: { entry: Entry; index: number }) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`bp-card bp-card--${entry.category.toLowerCase()}${
        inView ? " is-in-view" : ""
      }`}
      style={{ transitionDelay: `${(index % 6) * 60}ms` }}
    >
      <div className="bp-card-stripe" />
      <div className="bp-card-eyebrow">{entry.category}</div>
      <h3 className="bp-card-title">{entry.title}</h3>
      {entry.metric && <div className="bp-card-metric">{entry.metric}</div>}
      {entry.blurb && <p className="bp-card-blurb">{entry.blurb}</p>}
    </div>
  );
}

export function BitsAndPieces() {
  return (
    <section className="portfolio-section portfolio-bp">
      <div className="portfolio-col bp-col">
        <span className="section-marker">06</span>
        <span className="section-index">06 / 06 &middot; Bits and pieces</span>
        <h2>The trophy wall.</h2>
        <p className="bp-blurb">
          The extras. Awards, grants, leadership, scholarships.
        </p>
        <div className="bp-grid">
          {ENTRIES.map((e, i) => (
            <EntryCard key={i} entry={e} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}
