import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  useDeskViewActiveRef,
  useSceneReadyRef,
  useSetDeskViewActive,
} from "./SceneState";

const DURATION = 2.6;
/** Faster, snappier lerp for the fullscreen dolly so the zoom reads as "into the screen". */
const FULLSCREEN_DURATION = 0.7;

// FOV ramp for the three poses. Lower FOV = more telephoto = less
// perspective distortion. The big drop from DESK → FULLSCREEN
// stacks with the camera's forward motion to exaggerate the dolly.
const ROOM_FOV = 50;
const DESK_FOV = 32;
const FULLSCREEN_FOV = 26;

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
// X aligned to the monitor centre, Y barely above the look-at Y so
// the camera is almost level → minimal keystone on the monitor face
// while still showing keyboard / mouse / PC tower in the lower
// quarter of the frame (FOV 32 has enough vertical cone to catch
// them). Pulled back to ~0.5 m in Z.
const END_CAM = new THREE.Vector3(1.4525, 1.12, -0.5);

/**
 * Focal point — MUST match FULLSCREEN_LOOK so the dolly into / out of
 * fullscreen is pure forward translation. Keyboard / mouse / PC stay
 * in the lower half of the frame because the camera Y sits above the
 * look-at Y (downward tilt).
 */
const END_LOOK = new THREE.Vector3(1.4525, 1.0556, -2.0048);

/**
 * Fullscreen dolly pose — camera flies right up to the monitor face so
 * the screen rect fills (close to) the entire viewport. Centered on
 * the monitor frame (Blender Z-up converted: 1.4525, 1.0556, -2.0048)
 * with a small +Z standoff so we don't clip through the Html plane.
 */
const FULLSCREEN_CAM = new THREE.Vector3(1.4525, 1.0556, -1.22);
const FULLSCREEN_LOOK = new THREE.Vector3(1.4525, 1.0556, -2.0048);

/** Smooth at both ends — avoids a harsh ease-out “snap” at t = 0. */
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

type DeskAnim = {
  kind: "toDesk" | "fromDesk" | "toFullscreen" | "fromFullscreen";
  t: number;
  duration: number;
  startCam: THREE.Vector3;
  startTarget: THREE.Vector3;
  endCam: THREE.Vector3;
  endTarget: THREE.Vector3;
  startFov: number;
  endFov: number;
  /** Optional callback fired when the lerp completes. */
  onDone?: () => void;
};

/**
 * Registers `implRef.current` as the runner for a smooth camera + OrbitControls
 * target lerp into a seated-at-the-desk view. **Escape** lerps back to the pose
 * stored when the desk transition started.
 */
export function DeskViewController({
  implRef,
  fullscreenImplRef,
}: {
  implRef: MutableRefObject<(() => void) | null>;
  /**
   * Set by App. `.current.toFullscreen(onArrive)` lerps the camera into
   * the monitor face; `.current.fromFullscreen()` lerps back to the
   * seated desk pose.
   */
  fullscreenImplRef?: MutableRefObject<{
    toFullscreen: (onArrive: () => void) => void;
    fromFullscreen: (onArrive?: () => void) => void;
  } | null>;
}) {
  const { camera, controls } = useThree();
  const sceneReadyRef = useSceneReadyRef();
  const sharedDeskActiveRef = useDeskViewActiveRef();
  const setDeskViewActive = useSetDeskViewActive();
  const anim = useRef<DeskAnim | null>(null);
  const savedPoseRef = useRef<{
    cam: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  // Local mirror of the shared ref so the controller's checks don't have to
  // cross the context boundary on every frame. The setter and refs are kept
  // in sync below — refs for hot-path reads, state setter so React-rendered
  // things (like the on-monitor OS) can mount / unmount on the transition.
  const deskViewActiveRef = useRef(false);
  const writeDeskActive = (v: boolean) => {
    deskViewActiveRef.current = v;
    if (sharedDeskActiveRef) sharedDeskActiveRef.current = v;
    setDeskViewActive(v);
  };

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
        duration: DURATION,
        startCam: savedPoseRef.current.cam.clone(),
        startTarget: savedPoseRef.current.target.clone(),
        endCam: END_CAM.clone(),
        endTarget: END_LOOK.clone(),
        startFov: (camera as THREE.PerspectiveCamera).fov,
        endFov: DESK_FOV,
      };
      orbit.enabled = false;
    };
    implRef.current = run;
    return () => {
      implRef.current = null;
    };
  }, [camera, controls, implRef, sceneReadyRef]);

  // Expose fullscreen dolly. Camera flies from the seated pose into
  // the monitor face; on arrival, `onArrive()` fires (App mounts the
  // fullscreen overlay there). Reverse pulls it back to the seated
  // pose so the OS can fade back to the monitor-mounted view.
  useEffect(() => {
    if (!fullscreenImplRef) return;
    fullscreenImplRef.current = {
      toFullscreen: (onArrive) => {
        if (!controls) return;
        if (anim.current) return;
        anim.current = {
          kind: "toFullscreen",
          t: 0,
          duration: FULLSCREEN_DURATION,
          startCam: camera.position.clone(),
          startTarget: (controls as OrbitControlsImpl).target.clone(),
          endCam: FULLSCREEN_CAM.clone(),
          endTarget: FULLSCREEN_LOOK.clone(),
          startFov: (camera as THREE.PerspectiveCamera).fov,
          endFov: FULLSCREEN_FOV,
          onDone: onArrive,
        };
      },
      fromFullscreen: (onArrive) => {
        if (!controls) return;
        if (anim.current) return;
        anim.current = {
          kind: "fromFullscreen",
          t: 0,
          duration: FULLSCREEN_DURATION,
          startCam: camera.position.clone(),
          startTarget: (controls as OrbitControlsImpl).target.clone(),
          endCam: END_CAM.clone(),
          endTarget: END_LOOK.clone(),
          startFov: (camera as THREE.PerspectiveCamera).fov,
          endFov: DESK_FOV,
          onDone: onArrive,
        };
      },
    };
    return () => {
      if (fullscreenImplRef) fullscreenImplRef.current = null;
    };
  }, [camera, controls, fullscreenImplRef]);

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
      // NOTE: do NOT flip deskActive here. Keep it true through the entire
      // fromDesk lerp so glow + clicks + drags all stay gated off until the
      // camera has fully returned to the free-orbit pose (see write below).
      anim.current = {
        kind: "fromDesk",
        t: 0,
        duration: DURATION,
        startCam: END_CAM.clone(),
        startTarget: END_LOOK.clone(),
        endCam: savedPoseRef.current.cam.clone(),
        endTarget: savedPoseRef.current.target.clone(),
        startFov: (camera as THREE.PerspectiveCamera).fov,
        endFov: ROOM_FOV,
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
    const u = Math.min(a.t / a.duration, 1);
    const s = easeInOutCubic(u);
    camera.position.lerpVectors(a.startCam, a.endCam, s);
    orbit.target.lerpVectors(a.startTarget, a.endTarget, s);
    camera.up.set(0, 1, 0);
    camera.lookAt(orbit.target);
    const persp = camera as THREE.PerspectiveCamera;
    persp.fov = THREE.MathUtils.lerp(a.startFov, a.endFov, s);
    persp.updateProjectionMatrix();
    if (u >= 1) {
      camera.position.copy(a.endCam);
      orbit.target.copy(a.endTarget);
      camera.up.set(0, 1, 0);
      camera.lookAt(orbit.target);
      persp.fov = a.endFov;
      persp.updateProjectionMatrix();
      // Only re-sync orbit's spherical when we're handing control
      // back to the user (fromDesk → free orbit). For toDesk /
      // to-or-fromFullscreen, orbit stays disabled and calling
      // .update() can nudge the camera off the look-at axis we just
      // set with lookAt(), reintroducing keystone / roll.
      if (a.kind === "fromDesk") {
        orbit.update();
      }
      zeroCameraRoll(camera as THREE.PerspectiveCamera);
      orbit.enabled = a.kind === "fromDesk";
      const done = a.onDone;
      anim.current = null;
      if (a.kind === "toDesk") writeDeskActive(true);
      if (a.kind === "fromDesk") writeDeskActive(false);
      // `to/fromFullscreen` don't touch deskActive — the user is still
      // seated at the desk; only the camera distance changes.
      done?.();
    }
  });

  return null;
}
