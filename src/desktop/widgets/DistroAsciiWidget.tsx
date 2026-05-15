import { useEffect, useRef, useState } from "react";
import { AsciiCatPlush } from "../AsciiCatPlush";

/**
 * Neofetch-style ASCII art card. ASCII rendering of the cat plush
 * (white, rotating on both axes) on the left, system / portfolio
 * info on the right. Designed to fill the widget slot below the
 * Spotify card.
 *
 * The ASCII art is rendered via `AsciiCatPlush` (vanilla three.js
 * + AsciiEffect). Sized to fit the card's height with a small
 * margin.
 */
export function DistroAsciiWidget() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [artSize, setArtSize] = useState(120);

  // Match the rendered ASCII art size to the card height so it
  // fills the available space regardless of where the widget is
  // dropped in the layout.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      // Square ASCII art clamped to card height (minus padding).
      const px = Math.max(60, Math.min(r.height - 16, r.width / 2));
      setArtSize(Math.floor(px));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapRef}
      style={{
        width: "100%",
        height: "100%",
        background: "var(--surface)",
        border: "1px solid var(--surface-alt)",
        borderRadius: 10,
        padding: 12,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 18,
        overflow: "hidden",
      }}
    >
      {/* ASCII art */}
      <div style={{ flexShrink: 0 }}>
        <AsciiCatPlush
          size={artSize}
          color="#ffffff"
          rpm={1.1}
          axis="y"
        />
      </div>

      {/* Neofetch-style info column */}
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          lineHeight: 1.45,
          color: "var(--text-lt)",
        }}
      >
        <div style={{ color: "var(--accent)", fontWeight: 700 }}>
          daniel@roomos
        </div>
        <div style={{ color: "var(--muted)" }}>
          ───────────────────
        </div>
        {ROWS.map((r) => (
          <div key={r.k} style={{ display: "flex", gap: 6 }}>
            <span
              style={{ color: "var(--accent)", flexShrink: 0, width: 64 }}
            >
              {r.k}
            </span>
            <span style={{ color: "var(--text-lt)" }}>{r.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ROWS: ReadonlyArray<{ k: string; v: string }> = [
  { k: "os", v: "RoomOS 1.0" },
  { k: "host", v: "danielrltan.com" },
  { k: "kernel", v: "three.js r170" },
  { k: "shell", v: "zsh 5.9" },
  { k: "theme", v: "warm-amber" },
  { k: "uptime", v: "open it & see" },
];
