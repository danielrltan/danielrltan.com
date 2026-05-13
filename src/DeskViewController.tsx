import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useSceneReadyRef } from "./SceneState";

const DURATION = 2.6;

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

/** Smooth at both ends — avoids a harsh ease-out “snap” at t = 0. */
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

type DeskAnim = {
  kind: "toDesk" | "fromDesk";
  t: number;
  startCam: THREE.Vector3;
  startTarget: THREE.Vector3;
  endCam: THREE.Vector3;
  endTarget: THREE.Vector3;
};

/**
 * Registers `implRef.current` as the runner for a smooth camera + OrbitControls
 * target lerp into a seated-at-the-desk view. **Escape** lerps back to the pose
 * stored when the desk transition started.
 */
export function DeskViewController({
  implRef,
}: {
  implRef: MutableRefObject<(() => void) | null>;
}) {
  const { camera, controls } = useThree();
  const sceneReadyRef = useSceneReadyRef();
  const anim = useRef<DeskAnim | null>(null);
  const savedPoseRef = useRef<{
    cam: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  const deskViewActiveRef = useRef(false);

  useEffect(() => {
    const run = () => {
      if (!sceneReadyRef?.current || !controls) return;
      if (anim.current) return;
      if (deskViewActiveRef.current) return;
      const orbit = controls as OrbitControlsImpl;
      savedPoseRef.current = {
        cam: camera.position.clone(),
        target: orbit.target.clone(),
      };
      anim.current = {
        kind: "toDesk",
        t: 0,
        startCam: savedPoseRef.current.cam.clone(),
        startTarget: savedPoseRef.current.target.clone(),
        endCam: END_CAM.clone(),
        endTarget: END_LOOK.clone(),
      };
      orbit.enabled = false;
    };
    implRef.current = run;
    return () => {
      implRef.current = null;
    };
  }, [camera, controls, implRef, sceneReadyRef]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Escape" || e.repeat) return;
      if (!controls || !savedPoseRef.current) return;
      if (anim.current) return;
      if (!deskViewActiveRef.current) return;
      const el = e.target;
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable || el.closest("input, textarea, select"))
      ) {
        return;
      }
      e.preventDefault();
      const orbit = controls as OrbitControlsImpl;
      deskViewActiveRef.current = false;
      anim.current = {
        kind: "fromDesk",
        t: 0,
        startCam: END_CAM.clone(),
        startTarget: END_LOOK.clone(),
        endCam: savedPoseRef.current.cam.clone(),
        endTarget: savedPoseRef.current.target.clone(),
      };
      orbit.enabled = false;
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controls]);

  useFrame((_, dt) => {
    if (!anim.current || !controls) return;
    const orbit = controls as OrbitControlsImpl;
    const a = anim.current;
    a.t += Math.min(dt, 0.05);
    const u = Math.min(a.t / DURATION, 1);
    const s = easeInOutCubic(u);
    camera.position.lerpVectors(a.startCam, a.endCam, s);
    orbit.target.lerpVectors(a.startTarget, a.endTarget, s);
    camera.up.set(0, 1, 0);
    // Do not call orbit.update() while lerping (see below). Do not tie target.x
    // to camera.x mid-tween — when Orbit has separated them in X, that forces a
    // huge first-frame target jump and reads as a snap before the zoom.
    camera.lookAt(orbit.target);
    if (u >= 1) {
      camera.position.copy(a.endCam);
      orbit.target.copy(a.endTarget);
      camera.up.set(0, 1, 0);
      camera.lookAt(orbit.target);
      zeroCameraRoll(camera as THREE.PerspectiveCamera);
      // One sync so Orbit’s internal spherical matches this pose before re-enable.
      orbit.update();
      orbit.enabled = true;
      anim.current = null;
      if (a.kind === "toDesk") deskViewActiveRef.current = true;
    }
  });

  return null;
}
