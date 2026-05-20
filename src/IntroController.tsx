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

const FLOAT_AMPLITUDE = 0.07;
const FLOAT_FREQ = 0.8;
const HOVER_LIFT = 0.14;

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
// Iso crank, round two. FOV 20° → 14°, camera offsets scaled ≈1.43×
// further from look-at so the room still frames at the same apparent
// size. Wall verticals now run effectively parallel to the viewport
// edge — proper isometric feel rather than soft perspective.
export const END_POS = new THREE.Vector3(16.3, 10.24, 16.3);
export const START_FOV = 5;
export const END_FOV = 14;
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
      const elapsed = state.clock.elapsedTime;
      const floatY = Math.sin(elapsed * FLOAT_FREQ) * FLOAT_AMPLITUDE;

      // Simple centred hitbox in normalized screen coords. Raycast
      // against the room mesh worked in theory but the room is a
      // collection of dozens of sub-meshes — the per-frame hit /
      // miss flickered when the cursor grazed silhouette edges,
      // making the lift spasm. A static square is rock-solid.
      const HITBOX_HALF = 0.65; // ±0.65 of normalized viewport (1.7× the old 0.38)
      const inHitbox =
        Math.abs(state.pointer.x) < HITBOX_HALF &&
        Math.abs(state.pointer.y) < HITBOX_HALF;
      const hoverLift = inHitbox ? HOVER_LIFT : 0;

      // pointer.x: -1 (left) to +1 (right)
      // pointer.y: -1 (bottom) to +1 (top)
      // Cursor RIGHT  → room turns right (negative Y).
      // Cursor UP     → room tilts back  (negative X).
      group.rotation.y += (state.pointer.x * 0.10 - group.rotation.y) * 0.08;
      group.rotation.x += (-state.pointer.y * 0.07 - group.rotation.x) * 0.08;
      group.rotation.z = 0;

      group.position.y += (floatY + hoverLift - group.position.y) * 0.1;
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
