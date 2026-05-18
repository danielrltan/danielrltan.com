import { useId } from "react";

/**
 * Hand-drawn mouse icon. The `highlight` prop fills one zone of the
 * mouse — left button (rotate), right button (pan), or scroll wheel
 * (zoom). Body shape is a pill clipped against a rounded-rect mask so
 * highlight rectangles never spill past the silhouette.
 *
 * Stroke + highlight both use `currentColor` so the icon inherits the
 * surrounding text color and stays in palette without any prop work.
 */
type Highlight = "left" | "right" | "scroll";

interface Props {
  highlight: Highlight;
  size?: number;
  strokeWidth?: number;
}

export function MouseIcon({ highlight, size = 24, strokeWidth = 1.5 }: Props) {
  const reactId = useId();
  const clipId = `mouse-clip-${reactId.replace(/:/g, "")}`;

  return (
    <svg
      width={size}
      height={(size * 32) / 24}
      viewBox="0 0 24 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="3" y="2" width="18" height="28" rx="9" />
        </clipPath>
      </defs>

      {/* Highlight fills (clipped to body silhouette so they round the corners) */}
      <g clipPath={`url(#${clipId})`} stroke="none">
        {highlight === "left" && (
          <rect
            x="3"
            y="2"
            width="9"
            height="11"
            fill="currentColor"
            opacity="0.75"
          />
        )}
        {highlight === "right" && (
          <rect
            x="12"
            y="2"
            width="9"
            height="11"
            fill="currentColor"
            opacity="0.75"
          />
        )}
        {highlight === "scroll" && (
          <rect
            x="10.5"
            y="5"
            width="3"
            height="5.5"
            rx="1.5"
            fill="currentColor"
          />
        )}
      </g>

      {/* Body outline */}
      <rect x="3" y="2" width="18" height="28" rx="9" />
      {/* Horizontal divider between buttons and palm rest */}
      <line x1="3.5" y1="13" x2="20.5" y2="13" />
      {/* Vertical divider between left and right buttons */}
      <line x1="12" y1="2" x2="12" y2="13" />
      {/* Scroll wheel outline (always present, filled when highlighted) */}
      {highlight !== "scroll" && (
        <rect x="10.5" y="5" width="3" height="5.5" rx="1.5" />
      )}
    </svg>
  );
}
