import { useState, type CSSProperties, type ReactNode } from "react";

interface Props {
  /** CSS grid placement string, e.g. "span 5 / span 3" or `1 / 6`. */
  col?: string;
  row?: string;
  children: ReactNode;
  /** If set, card is "filled" with the accent color (used for Resume button). */
  filled?: boolean;
  /** Click handler — if set, card responds to hover with a tiny scale. */
  onClick?: () => void;
  /** Allow content overflow (used for marquee). */
  noOverflowClip?: boolean;
  /** Extra inline style override (used sparingly). */
  style?: CSSProperties;
  /** Accessible label when interactive. */
  ariaLabel?: string;
}

/**
 * Card primitive — every widget sits inside one. Dark surface by default,
 * accent-filled when `filled`. The page's warm/cool `--bg` shows through
 * the gap between cards (handled by the parent grid).
 */
export function Card({
  col,
  row,
  children,
  filled,
  onClick,
  noOverflowClip,
  style,
  ariaLabel,
}: Props) {
  const [hover, setHover] = useState(false);
  const interactive = !!onClick;
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      role={interactive ? "button" : undefined}
      aria-label={ariaLabel}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
      style={{
        gridColumn: col,
        gridRow: row,
        // Fill any explicit height set on the parent wrapper so widgets
        // honor their reserved slots in the desktop layout.
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        background: filled ? "var(--accent)" : "var(--surface)",
        color: filled ? "var(--text-dk)" : "var(--text-lt)",
        borderRadius: 10,
        padding: 18,
        position: "relative",
        overflow: noOverflowClip ? "visible" : "hidden",
        cursor: interactive ? "pointer" : "default",
        transform: interactive && hover ? "scale(1.005)" : "scale(1)",
        transition: "transform 0.15s ease, background-color 0.15s ease",
        outline: "none",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/**
 * Tiny eyebrow label used inside cards. Uppercase, tracked, muted, mono.
 */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}
