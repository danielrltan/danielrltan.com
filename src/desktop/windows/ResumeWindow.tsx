import { Download, ExternalLink } from "lucide-react";

const RESUME_PDF = "/resume/Daniel_Tan_Resume.pdf";

interface Role {
  org: string;
  url?: string;
  title: string;
  range: string;
  location: string;
  bullets: string[];
}

const EXPERIENCE: Role[] = [
  {
    org: "Windscribe",
    url: "https://windscribe.com",
    title: "Software Developer Intern",
    range: "May 2025 — Nov 2025",
    location: "Toronto, ON",
    bullets: [
      "Engineered a ticket automation extension that resolved 30% of support load autonomously, cutting response times by 50% and improving SLA compliance at scale for 89 million users.",
      "Developed and deployed an internal Slackbot \"Demerzel\" with thread-based context management using TOML-configured endpoints, Prometheus metrics, and Notion-integrated memory prompts — building from 650+ articles of Windscribe documentation.",
      "Integrated the OpenAI API for ticket automation answering, generating tailored responses and summaries that reduced manual triage time from 90 to 20 seconds per average ticket.",
    ],
  },
  {
    org: "Nodes",
    url: "https://thenodes.ca",
    title: "Software Developer Intern",
    range: "Jan 2025 — May 2025",
    location: "London, ON",
    bullets: [
      "Implemented Gmail OAuth for streamlined user authentication, replacing MFA entry with a secure OAuth flow — contributed to a launch that drove 600+ users in the first week.",
      "Automated hiring email verification with a Firebase script cross-referencing 250+ applicant emails against the user database, reducing processing time from ~33 minutes to 5 seconds.",
    ],
  },
];

interface Project {
  name: string;
  url: string;
  award?: string;
  range: string;
  stack: string[];
  bullets: string[];
}

const PROJECTS: Project[] = [
  {
    name: "Cognetech",
    url: "https://devpost.com/software/cognetech",
    range: "Jan 2026",
    stack: [
      "Python",
      "FastAPI",
      "Semantic Search",
      "Multimodal Models",
      "Model Inference APIs",
    ],
    bullets: [
      "Built an AI-powered video indexing + semantic search tool that auto-generates timestamped behavioural annotations from clinical footage, cutting psychologists' manual review from hours/days to seconds.",
      "Implemented a production-minded Python/FastAPI backend integrating TwelveLabs video understanding models to serve real-time analysis without storing sensitive patient data.",
      "Shipped an end-to-end product (React + Three.js frontend, deployed on Vercel / Railway), translating model outputs into clinician-friendly \"behavioural fingerprints\" supporting human-in-the-loop workflows.",
    ],
  },
  {
    name: "Revamp",
    award: "Hack The 6ix Finalist",
    url: "https://devpost.com/software/reamp",
    range: "Jul 2025",
    stack: ["C++", "Python", "React", "QNX", "Raspberry Pi"],
    bullets: [
      "Architected a plug-and-play, universal BMS for second-life EV modules on a QNX (RTOS) Raspberry Pi edge node, normalizing mixed-OEM telemetry and exposing a centralized fleet dashboard.",
      "Delivered a cloud analytics pipeline (FastAPI + MongoDB Atlas) with Gemini-powered insights for SoH estimation, anomaly explanation, and predictive dashboards — starting from binary TCP decoding.",
      "Built a physics-based battery simulator with PyBaMM, generating 10 Hz telemetry for 3 EV packs (~20,736 cells) and streamed packed binary over TCP to the QNX edge for hardware-in-the-loop testing without physical packs.",
    ],
  },
];

const SKILL_GROUPS: ReadonlyArray<{ group: string; items: string[] }> = [
  { group: "Languages", items: ["Python", "C++", "Bash", "SQL"] },
  {
    group: "ML / Data",
    items: [
      "Machine Learning",
      "Semantic Search",
      "Multimodal Models (Video/Text)",
      "Representation Learning",
      "Active Learning",
      "Data Annotation Pipelines",
      "Model Evaluation",
    ],
  },
  {
    group: "Frameworks",
    items: ["FastAPI", "PyTorch", "TensorFlow", "NumPy", "Pandas"],
  },
];

const EDUCATION = {
  school: "University of Western Ontario",
  degree: "Bachelor of Science in Computer Science",
  range: "Expected 2027",
  location: "London, ON",
  gpa: "3.9 / 4.0",
  scholarships: [
    "Western Scholarship of Distinction ($3,500)",
    "National Merit Scholarship ($2,000)",
    "Chris Binns-Smith Memorial Scholarship ($5,000)",
  ],
  awards: [
    "IBM watsonx Orchestrate Challenge — Top 50 of 2000+ global participants",
    "Hack The 6ix Finalist — 400+ participants",
    "WFN Odyssey Cup Competition — 1st Place ($500)",
    "TD Innovation Sprint Finalist",
    "Toronto Regional Real Estate Board 2024 Contest — 2nd Place ($2,500)",
    "Ontario 2023 Summer Company Grant ($3,000)",
  ],
  leadership: [
    "Director of Flagship — Western Artificial Intelligence Club",
    "Vice President of Design — Western Founders Network",
    "Director of Outreach — Tech for Social Impact",
    "Developer — Western Developer's Society",
  ],
};

// ---------- presentational primitives ----------

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: "24px 0 12px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: "var(--muted)",
      }}
    >
      {children}
    </h2>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        padding: "3px 8px",
        borderRadius: 999,
        border: "1px solid var(--surface-alt)",
        color: "var(--text-lt)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul
      style={{
        margin: "8px 0 0",
        paddingLeft: 18,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      {items.map((b, i) => (
        <li
          key={i}
          style={{
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "var(--text-lt)",
            opacity: 0.88,
          }}
        >
          {b}
        </li>
      ))}
    </ul>
  );
}

function RoleBlock({ r }: { r: Role }) {
  return (
    <div style={{ position: "relative", paddingLeft: 18 }}>
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 6,
          width: 9,
          height: 9,
          borderRadius: "50%",
          background: "var(--accent)",
          boxShadow: "0 0 0 3px var(--surface)",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 14.5,
            color: "var(--text-lt)",
          }}
        >
          {r.title} ·{" "}
          {r.url ? (
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              style={{
                color: "var(--accent)",
                textDecoration: "none",
                fontWeight: 700,
              }}
            >
              {r.org}
            </a>
          ) : (
            <span style={{ color: "var(--accent)" }}>{r.org}</span>
          )}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--muted)",
            whiteSpace: "nowrap",
          }}
        >
          {r.range}
        </div>
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted)",
          marginTop: 2,
        }}
      >
        {r.location}
      </div>
      <BulletList items={r.bullets} />
    </div>
  );
}

function ProjectBlock({ p }: { p: Project }) {
  return (
    <div style={{ position: "relative", paddingLeft: 18 }}>
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 6,
          width: 9,
          height: 9,
          borderRadius: 2,
          background: "var(--accent2)",
          boxShadow: "0 0 0 3px var(--surface)",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 14.5,
            color: "var(--text-lt)",
            display: "inline-flex",
            alignItems: "baseline",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            style={{
              color: "var(--accent)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {p.name} <ExternalLink size={11} />
          </a>
          {p.award && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                letterSpacing: 1,
                textTransform: "uppercase",
                color: "var(--accent2)",
                padding: "2px 6px",
                border: "1px solid var(--accent2)",
                borderRadius: 999,
              }}
            >
              {p.award}
            </span>
          )}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--muted)",
            whiteSpace: "nowrap",
          }}
        >
          {p.range}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          marginTop: 6,
        }}
      >
        {p.stack.map((t) => (
          <Pill key={t}>{t}</Pill>
        ))}
      </div>
      <BulletList items={p.bullets} />
    </div>
  );
}

// ---------- window ----------

export function ResumeWindow() {
  return (
    <div style={{ padding: 28, maxWidth: 780 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
          marginBottom: 4,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 30,
              letterSpacing: -0.6,
              color: "var(--text-lt)",
              lineHeight: 1,
            }}
          >
            Daniel Tan
          </div>
          <div
            style={{
              marginTop: 6,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--accent)",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            software · ml · creative engineering
          </div>
        </div>
        <a
          href={RESUME_PDF}
          download="Daniel_Tan_Resume.pdf"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "9px 14px",
            borderRadius: 7,
            background: "var(--accent)",
            color: "var(--text-dk)",
            textDecoration: "none",
            fontFamily: "var(--font-display)",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 1.2,
            textTransform: "uppercase",
          }}
        >
          <Download size={14} strokeWidth={2.2} /> PDF
        </a>
      </div>
      <div
        style={{
          marginTop: 10,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted)",
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
        }}
      >
        <span>416-732-5553</span>
        <a
          href="mailto:hello@danielrltan"
          style={{ color: "var(--muted)", textDecoration: "none" }}
        >
          danielrltan@gmail.com
        </a>
        <a
          href="https://linkedin.com/in/danielrltan"
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--muted)", textDecoration: "none" }}
        >
          linkedin.com/in/danielrltan
        </a>
        <a
          href="https://github.com/danielrltan"
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--muted)", textDecoration: "none" }}
        >
          github.com/danielrltan
        </a>
      </div>

      <H2>Experience</H2>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {EXPERIENCE.map((r) => (
          <RoleBlock key={r.org + r.range} r={r} />
        ))}
      </div>

      <H2>Projects</H2>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {PROJECTS.map((p) => (
          <ProjectBlock key={p.name} p={p} />
        ))}
      </div>

      <H2>Technical Skills</H2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {SKILL_GROUPS.map((g) => (
          <div key={g.group}>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--muted)",
                marginBottom: 6,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              {g.group}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {g.items.map((t) => (
                <Pill key={t}>{t}</Pill>
              ))}
            </div>
          </div>
        ))}
      </div>

      <H2>Education</H2>
      <div style={{ position: "relative", paddingLeft: 18 }}>
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 6,
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: "var(--accent)",
            boxShadow: "0 0 0 3px var(--surface)",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 12,
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 14.5,
              color: "var(--text-lt)",
            }}
          >
            {EDUCATION.school}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--muted)",
              whiteSpace: "nowrap",
            }}
          >
            {EDUCATION.range}
          </div>
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--accent2)",
            marginTop: 2,
          }}
        >
          {EDUCATION.degree} · {EDUCATION.location} · GPA {EDUCATION.gpa}
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={subTitle}>Scholarships</div>
          <BulletList items={EDUCATION.scholarships} />
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={subTitle}>Awards</div>
          <BulletList items={EDUCATION.awards} />
        </div>
        <div style={{ marginTop: 10 }}>
          <div style={subTitle}>Leadership</div>
          <BulletList items={EDUCATION.leadership} />
        </div>
      </div>
    </div>
  );
}

const subTitle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: "var(--muted)",
  letterSpacing: 1,
  textTransform: "uppercase",
};
