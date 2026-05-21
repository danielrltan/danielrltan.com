import "./sections.css";

interface Project {
  title: string;
  blurb: string;
  tags: string[];
  liveHref?: string;
  repoHref?: string;
  videoSrc?: string;
  /** Static thumbnail image (ripped from devpost). Falls back to the
   *  centred-title placeholder when neither image nor video is set. */
  image?: string;
  meta?: string;
}

const PROJECTS: Project[] = [
  {
    title: "Cognetech",
    meta: "Jan 2026 · Python, FastAPI, Multimodal Models",
    blurb:
      "AI-powered video indexing + semantic search tool for clinical footage. Auto-generates timestamped behavioural annotations, cutting psychologists' manual review from hours/days to seconds. Production-minded Python/FastAPI backend integrating TwelveLabs video understanding models with NO patient data storage. End-to-end product (React + Three.js frontend, deployed on Vercel/Railway) translating model outputs into clinician-friendly \"behavioural fingerprints.\"",
    tags: ["Python", "FastAPI", "Semantic Search", "Multimodal", "React", "Three.js"],
    image: "/images/projects/cognetech.jpg",
    liveHref: "https://devpost.com/software/cognetech",
  },
  {
    title: "Revamp — Hack The 6ix Finalist",
    meta: "Jul 2025 · C++, Python, React.js, QNX, Raspberry Pi",
    blurb:
      "Plug-and-play universal BMS for second-life EV modules on a QNX (RTOS) Raspberry Pi edge node. Normalised mixed-OEM telemetry and exposed a centralised fleet dashboard for real-time monitoring. Cloud analytics pipeline (FastAPI + MongoDB Atlas) with Gemini-powered SoH estimation and anomaly explanation. Physics-based battery simulator with PyBaMM streaming packed binary over TCP for 3 EV packs (≈20,736 cells).",
    tags: ["C++", "Python", "React", "QNX", "Raspberry Pi", "MongoDB", "Gemini"],
    image: "/images/projects/reamp.png",
    liveHref: "https://devpost.com/software/reamp",
  },
  {
    title: "Interactive 3D Portfolio",
    meta: "2026 · React, R3F, Rapier",
    blurb:
      "This site. Hand-modelled isometric bedroom in Blender, brought to life with React Three Fiber + Rapier physics. Real keyboard typing, mouse cursor following, throwable objects, scroll-driven camera, signature replay.",
    tags: ["React", "TypeScript", "R3F", "Rapier", "GLSL"],
    repoHref: "https://github.com/danielrltan/danielrltan.com",
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
              ) : p.image ? (
                <img
                  src={p.image}
                  alt={p.title}
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span>{p.title}</span>
              )}
            </div>
            <div className="project-card-body">
              <h3>{p.title}</h3>
              {p.meta && <div className="project-card-meta">{p.meta}</div>}
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
