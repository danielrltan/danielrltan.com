import { useEffect, useMemo, useState } from "react";
import { Card, Eyebrow } from "../Card";

/**
 * Live clock — 12-hour format. Sits on the standard dark Card surface
 * (consistent with the rest of the OS widgets), with a small blurred
 * blob in the top-right whose colour signals time of day (cool blues
 * at night, warm orange dusk/dawn, soft cream midday).
 */
export function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 250);
    return () => clearInterval(id);
  }, []);

  const h24 = now.getHours();
  const minute = now.getMinutes();
  const h12 = ((h24 + 11) % 12) + 1;
  const ampm = h24 < 12 ? "am" : "pm";
  const showColon = now.getSeconds() % 2 === 0;

  const palette = useMemo(() => paletteForHour(h24), [h24]);

  const dayLabel = now
    .toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    .toLowerCase();

  return (
    <Card
      style={{
        position: "relative",
        border: "1px solid var(--surface-alt)",
      }}
    >
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "space-between",
        }}
      >
        <Eyebrow>clock</Eyebrow>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 700,
            fontSize: 40,
            lineHeight: 1,
            letterSpacing: 1,
            color: "var(--text-lt)",
            display: "flex",
            alignItems: "baseline",
            gap: 2,
          }}
        >
          {h12}
          <span
            style={{
              color: palette.accent,
              opacity: showColon ? 1 : 0.2,
              transition: "opacity 0.15s ease",
            }}
          >
            :
          </span>
          {String(minute).padStart(2, "0")}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              letterSpacing: 2,
              textTransform: "uppercase",
              marginLeft: 6,
              color: "var(--muted)",
            }}
          >
            {ampm}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: "var(--muted)",
          }}
        >
          <span>{dayLabel}</span>
          <span style={{ color: palette.accent }}>est</span>
        </div>
      </div>
    </Card>
  );
}

interface TimePalette {
  blob: string;
  accent: string;
}

function paletteForHour(h: number): TimePalette {
  if (h < 5)
    return {
      blob: "radial-gradient(circle, rgba(120,140,210,0.85) 0%, transparent 70%)",
      accent: "#9bb0e0",
    };
  if (h < 8)
    return {
      blob: "radial-gradient(circle, rgba(255,170,90,0.95) 0%, transparent 70%)",
      accent: "#ffb077",
    };
  if (h < 11)
    return {
      blob: "radial-gradient(circle, rgba(255,200,120,0.95) 0%, transparent 70%)",
      accent: "#ffc88a",
    };
  if (h < 15)
    return {
      blob: "radial-gradient(circle, rgba(255,235,170,0.95) 0%, transparent 65%)",
      accent: "#ffd680",
    };
  if (h < 18)
    return {
      blob: "radial-gradient(circle, rgba(255,170,80,0.95) 0%, transparent 65%)",
      accent: "#ff9a52",
    };
  if (h < 21)
    return {
      blob: "radial-gradient(circle, rgba(255,110,66,0.95) 0%, transparent 65%)",
      accent: "#ff7842",
    };
  return {
    blob: "radial-gradient(circle, rgba(120,130,200,0.7) 0%, transparent 70%)",
    accent: "#9ba9d8",
  };
}
