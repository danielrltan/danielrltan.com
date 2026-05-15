import { useEffect, useState } from "react";
import { Card, Eyebrow } from "../Card";

const HOUSE = [
  "      _____      ",
  "     /     \\     ",
  "    /_______\\    ",
  "    |  ▢  ▢ |    ",
  "    |    █   |   ",
  "    |________|   ",
];

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m === 0 ? `${r}s` : `${m}m ${String(r).padStart(2, "0")}s`;
}

const ROWS: ReadonlyArray<{ k: string; v: string; tint?: string }> = [
  { k: "os", v: "RoomOS 1.0" },
  { k: "shell", v: "zsh 5.9" },
  { k: "wm", v: "three.js r170" },
  { k: "theme", v: "warm-amber", tint: "var(--accent)" },
  { k: "res", v: `${window.innerWidth}×${window.innerHeight}` },
  { k: "pkgs", v: "42" },
];

export function SystemInfoWidget() {
  const [start] = useState(() => Date.now());
  const [uptime, setUptime] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setUptime(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [start]);

  return (
    <Card col="span 4" row="span 2">
      <Eyebrow>system</Eyebrow>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 20,
          marginTop: 12,
          alignItems: "center",
          height: "calc(100% - 24px)",
        }}
      >
        <pre
          style={{
            margin: 0,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            lineHeight: 1.2,
            color: "var(--accent2)",
            whiteSpace: "pre",
          }}
        >
          {HOUSE.join("\n")}
        </pre>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          {ROWS.map((r) => (
            <div
              key={r.k}
              style={{ display: "flex", justifyContent: "space-between" }}
            >
              <span style={{ color: "var(--accent)" }}>{r.k}</span>
              <span style={{ color: r.tint ?? "var(--text-lt)" }}>{r.v}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--accent)" }}>uptime</span>
            <span style={{ color: "var(--accent2)" }}>{fmt(uptime)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
