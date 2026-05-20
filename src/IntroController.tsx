import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface Props {
  cameraRef: RefObject<THREE.PerspectiveCamera | null>;
  roomGroupRef: RefObject<THREE.Group | null>;
  isHoveringRef: RefObject<boolean>;
  transitionStarted: boolean;
  onComplete: () => void;
}

// Float + cursor parallax disabled — the room sits flat on the new
// product-photo ground plane instead of bobbing in space.
const FLOAT_AMPLITUDE = 0;
const FLOAT_FREQ = 0;
const HOVER_LIFT = 0;

// ALL camera pose constants are exported and ARE the single source of
// truth. `App.tsx` imports them for the initial Canvas `camera` prop,
// the `onCreated` lookAt, the `OrbitControls` target, and the room
// reset pose. `DeskViewController` imports the END_* values as the
// fromDesk landing pose. Change a value here and every consumer picks
// it up — no manual syncing across files.
//
// START_* = pre-click iso preview (far back, ortho-ish FOV).
// END_*   = post-intro "canonical room view" (the pose OrbitControls
//           takes over from). END_LOOK_AT MUST match the OrbitControls
//           `target` prop or the camera snaps when control transfers.
export const START_POS = new THREE.Vector3(55, 55, 55);
// Iso projection. FOV 15° at the canonical (END) pose — wall
// verticals run effectively parallel to the viewport edge, proper
// isometric feel rather than soft perspective. Camera offsets scaled
// to keep the room framed at the same apparent size as the previous
// 14° + (16.3, 10.24, 16.3) tuning.
export const END_POS = new THREE.Vector3(15.2, 9.6, 15.2);
export const START_FOV = 5;
export const END_FOV = 15;
export const START_LOOK_AT = new THREE.Vector3(0, 0.6, 0);
export const END_LOOK_AT = new THREE.Vector3(0, 0.8, 0);

/**
 * Distance from `END_POS` to `END_LOOK_AT` — i.e. the orbit radius the
 * camera lands on at intro completion. Auto-derived from the two
 * vectors so it can never drift out of sync with them.
 */
export const END_RADIUS = END_POS.distanceTo(END_LOOK_AT);

/**
 * OrbitControls `maxDistance` — derived from `END_RADIUS` with 20%
 * headroom so users can scroll OUT a little past the canonical view
 * before hitting the cap.
 *
 * MUST be ≥ `END_RADIUS` or OrbitControls clamps the camera radius
 * inward the instant control transfers from the intro lerp / fromDesk
 * lerp → visible snap. Tying it to `END_RADIUS` here means changing
 * `END_POS` above can never re-introduce that bug.
 */
export const ORBIT_MAX_DISTANCE = END_RADIUS * 1.2;
const DURATION = 1.5;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function IntroController({
  cameraRef,
  roomGroupRef,
  isHoveringRef,
  transitionStarted,
  onComplete,
}: Props) {
  const phase = useRef<"pre" | "transition" | "done">("pre");
  const progress = useRef(0);
  const startRotX = useRef(0);
  const startRotY = useRef(0);
  const startY = useRef(0);
  const tmpLookAt = useRef(new THREE.Vector3());
  // App-level isHoveringRef is now unused — the hitbox check below
  // uses R3F's state.pointer directly.
  void isHoveringRef;

  useEffect(() => {
    if (!transitionStarted || phase.current !== "pre") return;
    phase.current = "transition";
    progress.current = 0;
    const group = roomGroupRef.current;
    if (group) {
      startRotX.current = group.rotation.x;
      startRotY.current = group.rotation.y;
      startY.current = group.position.y;
    }
  }, [transitionStarted, roomGroupRef]);

  useFrame((state, dt) => {
    const group = roomGroupRef.current;
    const camera = cameraRef.current;
    if (!group || !camera) return;

    if (phase.current === "pre") {
      // Room sits perfectly still on the ground plane. The previous
      // float + cursor-parallax + hover-lift were removed when the
      // aesthetic shifted to product-photo (room on a plane, not
      // floating in space).
      group.rotation.set(0, 0, 0);
      group.position.set(0, 0, 0);
      return;
    }

    if (phase.current === "transition") {
      progress.current = Math.min(progress.current + dt / DURATION, 1);
      const t = easeOutCubic(progress.current);

      group.rotation.x = startRotX.current * (1 - t);
      group.rotation.y = startRotY.current * (1 - t);
      group.rotation.z = 0;
      group.position.y = startY.current * (1 - t);

      camera.position.lerpVectors(START_POS, END_POS, t);
      camera.fov = THREE.MathUtils.lerp(START_FOV, END_FOV, t);
      camera.updateProjectionMatrix();

      tmpLookAt.current.lerpVectors(START_LOOK_AT, END_LOOK_AT, t);
      camera.lookAt(tmpLookAt.current);

      if (progress.current >= 1) {
        phase.current = "done";
        group.rotation.set(0, 0, 0);
        group.position.set(0, 0, 0);
        camera.position.copy(END_POS);
        camera.fov = END_FOV;
        camera.updateProjectionMatrix();
        camera.lookAt(END_LOOK_AT);
        onComplete();
      }
    }
  });

  return null;
}
