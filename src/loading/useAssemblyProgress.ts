// src/loading/useAssemblyProgress.ts
import { useEffect, useRef, useState } from "react";
import {
  type AssemblyState,
  CLIMAX_DURATION_MS,
  GLB_TOTAL_MB,
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
  // The only eager asset (the 27MB room GLB) was removed, so there is nothing
  // for drei's useProgress to report during the loader window: it always read
  // progress 0 / active false, which pins bytePct to 1 and makes the loader
  // purely timeline-driven. Dropping the drei dependency here is what keeps
  // @react-three/drei (and the transitive ~1MB three chunk) OUT of the entry
  // bundle — the loader no longer forces three onto the first-paint path. Lazy
  // section GLBs load later (after the loader) on scroll approach.
  const progressRef = useRef(0);
  const activeRef = useRef(false);

  const [state, setState] = useState<AssemblyState>({
    timelinePct: 0,
    bytePct: 0,
    combinedPct: 0,
    bytesMB: 0,
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
        // Once `active` goes false the load is done; pin to 100.
        const driveByte = activeRef.current ? progressRef.current / 100 : 1;
        const bytePct = Math.max(0, Math.min(1, driveByte));
        const combinedPct = Math.min(timelinePct, bytePct);

        // Hard prerequisites: the minimum timeline elapsed AND all asset
        // bytes streamed in. These are NOT hardware-sensitive (time always
        // advances; bytes arrive over the network regardless of CPU).
        // assetsReady once the timeline floor has elapsed AND nothing is
        // actively loading. Originally this also required progress >= 100, but
        // with the 3D room (the only eager GLB) removed there is no eager asset
        // for drei to report, so progress stays 0 and `active` is false from the
        // start — meaning there is simply nothing to wait for. `progress === 0`
        // (nothing ever loaded) is therefore as "ready" as `>= 100` (everything
        // loaded); requiring only `>= 100` would trap the loader on the
        // hard-ceiling failsafe. Lazy section GLBs load later, after the loader.
        const assetsReady =
          timelinePct >= 1 &&
          !activeRef.current &&
          (progressRef.current >= 100 || progressRef.current === 0);
        if (assetsReady && assetsReadyAtRef.current == null) {
          assetsReadyAtRef.current = now;
        }

        // Smoothness gate: PREFER 30 consecutive sub-22ms frames so the
        // room reveals without jank — but bound the wait. On weak hardware
        // the always-on room canvas may never sustain 30 stable frames, so
        // after STABLE_WAIT_TIMEOUT_MS of assets-ready time we proceed
        // anyway rather than trap the visitor (the original hang: the
        // counter perpetually reset to 0 and climaxReady never fired).
        const smoothEnough =
          stableFramesRef.current >= STABLE_FRAMES_REQUIRED ||
          (assetsReadyAtRef.current != null &&
            now - assetsReadyAtRef.current >= STABLE_WAIT_TIMEOUT_MS);

        // Absolute failsafe (defense in depth): never hold the loader past
        // HARD_CEILING_MS of wall-clock loading, whatever stalls (a
        // silently-failed asset so drei.active never clears, untracked
        // physics wasm, a lost WebGL context). Last-resort backstop.
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
          setState({
            timelinePct,
            bytePct,
            combinedPct,
            bytesMB: Math.round(bytePct * GLB_TOTAL_MB * 10) / 10,
            climaxReady,
            loaderDone,
            climaxDone,
          });
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
