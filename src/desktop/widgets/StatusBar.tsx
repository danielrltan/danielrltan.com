import { Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useTheme } from "../theme";

const WORKSPACES = 5;

/**
 * Full-width status strip at the bottom of the grid. Not a Card — it has
 * its own dark slab background so the bg gap doesn't bleed underneath.
 */
export function StatusBar() {
  const { mode, toggle } = useTheme();
  const [hoverToggle, setHoverToggle] = useState(false);
  const activeWs = 1;

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        height: 28,
        background: "var(--surface)",
        color: "var(--text-lt)",
        borderRadius: 6,
        padding: "0 12px",
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ display: "flex", gap: 6 }}>
        <span style={dot("var(--accent)")} />
        <span style={dot("var(--accent2)")} />
        <span style={dot("var(--muted)")} />
      </div>

      <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
        {Array.from({ length: WORKSPACES }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background:
                i === activeWs ? "var(--accent)" : "var(--surface-alt)",
              border: `1px solid ${i === activeWs ? "var(--accent)" : "var(--muted)"}`,
            }}
          />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 10,
        }}
      >
        <button
          onClick={toggle}
          onMouseEnter={() => setHoverToggle(true)}
          onMouseLeave={() => setHoverToggle(false)}
          aria-label="Toggle warm / cool"
          style={{
            width: 20,
            height: 20,
            borderRadius: 4,
            background: "transparent",
            border: "none",
            color: hoverToggle ? "var(--accent)" : "var(--muted)",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            transition: "color 0.15s ease",
          }}
        >
          {mode === "warm" ? <Sun size={13} /> : <Moon size={13} />}
        </button>
        <span style={{ color: "var(--muted)", letterSpacing: 0.6 }}>v1.0</span>
      </div>
    </div>
  );
}

function dot(c: string): React.CSSProperties {
  return {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: c,
    display: "inline-block",
  };
}
