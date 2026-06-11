import * as THREE from "three";

/**
 * Single source of truth for the canonical room camera pose. App.tsx
 * imports these for the Canvas `camera` prop, the onCreated lookAt,
 * and the OrbitControls target. END_LOOK_AT MUST match the
 * OrbitControls `target` or the camera snaps when control transfers.
 *
 * (50, 50, 50): equal X=Y=Z keeps the iso angle correct. FOV is kept
 * narrow (5°) so the projection stays near-orthographic. Pulling the
 * camera CLOSER (vs widening FOV) preserves the parallel-line iso look.
 *
 * The 1.5s camera dolly intro was removed (user feedback: unnecessary).
 * The camera starts at the END pose; App.tsx flips sceneReady directly
 * when the transition is triggered.
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
