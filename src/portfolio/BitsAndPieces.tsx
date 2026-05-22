import { useEffect, useRef, useState } from "react";
import "./sections.css";
import "./bits-and-pieces.css";

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
 * Per-card reveal — each card watches itself via IntersectionObserver
 * and adds `is-revealed` when it enters viewport. Latched (one-shot)
 * so scrolling back up doesn't replay the reveal.
 */
function BpTile({
  entry,
  index,
  direction,
}: {
  entry: Entry;
  index: number;
  direction: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (revealed) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setRevealed(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [revealed]);
  return (
    <article
      ref={ref as unknown as React.RefObject<HTMLDivElement>}
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
      <div className="bp-tile-cat">{entry.category}</div>
      <h3 className="bp-tile-title">{entry.title}</h3>
      {entry.metric && <div className="bp-tile-metric">{entry.metric}</div>}
      {entry.context && <div className="bp-tile-context">{entry.context}</div>}
      {entry.blurb && <p className="bp-tile-blurb">{entry.blurb}</p>}
    </article>
  );
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

  // Section is NO LONGER pinned — previously a GSAP pin tried to fit
  // 12 cards into a single 100vh viewport, which cut off the bottom
  // half. Now it's a regular tall section: cards reveal as they
  // enter viewport (IntersectionObserver per card, no global pin),
  // and the marquee shifts based on the section's own scroll
  // progress against the viewport.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    // IntersectionObserver to trigger the stats count-up once the
    // section first enters viewport.
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

    // Marquee — track the section's vertical scroll progress with
    // the viewport and slide horizontally. rAF-paced so it doesn't
    // reconcile React; we write transform directly via ref.
    let raf = 0;
    const update = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // section-progress = how far the section has scrolled past
      // viewport bottom toward viewport top. 0 = just entered, 1 =
      // about to leave.
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
          <h2 className="bp-title">The trophy wall.</h2>
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
            const direction = i % 2 === 0 ? "left" : "right";
            return (
              <BpTile
                key={i}
                entry={e}
                index={i}
                direction={direction}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
