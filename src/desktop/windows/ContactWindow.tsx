import { useState } from "react";
import { Mail } from "lucide-react";

function GithubIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17.92-.26 1.9-.39 2.88-.39s1.96.13 2.88.39c2.19-1.48 3.15-1.17 3.15-1.17.62 1.58.23 2.75.11 3.04.73.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.36-5.25 5.65.41.35.78 1.05.78 2.11v3.13c0 .31.21.67.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}

function LinkedinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19 0H5C2.24 0 0 2.24 0 5v14c0 2.76 2.24 5 5 5h14c2.76 0 5-2.24 5-5V5c0-2.76-2.24-5-5-5zM8 19H5V8h3v11zM6.5 6.73a1.73 1.73 0 110-3.46 1.73 1.73 0 010 3.46zM20 19h-3v-5.6c0-1.36-.49-2.28-1.7-2.28-.93 0-1.48.62-1.72 1.22-.09.22-.11.52-.11.82V19h-3V8h3v1.27c.4-.62 1.11-1.5 2.7-1.5 1.97 0 3.45 1.29 3.45 4.06V19z" />
    </svg>
  );
}

const field: React.CSSProperties = {
  width: "100%",
  background: "var(--surface-alt)",
  color: "var(--text-lt)",
  border: "1px solid transparent",
  borderRadius: 6,
  padding: "9px 11px",
  fontSize: 13,
  outline: "none",
  fontFamily: "inherit",
  transition: "border-color 0.15s ease, box-shadow 0.15s ease",
};

const label: React.CSSProperties = {
  display: "block",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: "var(--muted)",
  marginBottom: 5,
};

export function ContactWindow() {
  const [focused, setFocused] = useState<string | null>(null);
  const ring = (k: string): React.CSSProperties =>
    focused === k
      ? { borderColor: "var(--accent)", boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent)" }
      : {};
  return (
    <div style={{ padding: 22 }}>
      <h1
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: 20,
          fontWeight: 700,
          color: "var(--text-lt)",
        }}
      >
        Contact
      </h1>
      <p
        style={{
          margin: "4px 0 18px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        I read everything. Promise.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label style={label}>name</label>
          <input
            style={{ ...field, ...ring("name") }}
            onFocus={() => setFocused("name")}
            onBlur={() => setFocused(null)}
            placeholder="Your name"
          />
        </div>
        <div>
          <label style={label}>email</label>
          <input
            type="email"
            style={{ ...field, ...ring("email") }}
            onFocus={() => setFocused("email")}
            onBlur={() => setFocused(null)}
            placeholder="you@domain.com"
          />
        </div>
        <div>
          <label style={label}>message</label>
          <textarea
            rows={4}
            style={{ ...field, ...ring("msg"), resize: "vertical" }}
            onFocus={() => setFocused("msg")}
            onBlur={() => setFocused(null)}
            placeholder="What's up?"
          />
        </div>
        <button
          style={{
            alignSelf: "flex-start",
            padding: "8px 16px",
            borderRadius: 6,
            background: "var(--accent)",
            color: "var(--text-dk)",
            border: "none",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.2,
            textTransform: "uppercase",
            cursor: "pointer",
            marginTop: 4,
          }}
        >
          send →
        </button>
      </div>
      <div
        style={{
          marginTop: 22,
          paddingTop: 16,
          borderTop: "1px solid var(--surface-alt)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <a href="#" aria-label="github" style={socialBtn}>
          <GithubIcon size={16} />
        </a>
        <a href="#" aria-label="linkedin" style={socialBtn}>
          <LinkedinIcon size={16} />
        </a>
        <a href="mailto:hello@danieltan.dev" aria-label="email" style={socialBtn}>
          <Mail size={16} />
        </a>
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          hello@danieltan.dev
        </span>
      </div>
    </div>
  );
}

const socialBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: "50%",
  border: "1.5px solid var(--muted)",
  display: "grid",
  placeItems: "center",
  color: "var(--text-lt)",
  textDecoration: "none",
};
