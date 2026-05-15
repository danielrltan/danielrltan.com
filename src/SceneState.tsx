import {
  createContext,
  useContext,
  type ReactNode,
  type RefObject,
} from "react";

interface SceneStateValue {
  /**
   * Becomes true after the intro click-transition finishes. Pointer handlers
   * in DraggableRigidBody / Drawer must check this ref each event and bail
   * if not ready.
   */
  sceneReadyRef: RefObject<boolean>;
  /**
   * True once the camera has fully settled into desk view (after the toDesk
   * lerp completes). Interaction and OrbitControls are blocked while this
   * is set; flips back to false at the start of the fromDesk lerp.
   */
  deskViewActiveRef: RefObject<boolean>;
  /**
   * React-state mirror of `deskViewActiveRef`. The ref doesn't trigger
   * re-renders, so anything that needs to mount / unmount with desk view
   * (e.g. the on-monitor DesktopOS) subscribes via this setter instead.
   */
  setDeskViewActive?: (v: boolean) => void;
  /** Drive the custom cursor when hovering draggable / drawer meshes. */
  setMoveableHover: (hover: boolean) => void;
  /** Animate camera to the seated-at-desk view (no-op until DeskViewController mounts). */
  startDeskView: () => void;
}

const SceneStateContext = createContext<SceneStateValue | null>(null);

const noopHover = () => {};
const noopDesk = () => {};

export function SceneStateProvider({
  value,
  children,
}: {
  value: SceneStateValue;
  children: ReactNode;
}) {
  return (
    <SceneStateContext.Provider value={value}>
      {children}
    </SceneStateContext.Provider>
  );
}

/**
 * Returns a ref whose `.current` is true once the intro is complete.
 * Returns `undefined` outside a provider — callers should treat that as
 * "not ready" (no provider = pre-mount, gating still appropriate).
 */
export function useSceneReadyRef(): RefObject<boolean> | undefined {
  return useContext(SceneStateContext)?.sceneReadyRef;
}

export function useSetMoveableHover(): (hover: boolean) => void {
  return useContext(SceneStateContext)?.setMoveableHover ?? noopHover;
}

export function useStartDeskView(): () => void {
  return useContext(SceneStateContext)?.startDeskView ?? noopDesk;
}

/**
 * Returns a ref whose `.current` is true while seated at the desk. Pointer
 * handlers / OrbitControls / hover effects should bail when this is set.
 */
export function useDeskViewActiveRef(): RefObject<boolean> | undefined {
  return useContext(SceneStateContext)?.deskViewActiveRef;
}

const noopSetDesk = (_v: boolean) => {};
/**
 * React-state setter for desk-view transitions. Called by DeskViewController
 * when the toDesk / fromDesk lerp finishes. Anything that needs to *render*
 * differently when seated (vs anything that just *reads* state in event
 * handlers) should subscribe via this so it actually re-renders.
 */
export function useSetDeskViewActive(): (v: boolean) => void {
  return useContext(SceneStateContext)?.setDeskViewActive ?? noopSetDesk;
}
