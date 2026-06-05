import { createContext, useContext, useEffect } from "react";
import { useAssemblyProgress } from "./useAssemblyProgress";
import type { AssemblyState } from "./types";

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

  useEffect(() => {
    if (state.climaxDone) {
      document.documentElement.classList.remove("loading-active");
    } else {
      document.documentElement.classList.add("loading-active");
    }
    return () => {
      document.documentElement.classList.remove("loading-active");
    };
  }, [state.climaxDone]);

  // Remove the static #boot-screen the moment React mounts.
  useEffect(() => {
    const bs = document.getElementById("boot-screen");
    if (bs && bs.parentNode) bs.parentNode.removeChild(bs);
  }, []);

  return <AssemblyCtx.Provider value={state}>{children}</AssemblyCtx.Provider>;
}
