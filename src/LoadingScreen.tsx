import { useEffect, useState } from "react";
import { useProgress } from "@react-three/drei";

/**
 * Full-screen loading overlay. The static HTML `#boot-screen` in
 * index.html covers the JS-parse gap; this component takes over on
 * React mount, then fades itself out once loading completes.
 *
 * Visual: an ASCII cat that blinks. The blink is driven by CSS
 * keyframes (compositor thread) so it keeps ticking even while
 * the main thread is busy parsing JS / decoding the GLB. JS-driven
 * setTimeout was starved during the GLB decode → blink didn't fire
 * until the heavy work was done.
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

  // Pull the static index.html boot screen the moment React mounts.
  useEffect(() => {
    const bs = document.getElementById("boot-screen");
    if (bs && bs.parentNode) bs.parentNode.removeChild(bs);
  }, []);

  useEffect(() => {
    if (!active && progress >= 100) {
      const t = setTimeout(() => setVisible(false), FADE_AFTER_DONE_MS);
      return () => clearTimeout(t);
    }
  }, [active, progress]);

  if (!visible) return null;

  const fading = !active && progress >= 100;

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
      <style>{`
        /* Two stacked <pre>s; one shows open eyes, one shows closed.
           Their opacity keyframes are inverses, so they crossfade in
           sync — eyes open for ~92% of the cycle, briefly closed for
           ~8% (read as a quick blink). Animations run on the
           compositor thread, so they're immune to main-thread stalls
           (the whole reason this loader exists). */
        @keyframes ls-cat-open {
          0%, 90% { opacity: 1; }
          93%, 97% { opacity: 0; }
          100% { opacity: 1; }
        }
        @keyframes ls-cat-closed {
          0%, 90% { opacity: 0; }
          93%, 97% { opacity: 1; }
          100% { opacity: 0; }
        }
        .ls-cat {
          position: relative;
          display: inline-block;
        }
        .ls-cat pre {
          margin: 0;
          font-size: 16px;
          line-height: 1.1;
          letter-spacing: 1px;
          color: ${LOAD_COLOR};
          text-shadow: 0 0 12px ${LOAD_COLOR}33;
          text-align: center;
          will-change: opacity;
        }
        /* Stack: closed sits on top of open (absolute), both same box. */
        .ls-cat-open {
          animation: ls-cat-open 1.6s linear infinite;
        }
        .ls-cat-closed {
          position: absolute;
          inset: 0;
          animation: ls-cat-closed 1.6s linear infinite;
        }
      `}</style>
      <div className="ls-cat" aria-hidden>
        <pre className="ls-cat-open">{CAT_OPEN}</pre>
        <pre className="ls-cat-closed">{CAT_CLOSED}</pre>
      </div>
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
