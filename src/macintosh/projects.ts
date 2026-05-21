/**
 * Shared project / skill data for the Macintosh section. Skill logos
 * orbit, project tiles appear on the CRT screen, click-to-expand
 * cards pull from the project records.
 */

export interface MacProject {
  id: string;
  title: string;
  meta: string;
  blurb: string;
  tags: string[];
  liveHref?: string;
  repoHref?: string;
  /** Hex color for the placeholder tile gradient. */
  color: string;
}

export const MAC_PROJECTS: MacProject[] = [
  {
    id: "cognetech",
    title: "Cognetech",
    meta: "Jan 2026 · Python · FastAPI · Multimodal",
    blurb:
      "AI-powered video indexing + semantic search tool for clinical footage. Auto-generates timestamped behavioural annotations, cutting psychologists' manual review from hours to seconds. Python/FastAPI backend integrating TwelveLabs video models, with NO patient data storage. End-to-end (React + Three.js, deployed on Vercel/Railway).",
    tags: ["Python", "FastAPI", "Semantic Search", "Multimodal", "React"],
    liveHref: "https://devpost.com/software/cognetech",
    color: "#e87040",
  },
  {
    id: "revamp",
    title: "Revamp",
    meta: "Jul 2025 · C++ · Python · QNX",
    blurb:
      "Hack The 6ix Finalist. Plug-and-play universal BMS for second-life EV modules running on a QNX RTOS Raspberry Pi edge node. Normalised mixed-OEM telemetry and exposed a centralised fleet dashboard. Cloud analytics pipeline with FastAPI + MongoDB Atlas, Gemini-powered state-of-health estimation, physics-based PyBaMM simulator streaming packed binary over TCP for ~20K cells.",
    tags: ["C++", "Python", "React", "QNX", "MongoDB", "Gemini"],
    liveHref: "https://devpost.com/software/reamp",
    color: "#5a3a1f",
  },
  {
    id: "portfolio",
    title: "Interactive 3D Portfolio",
    meta: "2026 · React · R3F · Rapier",
    blurb:
      "This site. Hand-modelled isometric bedroom in Blender, brought to life with React Three Fiber + Rapier physics. Real keyboard typing, mouse cursor following, throwable objects, scroll-driven camera, signature replay.",
    tags: ["React", "TypeScript", "R3F", "Rapier", "GLSL"],
    repoHref: "https://github.com/danielrltan/danielrltan.com",
    color: "#3a2418",
  },
  {
    id: "demerzel",
    title: "Demerzel — Internal Slackbot",
    meta: "2025 · Python · OpenAI · Notion",
    blurb:
      "Internal Slackbot at Windscribe with thread-based context management, TOML-configured endpoints, Prometheus metrics, and Notion-integrated memory prompts. Built from 650+ articles of internal docs. Resolved 30% of support load autonomously across 89M users.",
    tags: ["Python", "OpenAI", "Slack", "Notion", "Prometheus"],
    color: "#7a4f30",
  },
];

/**
 * Skill logos shown in the orbit. Each logo is rendered as a small
 * gradient panel with text — same placeholder treatment as the photo
 * carousel until real logo SVGs land in /public/.
 */
export interface SkillLogo {
  label: string;
  color: string;
}

export const SKILL_LOGOS: SkillLogo[] = [
  { label: "React", color: "#61DAFB" },
  { label: "TypeScript", color: "#3178C6" },
  { label: "Three.js", color: "#000000" },
  { label: "Python", color: "#FFD43B" },
  { label: "FastAPI", color: "#009688" },
  { label: "GSAP", color: "#88CE02" },
  { label: "Blender", color: "#F5792A" },
  { label: "Figma", color: "#A259FF" },
  { label: "MongoDB", color: "#47A248" },
  { label: "Docker", color: "#2496ED" },
];
