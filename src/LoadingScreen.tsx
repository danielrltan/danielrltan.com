import { useEffect, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";

/**
 * Full-screen loading overlay shown while the room GLB (and any other
 * drei-loaded asset) fetches. The static HTML `#boot-screen` in
 * index.html covers the JS-parse gap; this component takes over on
 * React mount, then fades itself out once loading completes.
 *
 * Bar animation strategy: `useProgress` from drei reports per-FILE
 * completion, which with our single 11 MB room.glb means it sits at 0%
 * for the whole download then snaps to 100%. We display a *smoothed*
 * value that creeps forward on a fake timer toward 90%, then snaps to
 * 100 when the real load finishes. This keeps the bar visibly moving
 * during the long single-file fetch.
 */
const FAKE_DURATION_MS = 8000; // expected room.glb load time on a typical home connection
const FAKE_MAX = 90; // cap the fake bar here — the snap to 100 reads as "done"

export function LoadingScreen() {
  const { progress, active } = useProgress();
  const [visible, setVisible] = useState(true);
  const [displayed, setDisplayed] = useState(0);
  const startRef = useRef<number>(performance.now());

  // Yank the static index.html boot screen as soon as React renders —
  // we own the loading visual from here on.
  useEffect(() => {
    const bs = document.getElementById("boot-screen");
    if (bs && bs.parentNode) bs.parentNode.removeChild(bs);
  }, []);

  // Drive the displayed bar with rAF. Target is whichever is higher:
  // the real `progress` from drei, or a fake time-based progress that
  // creeps to FAKE_MAX over FAKE_DURATION_MS. When real progress hits
  // 100 we let the bar animate to 100 and stop.
  useEffect(() => {
    let raf = 0;
    let done = false;
    const tick = () => {
      const elapsed = performance.now() - startRef.current;
      const fake = Math.min(
        FAKE_MAX,
        (elapsed / FAKE_DURATION_MS) * FAKE_MAX,
      );
      const target = Math.max(progress, fake, progress >= 100 ? 100 : 0);
      setDisplayed((d) => {
        const next = d + (target - d) * 0.08;
        // Stop the rAF once we've effectively reached 100 — keeps the
        // bar from idling forever in the background after fade-out.
        if (progress >= 100 && next > 99.7) {
          done = true;
          return 100;
        }
        return next;
      });
      if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [progress]);

  // Hide once loading finishes. Small delay so the bar visibly settles
  // at 100 before the whole overlay fades.
  useEffect(() => {
    if (!active && progress >= 100) {
      const t = setTimeout(() => setVisible(false), 500);
      return () => clearTimeout(t);
    }
  }, [active, progress]);

  if (!visible) return null;

  const fading = !active && progress >= 100 && displayed > 99;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#330a05",
        color: "#ffb077",
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
      <div
        style={{
          fontSize: 12,
          letterSpacing: 4,
          textTransform: "uppercase",
          opacity: 0.7,
        }}
      >
        loading
      </div>
      <div
        style={{
          width: 180,
          height: 2,
          background: "rgba(255, 176, 119, 0.18)",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${displayed}%`,
            background: "#ffb077",
          }}
        />
      </div>
      <div
        style={{
          fontSize: 10,
          letterSpacing: 2,
          opacity: 0.5,
        }}
      >
        {Math.floor(displayed)}%
      </div>
    </div>
  );
}
