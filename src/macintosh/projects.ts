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
  /** Public path to the project thumbnail (Devpost gallery image). */
  image?: string;
  /** Hex color for the tile gradient; fallback before the image loads. */
  color: string;
}

/**
 * Label for a project's live-link button: a Devpost project page reads
 * "View dev post"; any other live URL (a deployed site) reads "View live".
 * Repo-only projects use "Source" (handled at the call site).
 */
export function liveLinkLabel(liveHref: string): string {
  return /devpost\.com/i.test(liveHref) ? "View dev post" : "View live";
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
    image: "/images/projects/cognetech.jpg",
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
    image: "/images/projects/reamp.jpg",
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
    id: "weaver",
    title: "Weaver",
    meta: "Nov 2025 · React · FastAPI · Gemini",
    blurb:
      "Hack Western 12 submission. A collaborative AI ideation canvas that replaces linear chats with visual, branching conversation graphs: every idea is a node, every reply a branch, so context never collapses the way it does in a long thread. React + React Flow front end over a FastAPI + Supabase (Postgres) backend, with WebSocket sync for up to four people drawing on one board in real time. Gemini powers the LLM response at each node.",
    tags: ["React", "React Flow", "FastAPI", "Supabase", "WebSockets", "Gemini"],
    liveHref: "https://devpost.com/software/weaver-r5qpk0",
    image: "/images/projects/weaver.jpg",
    color: "#26282d",
  },
];

/**
 * Skill logos shown in the orbit. Each logo is rendered as a small
 * gradient panel with text, same placeholder treatment as the photo
 * carousel until real logo SVGs land in /public/.
 *
 * Orbit layout fields (radius/yOffset) give the 3D ring volume; cards
 * sit at slightly different radii and heights so they don't read as a
 * flat planar ring. The Macintosh scene reads these when arranging
 * the orbit; the mobile ticker ignores them and shows label+color only.
 */
export interface SkillLogo {
  label: string;
  color: string;
  /**
   * Short, ACCURATE classification code shown on the orbit card's
   * spec-tag header (mono, e.g. "LANG", "3D", "TOOL", "INFRA", "LIB",
   * "API", "DB"). Drives the card's category line, replacing the old
   * meaningless "STK" tag.
   */
  cat: string;
  /** Optional override of the base orbit radius (default ~2.0). */
  radius?: number;
  /** Optional vertical offset from the Mac's center, in scene units. */
  yOffset?: number;
}

// Orbit ring layout. The cards are distributed at EVEN angular steps
// (i/N · 2π, computed in MacintoshScene) so they form a balanced ring,
// never a one-side pile. The radius/yOffset here add gentle volume so
// the ring doesn't read as a flat planar disc.
//
// Anti-overlap strategy: the near arc of the ring (the side toward the
// camera) compresses in screen-space under perspective, so adjacent
// cards there tend to collide. Two levers keep them apart through the
// full 2π rotation:
//   1. LARGE radius (~2.95): wide angular spacing → wide screen spacing.
//   2. STRICT alternating yOffset (±0.42): every card sits clearly
//      above or below BOTH its neighbours, so even when two are at
//      similar screen-X during the sweep they never stack (one is high,
//      one is low). The strict alternation also keeps the ring's vertical
//      center of mass at 0 (centered composition). Previously radii
//      1.8-2.25 + irregular yOffsets up to ±0.6 pulled inner cards over
//      the Mac's labels and let neighbours pile vertically.
export const SKILL_LOGOS: SkillLogo[] = [
  { label: "React",      cat: "LIB",   color: "#61DAFB", radius: 3.00, yOffset:  0.42 },
  { label: "TypeScript", cat: "LANG",  color: "#3178C6", radius: 2.90, yOffset: -0.42 },
  { label: "Three.js",   cat: "3D",    color: "#0d0e10", radius: 3.00, yOffset:  0.42 },
  { label: "R3F",        cat: "3D",    color: "#e87040", radius: 2.90, yOffset: -0.42 },
  { label: "Python",     cat: "LANG",  color: "#FFD43B", radius: 3.00, yOffset:  0.42 },
  { label: "FastAPI",    cat: "API",   color: "#009688", radius: 2.90, yOffset: -0.42 },
  { label: "GSAP",       cat: "LIB",   color: "#88CE02", radius: 3.00, yOffset:  0.42 },
  { label: "Blender",    cat: "3D",    color: "#F5792A", radius: 2.90, yOffset: -0.42 },
  { label: "Figma",      cat: "TOOL",  color: "#A259FF", radius: 3.00, yOffset:  0.42 },
  { label: "MongoDB",    cat: "DB",    color: "#47A248", radius: 2.90, yOffset: -0.42 },
  { label: "Docker",     cat: "INFRA", color: "#2496ED", radius: 3.00, yOffset:  0.42 },
  { label: "GLSL",       cat: "SHADER",color: "#5586A4", radius: 2.90, yOffset: -0.42 },
];
