import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./sections.css";
import "./work-timeline.css";

gsap.registerPlugin(ScrollTrigger);

interface Stint {
  when: string;
  where: string;
  role?: string;
  location?: string;
  bullets: string[];
  current?: boolean;
}

const STINTS: Stint[] = [
  {
    when: "May 2025 — Nov 2025",
    where: "Windscribe",
    role: "Software Developer Intern",
    location: "Toronto, ON",
    current: true,
    bullets: [
      "Engineered a ticket automation extension that resolved 30% of support load autonomously, cutting response times by 50% and improving SLA compliance at scale for 89M users.",
      "Built and deployed an internal Slackbot \"Demerzel\" with thread-based context management, TOML-configured endpoints, Prometheus metrics, and Notion-integrated memory prompts — built from 650+ articles of internal docs.",
      "Integrated OpenAI API for ticket automation, reducing manual triage time from 90 to 20 seconds per average ticket.",
    ],
  },
  {
    when: "Jan 2025 — May 2025",
    where: "Nodes",
    role: "Software Developer Intern",
    location: "London, ON",
    bullets: [
      "Implemented Gmail OAuth for user authentication, replacing MFA entry with a secure flow that contributed to a launch driving 600+ users in the first week.",
      "Automated hiring email verification with a Firebase script cross-referencing 250+ applicant emails against the user DB — 33 minutes of manual work down to 5 seconds.",
    ],
  },
  {
    when: "Expected 2027",
    where: "University of Western Ontario",
    role: "B.Sc. Computer Science",
    location: "London, ON",
    bullets: [
      "GPA 3.9/4.0. Western Scholarship of Distinction, National Merit Scholarship, Chris Binns-Smith Memorial Scholarship.",
      "Director of Flagship — Western AI Club. VP of Design — Western Founders Network. Director of Outreach — Tech for Social Impact. Developer — Western Developer's Society.",
    ],
  },
];

const PIN_DURATION_PX = 1800;

/**
 * Work section — dramatic pinned timeline with a wide two-column
 * layout. The section breaks OUT of the standard `.portfolio-col`
 * pattern (which constrains content to ~40% of viewport, leaving
 * cards crushed to ~200px wide) and uses a custom grid:
 *   [aside ~32%] [rail 32px] [cards ~remaining]
 *
 * Pin progress drives:
 *   - Vertical "rail" line draws downward from 0 to 100% height
 *   - Scrubber dot rides the rail's leading edge
 *   - Cards reveal in sequence as the rail passes each one
 *   - Current/most-recent card stays accent-orange highlighted
 */
export function Work() {
  const sectionRef = useRef<HTMLElement>(null);
  const railFillRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState<boolean[]>(() =>
    STINTS.map(() => false),
  );

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    // Each card's pin-progress threshold for reveal. Slightly later
    // than the rail's reveal of that vertical slice, so the card
    // unfurls just after the rail has drawn past its dot.
    const cardThresholds = STINTS.map(
      (_, i) => 0.18 + (i / Math.max(1, STINTS.length - 1)) * 0.62,
    );

    const st = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: `+=${PIN_DURATION_PX}`,
      pin: true,
      pinSpacing: true,
      scrub: true,
      anticipatePin: 1,
      onUpdate: (self) => {
        const p = self.progress;
        const railProgress = Math.max(0, Math.min(1, (p - 0.05) / 0.85));
        const railEl = railFillRef.current;
        if (railEl) {
          railEl.style.transform = `scaleY(${railProgress})`;
        }
        const sc = scrubberRef.current;
        if (sc) {
          sc.style.transform = `translate(-50%, calc(${railProgress * 100}% - 6px))`;
          sc.style.opacity = railProgress > 0 && railProgress < 1 ? "1" : "0";
        }
        setRevealed((prev) => {
          let changed = false;
          const next = prev.map((wasRevealed, i) => {
            const should = p >= cardThresholds[i]!;
            if (should !== wasRevealed) changed = true;
            return should;
          });
          return changed ? next : prev;
        });
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

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-work">
      <div className="work-layout">
        <aside className="work-aside">
          <span className="section-marker">03</span>
          <span className="section-index">03 / 06 &middot; Work</span>
          <h2>Where I&rsquo;ve been.</h2>
          <p className="work-blurb">
            Scroll — the timeline draws itself.
          </p>
          <a
            href="/resume/Daniel_Tan_Resume.pdf"
            target="_blank"
            rel="noreferrer"
            className={`work-resume-btn${
              revealed[revealed.length - 1] ? " is-revealed" : ""
            }`}
          >
            Download Résumé &darr;
          </a>
        </aside>
        <div className="work-timeline-stage">
          <div className="work-rail-wrap" aria-hidden>
            <div className="work-rail" />
            <div ref={railFillRef} className="work-rail-fill" />
            <div ref={scrubberRef} className="work-scrubber" />
          </div>
          <div className="work-cards">
            {STINTS.map((s, i) => (
              <article
                key={i}
                className={`work-card${s.current ? " work-card--current" : ""}${
                  revealed[i] ? " is-revealed" : ""
                }`}
              >
                <div className="work-card-dot" aria-hidden />
                <div className="work-card-meta">
                  <span className="work-card-when">{s.when}</span>
                  {s.current && <span className="work-card-tag">CURRENT</span>}
                </div>
                <h3 className="work-card-where">{s.where}</h3>
                {(s.role || s.location) && (
                  <div className="work-card-role">
                    {s.role}
                    {s.role && s.location ? " · " : ""}
                    {s.location}
                  </div>
                )}
                <ul className="work-card-bullets">
                  {s.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
