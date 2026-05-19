import { useMemo } from "react";
import * as THREE from "three";

/**
 * Circular surface under the room. Two effects in one shader:
 *
 *   1) A solid off-white disc (same source colour as the loading
 *      cover dome, #f0e6d6, so both render to the same ACES-tonemapped
 *      off-white the wrapper CSS bg matches). Alpha-fades at the disc
 *      edge so the surface dissolves into the wrapper rather than
 *      ending in a hard circle.
 *
 *   2) A soft radial shadow puddle peaking just outside the room's
 *      ~2.3m half-extent so the room reads as resting on the surface
 *      rather than floating above it.
 *
 * Plane diameter (12m) extends past the iso camera FOV at the floor's
 * Y; the radial fade lands offscreen at typical zooms, which is what
 * we want — no visible disc edge.
 */
const SURFACE_COLOR = new THREE.Color("#f0e6d6");
const SHADOW_COLOR = new THREE.Color("#3a2818");

const PLATFORM_RADIUS = 6;
const SHADOW_INNER = 2.1; // shadow ramps up from here (world units)
const SHADOW_PEAK = 2.9;
const SHADOW_OUTER = 4.6;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uSurface;
  uniform vec3 uShadow;
  uniform float uRadius;
  uniform float uShadowInner;
  uniform float uShadowPeak;
  uniform float uShadowOuter;

  void main() {
    // vUv ∈ [0,1]; convert to world-space distance from disc centre.
    float d = distance(vUv, vec2(0.5)) * 2.0 * uRadius;

    // Surface body: solid out to ~88% of radius, then smooth fade.
    float bodyAlpha = 1.0 - smoothstep(uRadius * 0.88, uRadius * 0.99, d);

    // Shadow puddle: ramp up then ramp down across the room footprint.
    float shadow;
    if (d < uShadowPeak) {
      shadow = smoothstep(uShadowInner, uShadowPeak, d);
    } else {
      shadow = 1.0 - smoothstep(uShadowPeak, uShadowOuter, d);
    }
    shadow *= 0.38; // overall strength

    vec3 col = mix(uSurface, uShadow, shadow);

    if (bodyAlpha < 0.001) discard;
    gl_FragColor = vec4(col, bodyAlpha);
  }
`;

export function GroundPlane() {
  const uniforms = useMemo(
    () => ({
      uSurface: { value: SURFACE_COLOR.clone() },
      uShadow: { value: SHADOW_COLOR.clone() },
      uRadius: { value: PLATFORM_RADIUS },
      uShadowInner: { value: SHADOW_INNER },
      uShadowPeak: { value: SHADOW_PEAK },
      uShadowOuter: { value: SHADOW_OUTER },
    }),
    [],
  );
  return (
    <mesh
      position={[0, -0.02, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={-2}
    >
      <circleGeometry args={[PLATFORM_RADIUS, 96]} />
      <shaderMaterial
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
