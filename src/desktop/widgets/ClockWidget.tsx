import { useEffect, useState } from "react";
import { Card, Eyebrow } from "../Card";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 250);
    return () => clearInterval(id);
  }, []);
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = now.getSeconds();
  // Colon blinks at 1Hz with the clock's own seconds.
  const colon = ss % 2 === 0 ? ":" : " ";
  const day = now.toLocaleDateString(undefined, { weekday: "long" });
  const date = now
    .toLocaleDateString(undefined, { month: "short", day: "2-digit" })
    .toUpperCase();
  const tz = "EST";
  const secPct = (ss / 60) * 100;

  return (
    <Card col="span 3" row="span 1">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
        }}
      >
        <Eyebrow>clock</Eyebrow>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: 38,
            lineHeight: 1,
            color: "var(--text-lt)",
            letterSpacing: 2,
          }}
        >
          {hh}
          <span style={{ color: "var(--accent)" }}>{colon}</span>
          {mm}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: "var(--muted)",
            }}
          >
            {day} · {date}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: 2,
              color: "var(--accent)",
              marginLeft: "auto",
            }}
          >
            {tz}
          </span>
        </div>
        <div
          style={{
            height: 2,
            background: "var(--surface-alt)",
            borderRadius: 1,
            overflow: "hidden",
            marginTop: 4,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${secPct}%`,
              background: "var(--accent)",
              transition: "width 0.25s linear",
            }}
          />
        </div>
      </div>
    </Card>
  );
}
