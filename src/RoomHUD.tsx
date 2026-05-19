import { useEffect, useState, type CSSProperties } from "react";
import { RotateCcw } from "lucide-react";
import { BlinkingCat } from "./BlinkingCat";

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
            // Walnut on cream now that the wrapper is light. The cat
            // mark (BlinkingCat) is still amber — the colour split here
            // is intentional: mark = signature accent, wordmark =
            // legible identity.
            color: "var(--wrapper-ink)",
            fontFamily: "var(--font-display)",
            fontSize: 24,
            fontWeight: 400,
            letterSpacing: "-0.06em",
          }}
        >
          Daniel Tan
        </span>
      </div>

      {/* Reset — bottom-left. The mouse hints that used to sit
          bottom-right were dropped: the page is scroll-driven now, so
          rotate / pan / zoom no longer describe the primary interaction
          model. Reset still applies (throwable / draggable objects). */}
      <div
        style={{
          opacity: controlsShown ? 1 : 0,
          transition: `opacity ${FADE_MS}ms ease`,
        }}
      >
        <ResetButton
          onReset={onReset}
          interactive={shown && controlsShown}
        />
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
    // Light wrapper now — pill reads as walnut-ink on translucent cream
    // instead of cream-on-walnut. Border + hover use the orange accent.
    background: "rgba(255, 255, 255, 0.55)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    border: "1px solid rgba(26, 23, 20, 0.12)",
    borderRadius: 999,
    color: "var(--wrapper-ink)",
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
        e.currentTarget.style.background = "rgba(232, 112, 64, 0.12)";
        e.currentTarget.style.borderColor = "rgba(232, 112, 64, 0.55)";
        e.currentTarget.style.color = "var(--accent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255, 255, 255, 0.55)";
        e.currentTarget.style.borderColor = "rgba(26, 23, 20, 0.12)";
        e.currentTarget.style.color = "var(--wrapper-ink)";
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

