import { useEffect, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Card, Eyebrow } from "../Card";
import { startAmbience, stopAmbience } from "../../audio";

const BARS = 24;

export function NowPlayingWidget() {
  const [playing, setPlaying] = useState(false);
  // Seeded random heights so each bar oscillates around its own baseline.
  const baseRef = useRef<number[]>(
    Array.from({ length: BARS }, () => 0.3 + Math.random() * 0.6),
  );
  const [heights, setHeights] = useState<number[]>(baseRef.current);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setHeights(
        baseRef.current.map(
          (base) => base * (0.55 + Math.random() * 0.55),
        ),
      );
    }, 110);
    return () => clearInterval(id);
  }, [playing]);

  const togglePlay = () => {
    setPlaying((p) => {
      if (p) stopAmbience();
      else startAmbience(0.32);
      return !p;
    });
  };

  return (
    <Card col="span 4" row="span 2">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 16,
          height: "100%",
          alignItems: "stretch",
        }}
      >
        {/* Vinyl */}
        <div
          style={{
            width: 110,
            aspectRatio: "1 / 1",
            borderRadius: "50%",
            background:
              "radial-gradient(circle at center, var(--accent) 0 8%, var(--surface-alt) 9% 16%, #0a0807 17% 30%, #15110e 31% 45%, #0a0807 46% 60%, #15110e 61% 75%, #0a0807 76% 88%, var(--surface-alt) 89% 100%)",
            border: "2px solid var(--surface-alt)",
            animation: playing
              ? "desktopos-spin 6s linear infinite"
              : "none",
            animationPlayState: playing ? "running" : "paused",
            alignSelf: "center",
            flexShrink: 0,
            position: "relative",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "var(--accent)",
              border: "2px solid #000",
            }}
          />
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            minWidth: 0,
          }}
        >
          <div>
            <Eyebrow>now playing</Eyebrow>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 700,
                fontSize: 18,
                color: "var(--text-lt)",
                marginTop: 6,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              Room Ambience
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--muted)",
                marginTop: 2,
                letterSpacing: 0.5,
              }}
            >
              Daniel Tan · side a
            </div>
          </div>

          {/* Waveform */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 2,
              height: 28,
              marginTop: 8,
            }}
          >
            {heights.map((h, i) => (
              <div
                key={i}
                style={{
                  flex: 1,
                  height: `${Math.max(8, h * 100)}%`,
                  background:
                    i % 6 === 0 ? "var(--accent)" : "var(--accent2)",
                  borderRadius: 1,
                  transition: "height 0.11s ease",
                }}
              />
            ))}
          </div>

          {/* Controls */}
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <CtlBtn label="prev">
              <SkipBack size={14} strokeWidth={1.8} />
            </CtlBtn>
            <CtlBtn label={playing ? "pause" : "play"} onClick={togglePlay}>
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </CtlBtn>
            <CtlBtn label="next">
              <SkipForward size={14} strokeWidth={1.8} />
            </CtlBtn>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes desktopos-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </Card>
  );
}

function CtlBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  label: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={label}
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        border: `1px solid ${hover ? "var(--accent)" : "var(--surface-alt)"}`,
        background: hover ? "var(--accent)" : "transparent",
        color: hover ? "var(--text-dk)" : "var(--text-lt)",
        cursor: "pointer",
        display: "grid",
        placeItems: "center",
        transition: "all 0.15s ease",
      }}
    >
      {children}
    </button>
  );
}
