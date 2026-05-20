import "./sections.css";

interface SkillGroup {
  label: string;
  items: string[];
}

const GROUPS: SkillGroup[] = [
  {
    label: "Languages",
    items: ["Python", "C++", "TypeScript", "Bash", "SQL"],
  },
  {
    label: "ML / Data",
    items: [
      "Machine Learning",
      "Semantic Search",
      "Multimodal Models",
      "Representation Learning",
      "Data Annotation",
      "Model Evaluation",
    ],
  },
  {
    label: "Frameworks",
    items: [
      "FastAPI",
      "PyTorch",
      "TensorFlow",
      "NumPy",
      "Pandas",
      "React",
      "Three.js / R3F",
    ],
  },
  {
    label: "Tooling",
    items: ["Git", "Docker", "MongoDB", "Postgres", "Vercel", "Railway"],
  },
];

export function Skills() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-col">
        <span className="section-marker">02</span>
        <span className="section-index">02 / 07 &middot; Skills</span>
        <h2>Stack.</h2>
        <div className="section-card">
          <div className="skill-grid">
            {GROUPS.map((g) => (
              <div key={g.label} className="skill-group">
                <div className="skill-group-label">{g.label}</div>
                <div className="skill-list">
                  {g.items.map((it) => (
                    <span key={it} className="skill-chip">
                      {it}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="section-rule" />
          <p>
            Comfortable picking up whatever a project needs. Recently
            heavy on ML-backed product work, multimodal video models,
            and real-time 3D on the web.
          </p>
        </div>
      </div>
    </section>
  );
}
