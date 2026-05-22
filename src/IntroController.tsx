import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
// tmpLookAt + easeOutCubic + DURATION removed when the 1.5s dolly
// intro was killed — see the controller body for the no-op pass.

interface Props {
  cameraRef: RefObject<THREE.PerspectiveCamera | null>;
  roomGroupRef: RefObject<THREE.Group | null>;
  isHoveringRef: RefObject<boolean>;
  transitionStarted: boolean;
  onComplete: () => void;
}

// Float / cursor-parallax / hover-lift were removed when the
// aesthetic shifted to product-photo (room on a plane). The constants
// that drove them went with the code that used them.

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
// True isometric — equal X, Y, Z distance from the lookAt point.
// Was (15.2, 9.6, 15.2) which had the camera too low → perspective
// foreshortening made the back-wall / side-wall corner lines
// diverge instead of meet. With X=Y=Z=14, the camera sits at a
// 45° rotation around Y AND a 35.26° elevation — the canonical
// iso angle where all three axes project at equal lengths.
export const END_POS = new THREE.Vector3(14, 14, 14);
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

export function IntroController({
  cameraRef,
  roomGroupRef,
  isHoveringRef,
  transitionStarted,
  onComplete,
}: Props) {
  const phase = useRef<"pre" | "done">("pre");
  const startRotX = useRef(0);
  const startRotY = useRef(0);
  const startY = useRef(0);
  void cameraRef;
  void startRotX;
  void startRotY;
  void startY;
  void isHoveringRef;

  // User asked: kill the camera dolly. It was 1.5s of camera lerp
  // from (55,55,55) → (15.2,9.6,15.2) — a "zoom into the room"
  // intro that played whenever transitionStarted flipped true. The
  // user found it "unnecessary." Camera now starts at the final
  // pose (see Canvas camera prop in App.tsx), and the controller
  // just locks the room group in place and reports "done" on the
  // first frame after transitionStarted so downstream code (OrbitControls
  // enable, ScrollCamera mount) still receives its signal.
  useEffect(() => {
    if (!transitionStarted || phase.current !== "pre") return;
    phase.current = "done";
    const group = roomGroupRef.current;
    if (group) {
      startRotX.current = group.rotation.x;
      startRotY.current = group.rotation.y;
      startY.current = group.position.y;
    }
    onComplete();
  }, [transitionStarted, roomGroupRef, onComplete]);

  useFrame(() => {
    const group = roomGroupRef.current;
    if (!group) return;
    // Lock the room group at the origin pose regardless of phase.
    // (Previously held rotation/lerp animation state during the
    // 1.5s intro — that animation is now gone.)
    group.rotation.set(0, 0, 0);
    group.position.set(0, 0, 0);
  });

  return null;
}
