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
  const palette = paletteFor(live?.code ?? 3, live?.isDay ?? true);

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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Eyebrow>weather · toronto</Eyebrow>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: 2,
              textTransform: "uppercase",
              color: palette.accent,
            }}
          >
            live
          </span>
        </div>
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
              fontFamily: "var(--font-display)",
              fontWeight: 700,
              fontSize: 40,
              lineHeight: 1,
            }}
          >
            {live ? live.temp : "--"}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 16,
              color: palette.accent,
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
            color: "var(--muted)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          <meta.Icon size={14} color={palette.accent} />
          <span>{meta.label}</span>
        </div>
      </div>
    </Card>
  );
}

interface WeatherPalette {
  blob: string;
  accent: string;
}

/** Pick the signal-blob colour + accent based on WMO code + day/night. */
function paletteFor(code: number, isDay: boolean): WeatherPalette {
  if (!isDay)
    return {
      blob: "radial-gradient(circle, rgba(120,140,200,0.85) 0%, transparent 70%)",
      accent: "#9bb0e0",
    };
  if (code === 0)
    return {
      blob: "radial-gradient(circle, rgba(255,205,110,0.95) 0%, transparent 65%)",
      accent: "#ffc070",
    };
  if (code <= 2)
    return {
      blob: "radial-gradient(circle, rgba(255,210,140,0.9) 0%, transparent 65%)",
      accent: "#ffb077",
    };
  if (code === 3)
    return {
      blob: "radial-gradient(circle, rgba(200,195,185,0.85) 0%, transparent 65%)",
      accent: "#c9bfb2",
    };
  if (code === 45 || code === 48)
    return {
      blob: "radial-gradient(circle, rgba(220,220,215,0.7) 0%, transparent 60%)",
      accent: "#bfb8ad",
    };
  if (code >= 51 && code <= 67)
    return {
      blob: "radial-gradient(circle, rgba(120,140,170,0.85) 0%, transparent 65%)",
      accent: "#9bb0c8",
    };
  if (code >= 71 && code <= 77)
    return {
      blob: "radial-gradient(circle, rgba(220,225,235,0.9) 0%, transparent 65%)",
      accent: "#cdd6e0",
    };
  if (code >= 80 && code <= 82)
    return {
      blob: "radial-gradient(circle, rgba(100,130,160,0.85) 0%, transparent 65%)",
      accent: "#8aa6c4",
    };
  if (code >= 95)
    return {
      blob: "radial-gradient(circle, rgba(190,150,230,0.85) 0%, transparent 65%)",
      accent: "#c8aaff",
    };
  return {
    blob: "radial-gradient(circle, rgba(200,195,185,0.8) 0%, transparent 65%)",
    accent: "#b8aea0",
  };
}
