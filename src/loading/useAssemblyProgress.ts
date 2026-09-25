// src/loading/useAssemblyProgress.ts
import { useEffect, useRef, useState } from "react";
import {
  type AssemblyState,
  CLIMAX_DURATION_MS,
  HARD_CEILING_MS,
  LOADER_OUTRO_MS,
  POST_CLIMAX_HUD_FADE_MS,
  STABLE_FRAMES_REQUIRED,
  STABLE_FRAME_BUDGET_MS,
  STABLE_WAIT_TIMEOUT_MS,
  TIMELINE_FLOOR_MS,
} from "./types";

const STATE_UPDATE_INTERVAL_MS = 100;

export function useAssemblyProgress(): AssemblyState {
  // The loader is purely timeline-driven: there is no eager asset to track
  // (the section GLBs load lazily on scroll approach, after the loader), and
  // keeping @react-three/drei's useProgress out of here is what keeps drei and
  // the ~1MB three chunk OUT of the entry bundle.
  const [state, setState] = useState<AssemblyState>({
    combinedPct: 0,
    climaxReady: false,
    loaderDone: false,
    climaxDone: false,
  });

  const startRef = useRef(performance.now());
  const pausedAtRef = useRef<number | null>(null);
  const pausedTotalRef = useRef(0);
  const stableFramesRef = useRef(0);
  const lastFrameRef = useRef(performance.now());
  const lastEmitRef = useRef(0);
  const lastClimaxReadyRef = useRef(false);
  const lastLoaderDoneRef = useRef(false);
  const lastClimaxDoneRef = useRef(false);
  const climaxStartRef = useRef<number | null>(null);
  // Wall-clock (performance.now) at which the hard prerequisites (timeline
  // + assets) first became true. Used to bound the wait for smooth frames
  // so weak hardware can't be trapped on the loading screen forever.
  const assetsReadyAtRef = useRef<number | null>(null);

  // Pause the timeline while the tab is hidden.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        pausedAtRef.current = performance.now();
      } else if (pausedAtRef.current != null) {
        pausedTotalRef.current += performance.now() - pausedAtRef.current;
        pausedAtRef.current = null;
        lastFrameRef.current = performance.now();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const paused = pausedAtRef.current != null;

      const dt = now - lastFrameRef.current;
      lastFrameRef.current = now;
      if (!paused) {
        if (dt < STABLE_FRAME_BUDGET_MS) stableFramesRef.current++;
        else stableFramesRef.current = 0;
      }

      if (!paused) {
        const elapsed = now - startRef.current - pausedTotalRef.current;
        const combinedPct = Math.min(1, elapsed / TIMELINE_FLOOR_MS);

        // Hard prerequisite: the minimum timeline elapsed. Not
        // hardware-sensitive (time always advances).
        const assetsReady = combinedPct >= 1;
        if (assetsReady && assetsReadyAtRef.current == null) {
          assetsReadyAtRef.current = now;
        }

        // Smoothness gate: PREFER a streak of sub-22ms frames so the hero
        // reveals without jank — but bound the wait. On weak hardware the
        // streak may never come, so after STABLE_WAIT_TIMEOUT_MS of
        // timeline-done time we proceed anyway rather than trap the visitor
        // (the original hang: the counter perpetually reset to 0 and
        // climaxReady never fired).
        const smoothEnough =
          stableFramesRef.current >= STABLE_FRAMES_REQUIRED ||
          (assetsReadyAtRef.current != null &&
            now - assetsReadyAtRef.current >= STABLE_WAIT_TIMEOUT_MS);

        // Absolute failsafe (defense in depth): never hold the loader past
        // HARD_CEILING_MS of wall-clock loading, whatever stalls.
        const hardCeiling = elapsed >= HARD_CEILING_MS;

        const climaxReady = (assetsReady && smoothEnough) || hardCeiling;

        if (climaxReady && climaxStartRef.current == null) {
          climaxStartRef.current = now;
        }
        // loaderDone: the loader has hit 100% AND its outro window has
        // elapsed. This is the gate that releases the hero signature to
        // start drawing — the loader and the signature now run in
        // sequence, not concurrently.
        const loaderDone =
          climaxStartRef.current != null &&
          now - climaxStartRef.current >= LOADER_OUTRO_MS;
        const climaxDone =
          climaxStartRef.current != null &&
          now - climaxStartRef.current >=
            CLIMAX_DURATION_MS + POST_CLIMAX_HUD_FADE_MS;

        const shouldEmit =
          now - lastEmitRef.current >= STATE_UPDATE_INTERVAL_MS ||
          (climaxReady && !lastClimaxReadyRef.current) ||
          (loaderDone && !lastLoaderDoneRef.current) ||
          (climaxDone && !lastClimaxDoneRef.current);

        if (shouldEmit) {
          lastEmitRef.current = now;
          lastClimaxReadyRef.current = climaxReady;
          lastLoaderDoneRef.current = loaderDone;
          lastClimaxDoneRef.current = climaxDone;
          setState({ combinedPct, climaxReady, loaderDone, climaxDone });
        }

        // Terminal early-out: once climaxDone is committed the loading
        // choreography is complete and all computed values are stable.
        // Allow this final tick to flush the terminal state, then stop.
        // OLD: unconditional reschedule every frame indefinitely.
        // NEW: O(0) rAF cost post-climax; loop runs only for loading duration.
        if (climaxDone) return;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // State is intentionally not in deps; using refs to avoid resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
