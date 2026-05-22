import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./sections.css";
import "./bits-and-pieces.css";

gsap.registerPlugin(ScrollTrigger);

/**
 * Bits and Pieces — the "extras" / accomplishments section, rebuilt
 * as a full-bleed pinned editorial spread.
 *
 * Layout (full viewport width — breaks out of portfolio-col):
 *   1. A pinned hero band with three giant kinetic numbers
 *      (grants $, wins, leadership roles) that count up as the user
 *      scrolls into the section.
 *   2. A category-word marquee (`HACKATHON · COMPETITION · GRANT
 *      · LEADERSHIP · SCHOLARSHIP`) that ticker-slides as a
 *      scroll-driven background layer.
 *   3. An asymmetric masonry of accomplishment cards. Cards reveal
 *      with directional stagger as the pinned scroll progresses;
 *      featured items (hackathon finalist, 1st-place wins) get
 *      larger cards.
 *
 * Replaces the prior right-column 3-card grid. The previous version
 * was visually cramped and read as generic — this one uses scale,
 * asymmetry, and motion to give the section editorial energy.
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
  /** Pulled-out metric — printed huge in the card's "stat slot". */
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
    featured: true,
  },
  {
    category: "Leadership",
    title: "Director of Outreach",
    blurb: "Tech for Social Impact.",
  },
];

const TOTAL_GRANTS_USD = 6000; // $3000 + $500 + $2500
const TOTAL_WINS = ENTRIES.filter(
  (e) => e.category === "Hackathon" || e.category === "Competition",
).length;
const TOTAL_LEADERSHIP = ENTRIES.filter((e) => e.category === "Leadership").length;

const PIN_DURATION_PX = 1600;

function formatMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${n}`;
}

interface CountUpProps {
  to: number;
  active: boolean;
  format?: (n: number) => string;
}

function CountUp({ to, active, format = (n) => `${n}` }: CountUpProps) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
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
  }, [to, active]);
  return <>{format(n)}</>;
}

export function BitsAndPieces() {
  const sectionRef = useRef<HTMLElement>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const [statsActive, setStatsActive] = useState(false);
  const [pinProgress, setPinProgress] = useState(0);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const st = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: `+=${PIN_DURATION_PX}`,
      pin: true,
      pinSpacing: true,
      scrub: true,
      anticipatePin: 1,
      onEnter: () => setStatsActive(true),
      onUpdate: (self) => {
        // Marquee horizontal shift scales with pin progress for a
        // gentle scroll-driven slide (no auto-marquee — feels more
        // intentional when the user's scroll is what moves it).
        if (marqueeRef.current) {
          marqueeRef.current.style.transform = `translate3d(${-self.progress * 28}%, 0, 0)`;
        }
        setPinProgress(self.progress);
      },
    });

    const html = document.documentElement;
    let lastLoading = html.classList.contains("loading-active");
    const obs = new MutationObserver(() => {
      const now = html.classList.contains("loading-active");
      if (lastLoading && !now) ScrollTrigger.refresh();
      lastLoading = now;
    });
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    if (!lastLoading) {
      requestAnimationFrame(() => ScrollTrigger.refresh());
    }
    return () => {
      obs.disconnect();
      st.kill();
    };
  }, []);

  // Each card reveals at a per-card threshold computed from pin
  // progress. Threshold = 0.20 + (i / N) * 0.55 — final card lands
  // at p≈0.75, leaving the back ~25% as a dwell beat with everything
  // in place.
  const cardThresholds = ENTRIES.map(
    (_, i) => 0.20 + (i / Math.max(1, ENTRIES.length - 1)) * 0.55,
  );

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-bp">
      {/* Faint giant category marquee sliding behind everything else
          as the user scrolls. Adds editorial texture without
          competing for attention. */}
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
          <h2 className="bp-title">
            The <em>trophy</em> wall.
          </h2>
          <p className="bp-blurb">
            The extras — awards, grants, leadership, scholarships.
            What the timeline above doesn&rsquo;t have room for.
          </p>
        </header>

        <div className="bp-stats">
          <div className="bp-stat">
            <span className="bp-stat-num">
              <CountUp
                to={TOTAL_GRANTS_USD}
                active={statsActive}
                format={formatMoney}
              />
            </span>
            <span className="bp-stat-label">in grants & prizes</span>
          </div>
          <div className="bp-stat-rule" aria-hidden />
          <div className="bp-stat">
            <span className="bp-stat-num">
              <CountUp to={TOTAL_WINS} active={statsActive} />
            </span>
            <span className="bp-stat-label">competition placements</span>
          </div>
          <div className="bp-stat-rule" aria-hidden />
          <div className="bp-stat">
            <span className="bp-stat-num">
              <CountUp to={TOTAL_LEADERSHIP} active={statsActive} />
            </span>
            <span className="bp-stat-label">leadership roles</span>
          </div>
        </div>

        <div className="bp-grid">
          {ENTRIES.map((e, i) => {
            const revealed = pinProgress >= cardThresholds[i]!;
            const direction = i % 2 === 0 ? "left" : "right";
            return (
              <article
                key={i}
                className={[
                  "bp-tile",
                  `bp-tile--${e.category.toLowerCase()}`,
                  e.featured ? "bp-tile--featured" : "",
                  `bp-tile--from-${direction}`,
                  revealed ? "is-revealed" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <div className="bp-tile-cat">{e.category}</div>
                <h3 className="bp-tile-title">{e.title}</h3>
                {e.metric && <div className="bp-tile-metric">{e.metric}</div>}
                {e.context && <div className="bp-tile-context">{e.context}</div>}
                {e.blurb && <p className="bp-tile-blurb">{e.blurb}</p>}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
