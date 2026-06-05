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

/**
 * Single source of truth for the canonical room camera pose. App.tsx
 * imports these for the Canvas `camera` prop, the onCreated lookAt,
 * and the OrbitControls target. END_LOOK_AT MUST match the
 * OrbitControls `target` or the camera snaps when control transfers.
 *
 * (50, 50, 50): equal X=Y=Z keeps the iso angle correct. FOV is kept
 * narrow (5°) so the projection stays near-orthographic. Pulling the
 * camera CLOSER (vs widening FOV) preserves the parallel-line iso look.
 */
export const END_POS = new THREE.Vector3(50, 50, 50);
export const END_FOV = 5;
export const END_LOOK_AT = new THREE.Vector3(0, 0.8, 0);

/**
 * OrbitControls `maxDistance`. MUST be ≥ distance(END_POS,
 * END_LOOK_AT) or OrbitControls clamps the camera radius inward the
 * instant control transfers from the intro lerp → visible snap. Tying
 * it to the canonical pose here means changing END_POS can never
 * re-introduce that bug.
 */
export const ORBIT_MAX_DISTANCE = END_POS.distanceTo(END_LOOK_AT) * 1.2;

/**
 * The 1.5s camera dolly intro was removed (user feedback: unnecessary).
 * Camera now starts at END pose. This controller fires the onComplete
 * signal on the first frame after transitionStarted so downstream code
 * (OrbitControls enable, ScrollCamera mount) still receives it, and
 * keeps the room group locked at origin.
 */
export function IntroController({
  cameraRef,
  roomGroupRef,
  isHoveringRef,
  transitionStarted,
  onComplete,
}: Props) {
  const phase = useRef<"pre" | "done">("pre");
  void cameraRef;
  void isHoveringRef;

  useEffect(() => {
    if (!transitionStarted || phase.current !== "pre") return;
    phase.current = "done";
    onComplete();
  }, [transitionStarted, onComplete]);

  useFrame(() => {
    const group = roomGroupRef.current;
    if (!group) return;
    group.rotation.set(0, 0, 0);
    group.position.set(0, 0, 0);
  });

  return null;
}
