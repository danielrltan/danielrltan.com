interface Project {
  title: string;
  blurb: string;
  tags: string[];
}

const PROJECTS: Project[] = [
  { title: "Room OS", blurb: "Interactive 3D bedroom + portfolio OS on the monitor.", tags: ["R3F", "Rapier", "TS"] },
  { title: "Generative Posters", blurb: "WebGL shader-based poster generator with prompts.", tags: ["GLSL", "WebGL"] },
  { title: "Audio Sketches", blurb: "Tiny experiments with the Web Audio API and microtonal sound.", tags: ["Web Audio"] },
  { title: "Tiling WM Rice", blurb: "Warm-palette dotfiles for a minimal Hyprland workflow.", tags: ["Hyprland", "CSS"] },
  { title: "Field Notes", blurb: "MDX-driven blog and longform writing.", tags: ["MDX", "Vite"] },
  { title: "Synth Studies", blurb: "Microsynth experiments compiled to WebAssembly.", tags: ["Rust", "Wasm"] },
];

export function ProjectsWindow() {
  return (
    <div style={{ padding: 22 }}>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: 20,
          fontWeight: 700,
          color: "var(--text-lt)",
          letterSpacing: -0.3,
        }}
      >
        Projects
      </h1>
      <p
        style={{
          margin: "4px 0 18px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted)",
          letterSpacing: 0.5,
        }}
      >
        Selected work · {PROJECTS.length} entries
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {PROJECTS.map((p) => (
          <div
            key={p.title}
            style={{
              background: "var(--surface-alt)",
              borderRadius: 8,
              padding: 14,
              border: "1px solid transparent",
              transition: "border-color 0.15s ease, transform 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "transparent";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 14,
                color: "var(--text-lt)",
                marginBottom: 6,
              }}
            >
              {p.title}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-lt)",
                opacity: 0.8,
                lineHeight: 1.55,
                marginBottom: 8,
              }}
            >
              {p.blurb}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {p.tags.map((t) => (
                <span
                  key={t}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    letterSpacing: 0.6,
                    padding: "3px 7px",
                    border: "1px solid var(--muted)",
                    borderRadius: 999,
                    color: "var(--muted)",
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
