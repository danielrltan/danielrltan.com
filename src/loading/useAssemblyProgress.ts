// src/loading/useAssemblyProgress.ts
import { useEffect, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";
import {
  type AssemblyState,
  CLIMAX_DURATION_MS,
  GLB_TOTAL_MB,
  PHASE_THRESHOLDS,
  POST_CLIMAX_HUD_FADE_MS,
  STABLE_FRAMES_REQUIRED,
  STABLE_FRAME_BUDGET_MS,
  TIMELINE_FLOOR_MS,
} from "./types";

const STATE_UPDATE_INTERVAL_MS = 100;

function derivePhase(combinedPct: number): number {
  for (let i = PHASE_THRESHOLDS.length - 1; i >= 0; i--) {
    if (combinedPct >= PHASE_THRESHOLDS[i]!) return i + 1;
  }
  return 1;
}

export function useAssemblyProgress(): AssemblyState {
  const { progress, active } = useProgress();

  // Mirror drei values into refs so the RAF loop reads fresh values
  // without re-subscribing on every render.
  const progressRef = useRef(progress);
  const activeRef = useRef(active);
  progressRef.current = progress;
  activeRef.current = active;

  const [state, setState] = useState<AssemblyState>({
    timelinePct: 0,
    bytePct: 0,
    combinedPct: 0,
    phase: 1,
    bytesMB: 0,
    climaxReady: false,
    climaxDone: false,
  });

  const startRef = useRef(performance.now());
  const pausedAtRef = useRef<number | null>(null);
  const pausedTotalRef = useRef(0);
  const stableFramesRef = useRef(0);
  const lastFrameRef = useRef(performance.now());
  const lastEmitRef = useRef(0);
  const lastPhaseRef = useRef(1);
  const lastClimaxReadyRef = useRef(false);
  const lastClimaxDoneRef = useRef(false);
  const climaxStartRef = useRef<number | null>(null);

  // Pause timeline while tab is hidden. Bytes keep accumulating in
  // the background fetch; only the choreography pauses.
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
        const timelinePct = Math.min(1, elapsed / TIMELINE_FLOOR_MS);

        // While drei is loading, progress is the bytes percentage.
        // Once `active` goes false the load is done — pin to 100.
        const driveByte = activeRef.current ? progressRef.current / 100 : 1;
        const bytePct = Math.max(0, Math.min(1, driveByte));
        const combinedPct = Math.min(timelinePct, bytePct);
        const phase = derivePhase(combinedPct);

        const climaxReady =
          timelinePct >= 1 &&
          !activeRef.current &&
          progressRef.current >= 100 &&
          stableFramesRef.current >= STABLE_FRAMES_REQUIRED;

        if (climaxReady && climaxStartRef.current == null) {
          climaxStartRef.current = now;
        }
        const climaxDone =
          climaxStartRef.current != null &&
          now - climaxStartRef.current >=
            CLIMAX_DURATION_MS + POST_CLIMAX_HUD_FADE_MS;

        const shouldEmit =
          now - lastEmitRef.current >= STATE_UPDATE_INTERVAL_MS ||
          phase !== lastPhaseRef.current ||
          (climaxReady && !lastClimaxReadyRef.current) ||
          (climaxDone && !lastClimaxDoneRef.current);

        if (shouldEmit) {
          lastEmitRef.current = now;
          lastPhaseRef.current = phase;
          lastClimaxReadyRef.current = climaxReady;
          lastClimaxDoneRef.current = climaxDone;
          setState({
            timelinePct,
            bytePct,
            combinedPct,
            phase,
            bytesMB: Math.round(bytePct * GLB_TOTAL_MB * 10) / 10,
            climaxReady,
            climaxDone,
          });
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // State is intentionally not in deps — using refs to avoid resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
