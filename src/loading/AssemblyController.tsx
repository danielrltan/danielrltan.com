import { createContext, useContext, useEffect } from "react";
import { useAssemblyProgress } from "./useAssemblyProgress";
import type { AssemblyState } from "./types";

/**
 * Loading state context. Used to be the orchestrator for the wireframe
 * orange-print loading sequence (cover dome + assembled lines + HUD).
 * That visual is replaced by the 3D hero signature — see
 * `src/hero/HeroSignature.tsx`.
 *
 * What's left here:
 *   - `useAssemblyProgress` still tracks bytes / timeline / stable
 *     frames so other components can know when the page is "ready."
 *   - The provider toggles `html.loading-active` from `climaxDone`,
 *     same as before — CSS rules still gate the wrapper bg color,
 *     the cursor, hero chrome, body scroll, and Lenis.
 *   - `AssemblyWireframesSlot` and `AssemblyHUDSlot` are kept as
 *     no-ops so existing call sites don't error. We can clean them up
 *     once the hero refactor is fully landed.
 */

const AssemblyCtx = createContext<AssemblyState | null>(null);

export function useAssembly(): AssemblyState {
  const v = useContext(AssemblyCtx);
  if (!v) throw new Error("AssemblyContext missing — wrap with <AssemblyProvider>");
  return v;
}

export function AssemblyProvider({ children }: { children: React.ReactNode }) {
  const state = useAssemblyProgress();

  // Toggle `html.loading-active` from climaxDone. CSS uses this to
  // paint the wrapper orange, hide the custom cursor, lock body
  // scroll, and pause Lenis while the hero signature is still
  // drawing on the orange backdrop.
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

/**
 * No-op slot kept for back-compat with the existing App.tsx call site.
 * The wireframe assembly visual was removed when the hero signature
 * took over loading. Remove this and its consumer in a follow-up.
 */
export function AssemblyWireframesSlot() {
  return null;
}

/**
 * No-op slot kept for back-compat with the existing App.tsx call site.
 * The progress HUD overlay was removed when the hero signature took
 * over loading. Remove this and its consumer in a follow-up.
 */
export function AssemblyHUDSlot() {
  return null;
}
