import { useEffect, useState } from "react";
import { useProgress } from "@react-three/drei";

/**
 * Full-screen loading overlay. The static HTML `#boot-screen` in
 * index.html covers the JS-parse gap; this component takes over on
 * React mount, then fades itself out once loading completes.
 *
 * Blink: simple state-toggle via setInterval + nested setTimeout for
 * the brief closed-eyes window. One pre, one state, works every time.
 */
const FADE_AFTER_DONE_MS = 500;
const LOAD_COLOR = "#ffb077";

// Both frames padded to the same column width so text-align: center
// renders a vertically-symmetric stack.
const CAT_OPEN = ` /\\_/\\ \n( o.o )\n > ^ < `;
const CAT_CLOSED = ` /\\_/\\ \n( o.< )\n > ^ < `;

export function LoadingScreen() {
  const { progress, active } = useProgress();
  const [visible, setVisible] = useState(true);
  const [eyesOpen, setEyesOpen] = useState(true);

  // Pull the static index.html boot screen the moment React mounts.
  useEffect(() => {
    const bs = document.getElementById("boot-screen");
    if (bs && bs.parentNode) bs.parentNode.removeChild(bs);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setEyesOpen(false);
      setTimeout(() => setEyesOpen(true), 150);
    }, 1800);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!active && progress >= 100) {
      const t = setTimeout(() => setVisible(false), FADE_AFTER_DONE_MS);
      return () => clearTimeout(t);
    }
  }, [active, progress]);

  if (!visible) return null;

  const fading = !active && progress >= 100;
  const preStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 16,
    lineHeight: 1.1,
    letterSpacing: 1,
    color: LOAD_COLOR,
    textShadow: `0 0 12px ${LOAD_COLOR}33`,
    textAlign: "center",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#330a05",
        color: LOAD_COLOR,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        fontFamily:
          'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
        zIndex: 9999,
        opacity: fading ? 0 : 1,
        transition: "opacity 0.32s ease",
        pointerEvents: fading ? "none" : "auto",
      }}
    >
      <pre style={preStyle} aria-hidden>
        {eyesOpen ? CAT_OPEN : CAT_CLOSED}
      </pre>
      <div
        style={{
          fontSize: 12,
          letterSpacing: 4,
          textTransform: "uppercase",
          opacity: 0.7,
          minWidth: 90,
          textAlign: "center",
        }}
      >
        loading
      </div>
    </div>
  );
}
