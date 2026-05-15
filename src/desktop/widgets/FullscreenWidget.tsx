import { useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

interface Props {
  /** True when the OS is in fullscreen overlay mode (not seated at desk). */
  isFullscreen: boolean;
  /** Enter fullscreen (camera dolly into the monitor). */
  onToggleFullscreen: () => void;
  /** Bypass desk view and go all the way back to the room — used when
   *  the primary action is "exit" (i.e. user is already fullscreen). */
  onBackToRoom: () => void;
}

/**
 * Compact icon-only fullscreen / exit button. Sits in the top-right
 * of the desktop where it stays glanceable on the tiny monitor-mounted
 * OS too. The button text was removed (the user explicitly asked for
 * symbol only) and the secondary "room" link is gone — primary action
 * already routes to the room when isFullscreen=true.
 */
export function FullscreenWidget({
  isFullscreen,
  onToggleFullscreen,
  onBackToRoom,
}: Props) {
  const [hover, setHover] = useState(false);
  const Icon = isFullscreen ? Minimize2 : Maximize2;
  return (
    <button
      onClick={isFullscreen ? onBackToRoom : onToggleFullscreen}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-label={isFullscreen ? "exit fullscreen" : "fullscreen"}
      title={isFullscreen ? "exit" : "fullscreen"}
      style={{
        width: 56,
        height: 56,
        borderRadius: 12,
        border: "1px solid var(--surface-alt)",
        background: hover ? "var(--accent)" : "var(--surface)",
        color: hover ? "var(--text-dk)" : "var(--text-lt)",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        transition:
          "background-color 0.18s ease, color 0.18s ease, transform 0.12s ease, border-color 0.18s ease",
        transform: hover ? "scale(1.04)" : "scale(1)",
        boxShadow: "0 4px 14px rgba(0,0,0,0.2)",
        padding: 0,
      }}
    >
      <Icon size={26} strokeWidth={2.2} />
    </button>
  );
}
