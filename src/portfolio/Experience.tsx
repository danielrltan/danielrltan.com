import "./sections.css";

interface Stint {
  when: string;
  where: string;
  what: string;
}

const STINTS: Stint[] = [
  {
    when: "2024 — present",
    where: "Independent / freelance",
    what: "Building interactive web experiences and shipping side projects.",
  },
  {
    when: "Education",
    where: "University name placeholder",
    what: "B.Sc. Computer Science · graduation year placeholder.",
  },
];

export function Experience() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-col">
        <span className="eyebrow">Experience</span>
        <h2>Timeline</h2>
        {STINTS.map((s, i) => (
          <div key={i} className="exp-item">
            <div className="exp-item-when">{s.when}</div>
            <div className="exp-item-where">{s.where}</div>
            <div className="exp-item-what">{s.what}</div>
          </div>
        ))}
        <div style={{ marginTop: 40 }}>
          <a
            href="/resume/Daniel_Tan_Resume.pdf"
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-block",
              padding: "12px 24px",
              border: "1px solid rgba(255, 120, 66, 0.5) !important",
              borderRadius: 999,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Download Resume ↓
          </a>
        </div>
      </div>
    </section>
  );
}
