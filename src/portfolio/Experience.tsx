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
        <span className="section-marker">03</span>
        <span className="eyebrow">Experience</span>
        <h2>Timeline</h2>
        <div className="section-card">
          {STINTS.map((s, i) => (
            <div key={i} className="exp-item">
              <div className="exp-item-when">{s.when}</div>
              <div className="exp-item-where">{s.where}</div>
              <div className="exp-item-what">{s.what}</div>
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
