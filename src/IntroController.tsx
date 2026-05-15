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

const START_POS = new THREE.Vector3(25, 25, 25);
const END_POS = new THREE.Vector3(3.5, 2.5, 3.5);
const START_FOV = 11;
const END_FOV = 50;
const START_LOOK_AT = new THREE.Vector3(0, 0.6, 0);
const END_LOOK_AT = new THREE.Vector3(0, 0.8, 0);
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
      const HITBOX_HALF = 0.38; // ±0.38 of normalized viewport
      const inHitbox =
        Math.abs(state.pointer.x) < HITBOX_HALF &&
        Math.abs(state.pointer.y) < HITBOX_HALF;
      const hoverLift = inHitbox ? HOVER_LIFT : 0;

      // pointer.x: -1 (left) to +1 (right)
      // pointer.y: -1 (bottom) to +1 (top)
      // Cursor RIGHT  → room turns right (negative Y).
      // Cursor UP     → room tilts back  (negative X).
      group.rotation.y += (-state.pointer.x * 0.10 - group.rotation.y) * 0.08;
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
