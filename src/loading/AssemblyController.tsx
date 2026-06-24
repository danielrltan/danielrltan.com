import { createContext, useContext, useEffect } from "react";
import { useAssemblyProgress } from "./useAssemblyProgress";
import {
  type AssemblyState,
  POST_REVEAL_HOLD_MS,
  UNLOCK_FAILSAFE_MS,
} from "./types";

/**
 * Loading state context. Tracks bytes / timeline / stable frames via
 * `useAssemblyProgress`, and toggles `html.loading-active` from
 * `climaxDone`. CSS uses that class to paint the wrapper orange, hide
 * the custom cursor, lock body scroll, and pause Lenis while the hero
 * signature is still drawing on the orange backdrop.
 */

const AssemblyCtx = createContext<AssemblyState | null>(null);

export function useAssembly(): AssemblyState {
  const v = useContext(AssemblyCtx);
  if (!v) throw new Error("AssemblyContext missing: wrap with <AssemblyProvider>");
  return v;
}

export function AssemblyProvider({ children }: { children: React.ReactNode }) {
  const state = useAssemblyProgress();

  // The orange loading scrim (html.loading-active, added synchronously in
  // main.tsx BEFORE React mounts) stays up — and scroll stays LOCKED — through
  // the WHOLE opening beat: loader fill → "100" hold → the hero composing behind
  // the scrim → the scrim fading out to reveal it. The BootLoader fires
  // `loader-revealed` once that fade has run; THAT is the unlock. (Owner: the
  // user should only be able to scroll once the website has finished fading in.)
  //
  // Unlocking earlier (on `hero-composed`, while the loader is still fading)
  // would let the user scroll mid-fade-in — which is exactly what we don't want.
  //
  // Even once the fade is done we hold the lock a further POST_REVEAL_HOLD_MS so
  // the hero can be SEEN and processed for a beat before scroll engages, rather
  // than the user being "launched abruptly" the instant the loader clears.
  useEffect(() => {
    let t = 0;
    const unlock = () => {
      t = window.setTimeout(() => {
        document.documentElement.classList.remove("loading-active");
      }, POST_REVEAL_HOLD_MS);
    };
    window.addEventListener("loader-revealed", unlock);
    // Cleanup drops the listener + the pending timer — NOT the class. Removing
    // the class here would lift the scrim during React StrictMode's dev
    // mount→unmount→mount cycle (main.tsx adds it once and never re-adds).
    return () => {
      window.removeEventListener("loader-revealed", unlock);
      if (t) window.clearTimeout(t);
    };
  }, []);

  // Failsafe: never trap a visitor behind the scrim. If the compose signal
  // never arrives (an unforeseen stall once the loader is done), lift it
  // UNLOCK_FAILSAFE_MS after the loader completes. climaxReady is bounded by
  // HARD_CEILING_MS, so this fires even if assets silently fail to load.
  useEffect(() => {
    if (!state.climaxReady) return;
    const t = window.setTimeout(() => {
      document.documentElement.classList.remove("loading-active");
    }, UNLOCK_FAILSAFE_MS);
    return () => window.clearTimeout(t);
  }, [state.climaxReady]);

  // Remove the static #boot-screen the moment React mounts.
  useEffect(() => {
    const bs = document.getElementById("boot-screen");
    if (bs && bs.parentNode) bs.parentNode.removeChild(bs);
  }, []);

  return <AssemblyCtx.Provider value={state}>{children}</AssemblyCtx.Provider>;
}
