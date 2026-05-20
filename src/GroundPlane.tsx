import * as THREE from "three";

/**
 * Ground plane the room sits on — receives REAL shadows from the
 * shadow-casting directional light in Lighting.tsx. ShadowMaterial
 * paints only where shadows fall and stays transparent elsewhere,
 * so the page wrapper-bg colour shows through the rest of the plane
 * (alpha-enabled canvas).
 *
 * The plane is large (60 units) so the soft shadow has room to fade
 * out before reaching the plane edge.
 */

const PLANE_SIZE = 60;

export function GroundPlane() {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -0.001, 0]}
      receiveShadow
    >
      <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
      {/* ShadowMaterial: receives + draws the shadow at the given
          opacity, fully transparent elsewhere. */}
      <shadowMaterial color={0x141a20} opacity={0.42} transparent />
    </mesh>
  );
}
