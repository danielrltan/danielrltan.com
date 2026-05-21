import { useEffect, useRef, useState } from "react";
import "./sections.css";
import "./work-timeline.css";

interface Stint {
  when: string;
  where: string;
  role?: string;
  location?: string;
  bullets: string[];
  /** When true, marked as the current/active role with accent styling. */
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

/**
 * Lightweight hook: returns true once the ref'd element has entered
 * the viewport (with a margin) for the first time. We latch the
 * "seen" state so scrolling back up doesn't re-animate cards (the
 * animation should be a one-shot reveal, not a flicker every time
 * the user scrolls past).
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
      { rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

interface TimelineCardProps {
  stint: Stint;
  index: number;
}

function TimelineCard({ stint, index }: TimelineCardProps) {
  const [ref, inView] = useInViewOnce<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`tl-card${stint.current ? " tl-card--current" : ""}${
        inView ? " is-in-view" : ""
      }`}
      style={{
        // Staggered delay so the cards animate in one after the other
        // when the section enters viewport instead of all at once.
        transitionDelay: `${index * 90}ms`,
      }}
    >
      <div className="tl-card-dot" aria-hidden />
      <div className="tl-card-meta">
        <span className="tl-card-when">{stint.when}</span>
        {stint.current && <span className="tl-card-tag">CURRENT</span>}
      </div>
      <h3 className="tl-card-where">{stint.where}</h3>
      {(stint.role || stint.location) && (
        <div className="tl-card-role">
          {stint.role}
          {stint.role && stint.location ? " · " : ""}
          {stint.location}
        </div>
      )}
      <ul className="tl-card-bullets">
        {stint.bullets.map((b, j) => (
          <li key={j}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

export function Work() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-col">
        <span className="section-marker">04</span>
        <span className="section-index">04 / 07 &middot; Work</span>
        <h2>Where I&rsquo;ve been.</h2>
        <div className="tl-rail">
          {STINTS.map((s, i) => (
            <TimelineCard key={i} stint={s} index={i} />
          ))}
          <a
            href="/resume/Daniel_Tan_Resume.pdf"
            target="_blank"
            rel="noreferrer"
            className="tl-resume-btn"
          >
            Download Résumé &darr;
          </a>
        </div>
      </div>
    </section>
  );
}
