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

// ----- Pre-transition: float + parallax + hover lift -----
const FLOAT_AMPLITUDE = 0.07;
const FLOAT_FREQ = 0.8;
const HOVER_LIFT = 0.14;
const PARALLAX_X = 0.28;
const PARALLAX_Y = 0.22;
const LERP_PARALLAX = 0.08;
const LERP_POSITION = 0.1;

// ----- Transition (single camera, 1.5s) -----
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

/**
 * Single-camera intro. No ortho/perspective swap — the camera is a
 * PerspectiveCamera with a very narrow FOV (8°) that looks indistinguishable
 * from an orthographic projection at distance. The click transition lerps
 * camera position, FOV, and lookAt simultaneously to the free-orbit pose.
 */
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

    // ----- Pre-transition: idle float + parallax tilt + hover lift -----
    if (phase.current === "pre") {
      const elapsed = state.clock.elapsedTime;
      const floatY = Math.sin(elapsed * FLOAT_FREQ) * FLOAT_AMPLITUDE;
      const hoverLift = isHoveringRef.current ? HOVER_LIFT : 0;
      const yaw = state.pointer.x * PARALLAX_X;
      const pitch = -state.pointer.y * PARALLAX_Y;

      group.rotation.y = THREE.MathUtils.lerp(
        group.rotation.y,
        yaw,
        LERP_PARALLAX,
      );
      group.rotation.x = THREE.MathUtils.lerp(
        group.rotation.x,
        pitch,
        LERP_PARALLAX,
      );
      group.position.y = THREE.MathUtils.lerp(
        group.position.y,
        floatY + hoverLift,
        LERP_POSITION,
      );
      return;
    }

    // ----- Transition: one camera, simultaneous lerps -----
    if (phase.current === "transition") {
      progress.current = Math.min(progress.current + dt / DURATION, 1);
      const t = easeOutCubic(progress.current);

      // Snap the room group's pre-phase tilt/lift back to rest.
      group.rotation.x = startRotX.current * (1 - t);
      group.rotation.y = startRotY.current * (1 - t);
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
