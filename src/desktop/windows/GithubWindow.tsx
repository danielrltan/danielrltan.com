import { ExternalLink, GitBranch, Star } from "lucide-react";

interface Repo {
  name: string;
  desc: string;
  stars: number;
  forks: number;
  lang: string;
}

const REPOS: Repo[] = [
  {
    name: "danielrltan/room",
    desc: "Interactive 3D bedroom portfolio with a tiny OS on the monitor.",
    stars: 142,
    forks: 12,
    lang: "TypeScript",
  },
  {
    name: "danielrltan/shader-sketches",
    desc: "A growing collection of GLSL fragment shaders + a small viewer.",
    stars: 68,
    forks: 5,
    lang: "GLSL",
  },
  {
    name: "danielrltan/dotfiles",
    desc: "Warm-amber Hyprland rice, neovim config, and supporting scripts.",
    stars: 54,
    forks: 8,
    lang: "Shell",
  },
  {
    name: "danielrltan/microsynth",
    desc: "Microsynth experiments compiled to WebAssembly.",
    stars: 41,
    forks: 3,
    lang: "Rust",
  },
];

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  GLSL: "#5a8fbb",
  Shell: "#89e051",
  Rust: "#dea584",
};

export function GithubWindow() {
  return (
    <div style={{ padding: 22 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 18,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 20,
              fontWeight: 700,
              color: "var(--text-lt)",
            }}
          >
            @danielrltan
          </h1>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--muted)",
              marginTop: 2,
            }}
          >
            42 repos · 1.1k commits · 4 years
          </div>
        </div>
        <a
          href="#"
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          open on github <ExternalLink size={11} />
        </a>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {REPOS.map((r) => (
          <div
            key={r.name}
            style={{
              background: "var(--surface-alt)",
              borderRadius: 8,
              padding: 14,
              border: "1px solid transparent",
              transition: "border-color 0.15s ease",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "transparent";
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                color: "var(--accent)",
                marginBottom: 4,
              }}
            >
              {r.name}
            </div>
            <div
              style={{
                fontSize: 12,
                color: "var(--text-lt)",
                opacity: 0.85,
                lineHeight: 1.55,
                marginBottom: 8,
              }}
            >
              {r.desc}
            </div>
            <div
              style={{
                display: "flex",
                gap: 14,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--muted)",
              }}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: LANG_COLORS[r.lang] ?? "var(--accent2)",
                    display: "inline-block",
                  }}
                />
                {r.lang}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Star size={11} /> {r.stars}
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <GitBranch size={11} /> {r.forks}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
