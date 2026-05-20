import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";

/**
 * Drives the room camera from page scroll progress. Defines a set of
 * named scroll "stops" — each is a camera pose (position + lookAt).
 * On each frame, the current pose is interpolated between adjacent
 * stops by scroll progress, then lerped into the live camera +
 * OrbitControls target with a soft damping factor so user-driven
 * orbit between scrolls also gets gently pulled back to the target
 * pose.
 *
 * OrbitControls is left enabled so the user can mouse-orbit between
 * scrolls; this controller's lerp pulls the camera back toward the
 * scroll-defined pose at a slow rate, so manual nudges feel like a
 * "lean" rather than a hard override.
 */

interface ScrollStop {
  /** 0..1 progress value at which this pose is the active anchor. */
  at: number;
  /** World-space camera position. */
  position: [number, number, number];
  /** World-space camera lookAt target. */
  target: [number, number, number];
}

// Camera poses keyed to scroll position. Tuned for the iso room layout.
// Hero (full-viewport room) sits at the post-intro pose. Once the
// canvas shrinks to the left ~50%, the room recenters by virtue of the
// camera staying put while the canvas viewport changes — the camera's
// view is still the same room, just rendered in a smaller area.
// 8-stop schedule for the 7-section page (hero + 7 content sections).
// Positions are scaled ≈1.79× from the pre-iso-crank values so they
// match the new END_FOV 20° projection. Targets are world look-at
// points so they don't change with FOV.
const STOPS: ScrollStop[] = [
  // Hero — matches END_POS / END_LOOK_AT from IntroController so
  // there's no snap when ScrollCamera takes over from the intro tilt.
  { at: 0.0, position: [11.4, 7.4, 11.4], target: [0, 0.8, 0] },
  // About — closer to the bed (cozy / personal corner).
  { at: 0.13, position: [8.45, 4.74, 10.32], target: [-0.5, 0.8, -0.6] },
  // Skills — pulled back, framing the whole stack.
  { at: 0.26, position: [10.9, 6.5, 10.9], target: [0, 1.0, 0] },
  // Projects — looking at the desk / monitor (where the work happens).
  { at: 0.40, position: [8.36, 3.86, 7.83], target: [1.2, 1.0, -1.3] },
  // Work — shelf / bookcase, back-left (where the books are).
  { at: 0.55, position: [7.21, 5.85, 7.80], target: [-1.2, 1.2, 1.0] },
  // Play — closer to the floor / rug / record player corner.
  { at: 0.70, position: [6.5, 3.2, 9.5], target: [-1.0, 0.4, 0.5] },
  // Other — high angle, surveying the whole room (catch-all view).
  { at: 0.83, position: [12.0, 9.5, 12.0], target: [0, 1.0, 0] },
  // Contact — pulled back to a wide hero-mirror view.
  { at: 0.95, position: [13.43, 8.32, 13.43], target: [0, 0.8, 0] },
];

interface Props {
  cameraRef: RefObject<THREE.PerspectiveCamera | null>;
  controlsRef: RefObject<OrbitControlsImpl | null>;
  /** 0..1 scroll progress; drives which stop pair we interpolate between. */
  progress: number;
}

const tmpPos = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const stopPosA = new THREE.Vector3();
const stopPosB = new THREE.Vector3();
const stopTgtA = new THREE.Vector3();
const stopTgtB = new THREE.Vector3();

/** ease-in-out cubic for smooth section transitions. */
function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function ScrollCamera({ cameraRef, controlsRef, progress }: Props) {
  const progressRef = useRef(progress);
  progressRef.current = progress;

  // Keep the scroll-pose recomputation cheap — it runs every frame.
  useFrame((_, dt) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const p = progressRef.current;

    // Find the pair of stops bracketing the current progress.
    let a = STOPS[0]!;
    let b = STOPS[STOPS.length - 1]!;
    for (let i = 0; i < STOPS.length - 1; i++) {
      if (p >= STOPS[i]!.at && p <= STOPS[i + 1]!.at) {
        a = STOPS[i]!;
        b = STOPS[i + 1]!;
        break;
      }
    }
    if (p < STOPS[0]!.at) {
      a = STOPS[0]!;
      b = STOPS[0]!;
    } else if (p > STOPS[STOPS.length - 1]!.at) {
      a = STOPS[STOPS.length - 1]!;
      b = STOPS[STOPS.length - 1]!;
    }
    const span = Math.max(1e-6, b.at - a.at);
    const t = easeInOut(Math.max(0, Math.min(1, (p - a.at) / span)));

    stopPosA.fromArray(a.position);
    stopPosB.fromArray(b.position);
    stopTgtA.fromArray(a.target);
    stopTgtB.fromArray(b.target);
    tmpPos.lerpVectors(stopPosA, stopPosB, t);
    tmpTarget.lerpVectors(stopTgtA, stopTgtB, t);

    // Damped pull toward the scroll-defined pose. Faster lerp rate
    // makes manual orbit feel more "snappy back"; slower lets the
    // user explore for longer between scrolls. 2.0 ≈ ~half-second
    // catch-up.
    const lerpRate = 1 - Math.exp(-dt * 2.5);
    camera.position.lerp(tmpPos, lerpRate);
    controls.target.lerp(tmpTarget, lerpRate);
    camera.lookAt(controls.target);
  });

  // Suppress unused-var warning for refs that are used in useFrame closure.
  void cameraRef;
  void controlsRef;
  return null;
}
