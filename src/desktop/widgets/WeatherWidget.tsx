import { useEffect, useState } from "react";
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Card, Eyebrow } from "../Card";

interface Live {
  temp: number;
  code: number;
  isDay: boolean;
}

// Toronto City Hall: 43.6534° N, 79.3839° W.
const URL =
  "https://api.open-meteo.com/v1/forecast" +
  "?latitude=43.6534" +
  "&longitude=-79.3839" +
  "&current=temperature_2m,weather_code,is_day" +
  "&timezone=America%2FToronto";

const REFRESH_MS = 15 * 60 * 1000; // 15 min

/**
 * Map WMO weather codes (Open-Meteo) → short label + lucide icon.
 * https://open-meteo.com/en/docs#weathervariables
 */
function describe(code: number, isDay: boolean): {
  label: string;
  Icon: LucideIcon;
} {
  if (code === 0)
    return { label: "clear", Icon: isDay ? Sun : Cloud };
  if (code <= 2) return { label: "partly", Icon: CloudSun };
  if (code === 3) return { label: "overcast", Icon: Cloud };
  if (code === 45 || code === 48) return { label: "fog", Icon: CloudFog };
  if (code >= 51 && code <= 57) return { label: "drizzle", Icon: CloudDrizzle };
  if (code >= 61 && code <= 67) return { label: "rain", Icon: CloudRain };
  if (code >= 71 && code <= 77) return { label: "snow", Icon: CloudSnow };
  if (code >= 80 && code <= 82) return { label: "showers", Icon: CloudRain };
  if (code === 85 || code === 86) return { label: "snow showers", Icon: CloudSnow };
  if (code >= 95) return { label: "storm", Icon: CloudLightning };
  return { label: "—", Icon: Cloud };
}

export function WeatherWidget() {
  const [live, setLive] = useState<Live | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchNow = async () => {
      try {
        const r = await fetch(URL);
        if (!r.ok) throw new Error("net");
        const j = await r.json();
        const c = j.current;
        if (cancelled || !c) return;
        setLive({
          temp: Math.round(c.temperature_2m),
          code: c.weather_code,
          isDay: c.is_day === 1,
        });
        setErr(false);
      } catch {
        if (!cancelled) setErr(true);
      }
    };
    fetchNow();
    const id = setInterval(fetchNow, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const meta = live
    ? describe(live.code, live.isDay)
    : { label: err ? "offline" : "…", Icon: Cloud };

  return (
    <Card>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 14,
          height: "100%",
          alignItems: "stretch",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingRight: 10,
            borderRight: "1px solid var(--surface-alt)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 16,
              letterSpacing: 6,
              color: "var(--muted)",
              textTransform: "uppercase",
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
            }}
          >
            TORONTO
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <Eyebrow>weather · live</Eyebrow>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 4,
              color: "var(--text-lt)",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: 42,
                lineHeight: 1,
              }}
            >
              {live ? live.temp : "--"}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 18,
                color: "var(--accent)",
              }}
            >
              °C
            </span>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "var(--accent2)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            <meta.Icon size={15} />
            <span>{meta.label}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
