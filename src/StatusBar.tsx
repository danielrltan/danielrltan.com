import { useEffect, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useScrollProgress } from "./useScrollProgress";
import { useAudioToggle } from "./useAudioToggle";

/**
 * Top-right status badge. TE / spec-sheet flavour: a small pill with
 * the current section index, a live clock, and a pulsing "REC" dot.
 *
 * Purpose: anchor the page to the moment (this is alive, not static)
 * and reinforce the industrial-spec-sheet aesthetic. Sits opposite
 * the brand cat in the top-left for visual balance.
 */

interface Section {
  /** scroll-progress threshold at which this section becomes active. */
  at: number;
  /** "01" — "07" */
  number: string;
  /** human label */
  label: string;
}

// Mirrors PortfolioSections render order and (roughly) the ScrollCamera
// stop schedule. When the user crosses a threshold the badge updates.
const SECTIONS: Section[] = [
  { at: 0.00, number: "00", label: "Hero" },
  { at: 0.10, number: "01", label: "About" },
  { at: 0.22, number: "02", label: "Skills" },
  { at: 0.36, number: "03", label: "Projects" },
  { at: 0.52, number: "04", label: "Work" },
  { at: 0.66, number: "05", label: "Play" },
  { at: 0.80, number: "06", label: "Other" },
  { at: 0.92, number: "07", label: "Contact" },
];

function formatClock(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function StatusBar() {
  const progress = useScrollProgress();
  const [now, setNow] = useState(() => new Date());
  const audio = useAudioToggle();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Pick the highest-threshold section whose .at <= progress.
  let active = SECTIONS[0]!;
  for (const s of SECTIONS) {
    if (progress >= s.at) active = s;
    else break;
  }
  const progressPct = Math.round(progress * 100);

  return (
    <div
      style={{
        position: "fixed",
        top: 18,
        right: 22,
        zIndex: 40,
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        padding: "6px 6px 6px 14px",
        background: "rgba(255, 255, 255, 0.72)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        border: "1px solid rgba(26, 23, 20, 0.10)",
        borderRadius: 999,
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--wrapper-ink)",
        fontWeight: 600,
        userSelect: "none",
      }}
    >
      <span style={{ color: "var(--accent)", fontVariantNumeric: "tabular-nums" }}>
        {active.number}
      </span>
      <span>{active.label}</span>
      <span style={{ opacity: 0.25 }}>·</span>
      <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.85 }}>
        {formatClock(now)}
      </span>
      <span style={{ opacity: 0.25 }}>·</span>
      <span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.65 }}>
        {String(progressPct).padStart(3, "0")}%
      </span>
      <button
        type="button"
        onClick={audio.toggle}
        aria-label={audio.on ? "Mute ambience" : "Play ambience"}
        aria-pressed={audio.on}
        style={{
          marginLeft: 2,
          width: 28,
          height: 28,
          borderRadius: 999,
          border: "1px solid rgba(26, 23, 20, 0.12)",
          background: audio.on
            ? "rgba(232, 112, 64, 0.14)"
            : "rgba(26, 23, 20, 0.04)",
          color: audio.on ? "var(--accent)" : "var(--wrapper-ink)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          padding: 0,
          transition: "background 0.18s ease, color 0.18s ease",
        }}
      >
        {audio.on ? (
          <Volume2 size={13} strokeWidth={2} />
        ) : (
          <VolumeX size={13} strokeWidth={2} />
        )}
      </button>
    </div>
  );
}
