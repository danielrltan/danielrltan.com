import "./sections.css";

interface Stint {
  when: string;
  where: string;
  role?: string;
  location?: string;
  bullets: string[];
}

const STINTS: Stint[] = [
  {
    when: "May 2025 — Nov 2025",
    where: "Windscribe",
    role: "Software Developer Intern",
    location: "Toronto, ON",
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

export function Work() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-col">
        <span className="section-marker">04</span>
        <span className="section-index">04 / 07 &middot; Work</span>
        <h2>Where I&rsquo;ve been.</h2>
        <div className="section-card">
          {STINTS.map((s, i) => (
            <div key={i} className="exp-item">
              <div className="exp-item-when">{s.when}</div>
              <div className="exp-item-where">{s.where}</div>
              {(s.role || s.location) && (
                <div className="exp-item-role">
                  {s.role}
                  {s.role && s.location ? " · " : ""}
                  {s.location}
                </div>
              )}
              <ul className="exp-item-bullets">
                {s.bullets.map((b, j) => (
                  <li key={j}>{b}</li>
                ))}
              </ul>
            </div>
          ))}
          <div className="section-rule" />
          <a
            href="/resume/Daniel_Tan_Resume.pdf"
            target="_blank"
            rel="noreferrer"
            className="btn-pill"
          >
            Download Resume &darr;
          </a>
        </div>
      </div>
    </section>
  );
}
