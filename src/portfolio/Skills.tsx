import "./sections.css";

interface SkillGroup {
  label: string;
  items: string[];
}

const GROUPS: SkillGroup[] = [
  {
    label: "Frontend",
    items: ["React", "TypeScript", "Vite", "Tailwind", "Framer Motion", "GSAP"],
  },
  {
    label: "3D / Graphics",
    items: ["three.js", "React Three Fiber", "Rapier", "GLSL", "Blender"],
  },
  {
    label: "Backend",
    items: ["Node", "Express", "FastAPI", "Postgres", "Redis", "Prisma"],
  },
  {
    label: "Tooling",
    items: ["Git", "Vitest", "Playwright", "Docker", "GitHub Actions"],
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
            Comfortable picking up whatever a project needs. Recently:
            shader-heavy 3D, scroll-driven UX, real-time physics.
          </p>
        </div>
      </div>
    </section>
  );
}
