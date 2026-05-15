import { useEffect, useMemo, useState } from "react";
import { ExternalLink, GitBranch, Star, Users } from "lucide-react";

const USERNAME = "danielrltan";
const PROFILE_URL = `https://github.com/${USERNAME}`;

interface UserData {
  name: string | null;
  bio: string | null;
  public_repos: number;
  followers: number;
  following: number;
  avatar_url: string;
  created_at: string;
}

interface RepoData {
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  fork: boolean;
  archived: boolean;
  updated_at: string;
}

interface ContribDay {
  date: string;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
}

interface ContribResponse {
  total: { [year: string]: number };
  contributions: ContribDay[];
}

const LEVEL_COLORS = [
  "rgba(255, 255, 255, 0.06)",
  "#5a2a18",
  "#a8472a",
  "#d96434",
  "#ff7842",
];

const SQUARE = 10;
const SQUARE_GAP = 3;

/** Renders a year of commit squares. Same look as GitHub's calendar. */
function ContributionGrid({ days }: { days: ContribDay[] }) {
  const weeks = useMemo(() => {
    if (days.length === 0) return [] as (ContribDay | null)[][];
    const sorted = [...days].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
    const firstDow = new Date(sorted[0]!.date + "T00:00:00").getDay();
    const padded: (ContribDay | null)[] = [
      ...Array.from({ length: firstDow }, () => null),
      ...sorted,
    ];
    const out: (ContribDay | null)[][] = [];
    for (let i = 0; i < padded.length; i += 7) {
      out.push(padded.slice(i, i + 7));
    }
    return out;
  }, [days]);

  return (
    <div
      style={{
        display: "flex",
        gap: SQUARE_GAP,
        overflowX: "auto",
        paddingBottom: 4,
      }}
    >
      {weeks.map((w, wi) => (
        <div
          key={wi}
          style={{ display: "flex", flexDirection: "column", gap: SQUARE_GAP }}
        >
          {Array.from({ length: 7 }).map((_, di) => {
            const d = w[di];
            if (!d) {
              return (
                <div
                  key={di}
                  style={{
                    width: SQUARE,
                    height: SQUARE,
                    visibility: "hidden",
                  }}
                />
              );
            }
            return (
              <div
                key={di}
                title={`${d.date} · ${d.count} ${d.count === 1 ? "contribution" : "contributions"}`}
                style={{
                  width: SQUARE,
                  height: SQUARE,
                  borderRadius: 2,
                  background: LEVEL_COLORS[d.level] ?? LEVEL_COLORS[0],
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Stacked-bar language breakdown built from `repos[].language` counts. */
function LanguageBar({ repos }: { repos: RepoData[] }) {
  const breakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of repos) {
      if (!r.language) continue;
      counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
    return Array.from(counts.entries())
      .map(([lang, n]) => ({ lang, n, pct: (n / total) * 100 }))
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 6);
  }, [repos]);

  // Same warm palette as the contributions grid, ramped.
  const palette = ["#ff7842", "#d96434", "#a8472a", "#ffb077", "#7a3d22", "#5a2a18"];

  if (breakdown.length === 0) return null;
  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 6,
          borderRadius: 3,
          overflow: "hidden",
          marginBottom: 8,
        }}
      >
        {breakdown.map((b, i) => (
          <div
            key={b.lang}
            style={{
              width: `${b.pct}%`,
              background: palette[i % palette.length],
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 14px",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--muted)",
        }}
      >
        {breakdown.map((b, i) => (
          <span
            key={b.lang}
            style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: palette[i % palette.length],
              }}
            />
            {b.lang} · {b.pct.toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  );
}

function yearsSince(iso: string): string {
  const start = new Date(iso).getTime();
  const years = (Date.now() - start) / (1000 * 60 * 60 * 24 * 365.25);
  if (years < 1) return `${Math.floor(years * 12)} months`;
  return `${years.toFixed(1)} yrs`;
}

export function GithubWindow() {
  const [user, setUser] = useState<UserData | null>(null);
  const [repos, setRepos] = useState<RepoData[]>([]);
  const [contribs, setContribs] = useState<ContribResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [u, r, c] = await Promise.all([
          fetch(`https://api.github.com/users/${USERNAME}`).then((res) => {
            if (!res.ok) throw new Error(`user ${res.status}`);
            return res.json() as Promise<UserData>;
          }),
          fetch(
            `https://api.github.com/users/${USERNAME}/repos?sort=updated&per_page=100`,
          ).then((res) => {
            if (!res.ok) throw new Error(`repos ${res.status}`);
            return res.json() as Promise<RepoData[]>;
          }),
          fetch(
            `https://github-contributions-api.jogruber.de/v4/${USERNAME}?y=last`,
          ).then((res) => {
            if (!res.ok) throw new Error(`contrib ${res.status}`);
            return res.json() as Promise<ContribResponse>;
          }),
        ]);
        if (cancelled) return;
        setUser(u);
        setRepos(r.filter((x) => !x.fork && !x.archived));
        setContribs(c);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalStars = useMemo(
    () => repos.reduce((s, r) => s + r.stargazers_count, 0),
    [repos],
  );
  const totalContribs = contribs
    ? Object.values(contribs.total).reduce((a, b) => a + b, 0)
    : null;
  const topRepos = useMemo(
    () =>
      [...repos]
        .sort((a, b) => b.stargazers_count - a.stargazers_count)
        .slice(0, 6),
    [repos],
  );

  return (
    <div
      style={{
        padding: 22,
        height: "100%",
        boxSizing: "border-box",
        overflow: "auto",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {user && (
            <img
              src={user.avatar_url}
              alt=""
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                border: "1px solid var(--surface-alt)",
              }}
            />
          )}
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
              {user?.name ?? `@${USERNAME}`}
            </h1>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--muted)",
                marginTop: 2,
              }}
            >
              @{USERNAME}
              {user ? ` · ${yearsSince(user.created_at)} on github` : ""}
            </div>
            {user?.bio && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-lt)",
                  opacity: 0.85,
                  marginTop: 4,
                  maxWidth: 460,
                }}
              >
                {user.bio}
              </div>
            )}
          </div>
        </div>
        <a
          href={PROFILE_URL}
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
            flexShrink: 0,
          }}
        >
          open on github <ExternalLink size={11} />
        </a>
      </div>

      {/* Stats strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
        }}
      >
        <Stat label="repos" value={user?.public_repos ?? "—"} />
        <Stat
          label="followers"
          value={user?.followers ?? "—"}
          icon={<Users size={11} />}
        />
        <Stat
          label="total stars"
          value={totalStars}
          icon={<Star size={11} />}
        />
        <Stat
          label="contribs / yr"
          value={totalContribs ?? "—"}
        />
      </div>

      {/* Language breakdown */}
      {repos.length > 0 && (
        <div
          style={{
            background: "var(--surface-alt)",
            borderRadius: 8,
            padding: 14,
          }}
        >
          <Eyebrow>languages</Eyebrow>
          <div style={{ marginTop: 10 }}>
            <LanguageBar repos={repos} />
          </div>
        </div>
      )}

      {/* Contributions grid */}
      <div
        style={{
          background: "var(--surface-alt)",
          borderRadius: 8,
          padding: 14,
        }}
      >
        <Eyebrow>contributions · last year</Eyebrow>
        <div style={{ marginTop: 10 }}>
          {contribs ? (
            <ContributionGrid days={contribs.contributions} />
          ) : (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--muted)",
                padding: "6px 0",
              }}
            >
              {err ? "couldn't reach contributions service" : "loading…"}
            </div>
          )}
        </div>
      </div>

      {/* Top repos */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Eyebrow>top repositories · by stars</Eyebrow>
        {topRepos.length === 0 && !err && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--muted)",
            }}
          >
            fetching…
          </div>
        )}
        {topRepos.map((r) => (
          <a
            key={r.full_name}
            href={r.html_url}
            target="_blank"
            rel="noreferrer"
            style={{
              background: "var(--surface-alt)",
              borderRadius: 8,
              padding: 12,
              border: "1px solid transparent",
              transition: "border-color 0.15s ease",
              cursor: "pointer",
              textDecoration: "none",
              color: "inherit",
              display: "block",
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
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  color: "var(--accent)",
                }}
              >
                {r.name}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--muted)",
                }}
              >
                updated {new Date(r.updated_at).toLocaleDateString()}
              </span>
            </div>
            {r.description && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--text-lt)",
                  opacity: 0.85,
                  lineHeight: 1.5,
                  marginBottom: 6,
                }}
              >
                {r.description}
              </div>
            )}
            <div
              style={{
                display: "flex",
                gap: 14,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--muted)",
              }}
            >
              {r.language && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <span
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: "50%",
                      background: "var(--accent2)",
                      display: "inline-block",
                    }}
                  />
                  {r.language}
                </span>
              )}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Star size={11} /> {r.stargazers_count}
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <GitBranch size={11} /> {r.forks_count}
              </span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--surface-alt)",
        borderRadius: 8,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 4,
          fontFamily: "var(--font-display)",
          fontSize: 18,
          fontWeight: 700,
          color: "var(--text-lt)",
        }}
      >
        {icon}
        {value}
      </div>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}
