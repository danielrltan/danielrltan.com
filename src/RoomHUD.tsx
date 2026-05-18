import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { BlinkingCat } from "./BlinkingCat";
import { MouseIcon } from "./MouseIcon";

/**
 * Persistent chrome shown over the room view: brand mark top-left,
 * reset button bottom-left, mouse controls hint bottom-right.
 *
 * The brand mark is always shown (including the iso pre-view phase
 * before the user starts the intro). The controls (reset + mouse
 * hints) only appear once `interactive=true`, since they reference
 * actions that don't apply during the iso phase.
 *
 * `visible` drives the outer fade for desk-view / fullscreen-OS
 * transitions — the whole HUD fades out together when the user is
 * no longer looking at the room.
 */
interface Props {
  onReset: () => void;
  /** Outer visibility — fades the whole HUD in/out for desk-view transitions. */
  visible: boolean;
  /** When true (post-intro), reset + mouse-hint controls fade in. */
  interactive: boolean;
}

const HUD_PADDING = 22;
const HUD_Z = 30;
const FADE_MS = 700;

export function RoomHUD({ onReset, visible, interactive }: Props) {
  // `shown` drives the OUTER opacity (whole HUD). Initial render
  // commits at 0 so the first frame paints before the rAF tick flips
  // it to 1 — otherwise the browser may collapse both state values
  // into a single style and skip the animation.
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (visible) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
  }, [visible]);

  // Controls fade in on a delayed timer once `interactive` flips, so
  // they don't pop in at the exact instant the camera lands.
  const [controlsShown, setControlsShown] = useState(false);
  useEffect(() => {
    if (interactive) {
      const id = requestAnimationFrame(() => setControlsShown(true));
      return () => cancelAnimationFrame(id);
    }
    setControlsShown(false);
  }, [interactive]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        opacity: shown ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {/* Brand mark — always visible (including iso pre-view). */}
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
          }}
        >
          Daniel Tan
        </span>
      </div>

      {/* Controls — reset + mouse hints. Wrapped in a non-positioned
          div so the wrapper's `opacity` covers both without disturbing
          the children's absolute positioning (which still resolves to
          the outer HUD wrapper above). */}
      <div
        style={{
          opacity: controlsShown ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease`,
        }}
      >
        {/* Reset — bottom-left, glass pill matching the hint banner. */}
        <ResetButton
          onReset={onReset}
          interactive={shown && controlsShown}
        />

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
    </div>
  );
}

function ResetButton({
  onReset,
  interactive,
}: {
  onReset: () => void;
  interactive: boolean;
}) {
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
    // mouse hints stay click-through. The button gets `auto` only when
    // the HUD is fully shown — during the fade-out it shouldn't be
    // clickable just because the element is still in the DOM.
    pointerEvents: interactive ? "auto" : "none",
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
