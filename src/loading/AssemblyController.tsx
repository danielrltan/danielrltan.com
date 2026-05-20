// src/loading/AssemblyController.tsx
import { createContext, useContext, useEffect } from "react";
import { AssemblyHUD } from "./AssemblyHUD";
import { useAssemblyProgress } from "./useAssemblyProgress";
import { WireframeRoom } from "./WireframeRoom";
import type { AssemblyState } from "./types";

const AssemblyCtx = createContext<AssemblyState | null>(null);

function useAssembly(): AssemblyState {
  const v = useContext(AssemblyCtx);
  if (!v) throw new Error("AssemblyContext missing — wrap with <AssemblyProvider>");
  return v;
}

/**
 * Wraps the app with a single source of truth for assembly state.
 * `AssemblyHUDSlot` and `AssemblyWireframesSlot` consume from it.
 *
 * Place this around BOTH the Canvas and the HUD overlay in App.
 */
export function AssemblyProvider({ children }: { children: React.ReactNode }) {
  const state = useAssemblyProgress();

  // Toggle a loading-active class on <html> that lets CSS hide the
  // custom cursor, hide the hero scroll hint, and swap chrome text
  // to white (so it reads against the orange cover dome).
  //
  // Trigger: climaxDone (cover dome opacity reaches 0 and the
  // wireframes have unmounted) — NOT climaxReady, which fires the
  // moment the fade starts. Switching too early causes the
  // wordmark / eyebrow colour to flip back to walnut while the
  // orange backdrop is still visible.
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

  // Remove the static #boot-screen the moment React mounts (same as
  // old LoadingScreen behavior).
  useEffect(() => {
    const bs = document.getElementById("boot-screen");
    if (bs && bs.parentNode) bs.parentNode.removeChild(bs);
  }, []);

  return <AssemblyCtx.Provider value={state}>{children}</AssemblyCtx.Provider>;
}

/**
 * R3F-side slot — mounts inside the Canvas, as a sibling of the
 * `<Suspense fallback={null}>` that gates the real room. Renders
 * nothing once the climax has fully completed.
 */
export function AssemblyWireframesSlot() {
  const state = useAssembly();
  if (state.climaxDone) return null;
  return <WireframeRoom state={state} />;
}

/**
 * DOM-side slot — mounts outside the Canvas. Renders nothing once
 * the climax fade has completed.
 */
export function AssemblyHUDSlot() {
  const state = useAssembly();
  if (state.climaxDone) return null;
  return <AssemblyHUD state={state} />;
}
