import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useSceneReadyRef } from "./SceneState";

const DURATION = 2.1;

const tmpEuler = new THREE.Euler();

/**
 * Remove roll around the view axis while keeping yaw/pitch (YXZ order).
 */
function zeroCameraRoll(cam: THREE.PerspectiveCamera) {
  tmpEuler.setFromQuaternion(cam.quaternion, "YXZ");
  tmpEuler.z = 0;
  cam.quaternion.setFromEuler(tmpEuler);
}

/**
 * Seated eye: raised and eased toward the desk (-Z) so distance to `END_LOOK`
 * grows (~1.5 m → wider frame) without jumping as far +Z as a pure “pull back”
 * (which had sat behind the chair at z ≈ -0.7).
 */
const END_CAM = new THREE.Vector3(1.5, 1.38, -0.92);

/**
 * Focal point: same **x** as the camera so the view lies in a vertical plane
 * (no horizontal skew / “dutch angle”). Low Y + -Z keeps keyboard + mouse in frame.
 */
const END_LOOK = new THREE.Vector3(1.5, 0.89, -2.32);

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Registers `implRef.current` as the runner for a smooth camera + OrbitControls
 * target lerp into a seated-at-the-desk view.
 */
export function DeskViewController({
  implRef,
}: {
  implRef: MutableRefObject<(() => void) | null>;
}) {
  const { camera, controls } = useThree();
  const sceneReadyRef = useSceneReadyRef();
  const anim = useRef<{
    t: number;
    startCam: THREE.Vector3;
    startTarget: THREE.Vector3;
  } | null>(null);

  useEffect(() => {
    const run = () => {
      if (!sceneReadyRef?.current || !controls) return;
      const orbit = controls as OrbitControlsImpl;
      anim.current = {
        t: 0,
        startCam: camera.position.clone(),
        startTarget: orbit.target.clone(),
      };
      orbit.enabled = false;
    };
    implRef.current = run;
    return () => {
      implRef.current = null;
    };
  }, [camera, controls, implRef, sceneReadyRef]);

  useFrame((_, dt) => {
    if (!anim.current || !controls) return;
    const orbit = controls as OrbitControlsImpl;
    anim.current.t += dt;
    const u = Math.min(anim.current.t / DURATION, 1);
    const s = easeOutCubic(u);
    camera.position.lerpVectors(anim.current.startCam, END_CAM, s);
    orbit.target.lerpVectors(anim.current.startTarget, END_LOOK, s);
    orbit.target.x = camera.position.x;
    camera.up.set(0, 1, 0);
    orbit.update();
    if (u >= 1) {
      camera.position.copy(END_CAM);
      orbit.target.copy(END_LOOK);
      orbit.target.x = END_CAM.x;
      camera.up.set(0, 1, 0);
      orbit.update();
      zeroCameraRoll(camera as THREE.PerspectiveCamera);
      orbit.enabled = true;
      anim.current = null;
    }
  });

  return null;
}
