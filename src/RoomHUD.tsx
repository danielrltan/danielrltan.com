import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { BlinkingCat } from "./BlinkingCat";
import { MouseIcon } from "./MouseIcon";

/**
 * Persistent chrome shown over the room view: brand mark top-left,
 * reset button bottom-left, mouse controls hint bottom-right.
 * Hidden during desk view / fullscreen OS since the camera is no
 * longer in free-orbit and the user isn't interacting with the room.
 */
interface Props {
  onReset: () => void;
}

const HUD_PADDING = 22;
const HUD_Z = 30;
const FADE_IN_MS = 700;

export function RoomHUD({ onReset }: Props) {
  // Mount-time fade-in. The HUD mounts the instant `sceneReady` flips
  // at the end of the intro zoom — without this it'd snap into view.
  // Initial render commits at opacity 0, then a rAF tick flips to 1
  // so the CSS transition runs from 0 → 1.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity: shown ? 1 : 0,
        transition: `opacity ${FADE_IN_MS}ms ease`,
      }}
    >
      {/* Brand mark — cat logo + name. */}
      <div
        style={{
          position: "absolute",
          top: HUD_PADDING,
          left: HUD_PADDING,
          display: "flex",
          alignItems: "center",
          gap: 12,
          zIndex: HUD_Z,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        <BlinkingCat size={30} />
        <span
          style={{
            // Matched to the cat fill so the lockup reads as one
            // unified element rather than two competing accents.
            color: "var(--hud-amber)",
            fontFamily: "var(--font-display)",
            fontSize: 24,
            fontWeight: 400,
            letterSpacing: "-0.06em",
            // Soft drop-shadow so the wordmark stays legible whether
            // the camera frames a dark wall or a bright window behind.
          }}
        >
          Daniel Tan
        </span>
      </div>

      {/* Reset — bottom-left, glass pill matching the hint banner. */}
      <ResetButton onReset={onReset} />

      {/* Mouse controls — bottom-right, icon-above-label trio. */}
      <div
        style={{
          position: "absolute",
          bottom: HUD_PADDING,
          right: HUD_PADDING,
          zIndex: HUD_Z,
          display: "flex",
          alignItems: "flex-end",
          gap: 22,
          pointerEvents: "none",
          userSelect: "none",
          color: "var(--hud-cream)",
        }}
      >
        <MouseHint icon={<MouseIcon highlight="left" />} label="rotate" />
        <MouseHint icon={<MouseIcon highlight="right" />} label="pan" />
        <MouseHint icon={<MouseIcon highlight="scroll" />} label="zoom" />
      </div>
    </div>
  );
}

function ResetButton({ onReset }: { onReset: () => void }) {
  const base: CSSProperties = {
    position: "absolute",
    bottom: HUD_PADDING,
    left: HUD_PADDING,
    zIndex: HUD_Z,
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 14px",
    background: "rgba(20, 18, 16, 0.55)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    border: "1px solid rgba(255, 176, 119, 0.22)",
    borderRadius: 999,
    color: "var(--hud-cream)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-sm)",
    letterSpacing: "var(--tracking-wide)",
    textTransform: "uppercase",
    cursor: "pointer",
    // Parent HUD wrapper has `pointer-events: none` so the brand and
    // mouse hints stay click-through. The button needs an explicit
    // `auto` to remain clickable through that wrapper.
    pointerEvents: "auto",
    transition:
      "background 0.18s ease, border-color 0.18s ease, color 0.18s ease",
  };

  return (
    <button
      type="button"
      onClick={onReset}
      style={base}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(255, 176, 119, 0.18)";
        e.currentTarget.style.borderColor = "rgba(255, 176, 119, 0.55)";
        e.currentTarget.style.color = "var(--hud-amber)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(20, 18, 16, 0.55)";
        e.currentTarget.style.borderColor = "rgba(255, 176, 119, 0.22)";
        e.currentTarget.style.color = "var(--hud-cream)";
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = "scale(0.97)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
      aria-label="Reset room"
    >
      <RotateCcw size={13} strokeWidth={2} />
      reset
    </button>
  );
}

function MouseHint({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 7,
        opacity: 0.85,
      }}
    >
      {icon}
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-xs)",
          letterSpacing: "var(--tracking-wider)",
          textTransform: "uppercase",
          // Slight dimming on the label vs the icon so the icon reads
          // as primary and the label as supporting tag.
          opacity: 0.78,
        }}
      >
        {label}
      </span>
    </div>
  );
}
