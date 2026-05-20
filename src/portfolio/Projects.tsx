import "./sections.css";

interface Project {
  title: string;
  blurb: string;
  tags: string[];
  liveHref?: string;
  repoHref?: string;
  videoSrc?: string;
}

const PROJECTS: Project[] = [
  {
    title: "Interactive 3D Portfolio",
    blurb:
      "This site. Hand-modelled isometric bedroom in Blender, brought to life with React Three Fiber + Rapier physics. Real keyboard typing, mouse cursor following, throwable objects, scroll-driven camera, signature replay.",
    tags: ["React", "TypeScript", "R3F", "Rapier", "GLSL"],
    repoHref: "https://github.com/danielrltan/portfolioweb",
  },
  {
    title: "Project Two",
    blurb:
      "Placeholder for a second showcase project. Replace with whatever you want recruiters to see first.",
    tags: ["TypeScript", "Next.js", "Postgres"],
  },
  {
    title: "Project Three",
    blurb:
      "Placeholder. Tell the story of a problem you solved, the constraints you worked under, and the choice you'd make differently next time.",
    tags: ["Python", "FastAPI", "React"],
  },
];

export function Projects() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-col">
        <span className="section-marker">03</span>
        <span className="section-index">03 / 07 &middot; Projects</span>
        <h2>Selected work.</h2>
        {PROJECTS.map((p, i) => (
          <article key={i} className="project-card">
            <div className="project-card-media">
              {p.videoSrc ? (
                <video
                  src={p.videoSrc}
                  autoPlay
                  muted
                  loop
                  playsInline
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span>{p.title}</span>
              )}
            </div>
            <div className="project-card-body">
              <h3>{p.title}</h3>
              <p>{p.blurb}</p>
              <div className="project-card-tags">
                {p.tags.map((t) => (
                  <span key={t} className="project-tag">
                    {t}
                  </span>
                ))}
              </div>
              <div className="project-card-links">
                {p.liveHref && (
                  <a href={p.liveHref} target="_blank" rel="noreferrer">
                    Live &rarr;
                  </a>
                )}
                {p.repoHref && (
                  <a href={p.repoHref} target="_blank" rel="noreferrer">
                    GitHub &rarr;
                  </a>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
