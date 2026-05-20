import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useAssembly } from "./loading/AssemblyController";

/**
 * Ground plane the room sits on. Procedural rice-dot grid rendered
 * directly in the fragment shader (no baked texture) so the dots are
 * pixel-sharp at every camera distance — a texture-based version
 * always reads as blurry because GPU mipmapping smooths sub-pixel
 * dots into ovals.
 *
 * Features:
 * - Radial alpha falloff from plane center → outer (vignette feel,
 *   dense under the room, fades out at visible plane edges).
 * - Cursor dissolve: lightens dots toward bg in a soft blob around
 *   the mouse position. Raycast each frame to get UV.
 * - Climax fade-in: material opacity lerps 0 → 1 in sync with the
 *   orange-print cover dome's fade-out.
 *
 * y=0 (floor level). ContactShadows at y=+0.005 lands on top.
 */

const PLANE_SIZE = 60;
// Procedural grid scale — denser grid for finer, more "rice"-like
// appearance. 300 dots over 60 units → 5 dots/unit.
const GRID_COUNT = 300;
// Dot radius as a fraction of one grid cell (cells go 0..1, dot
// centered in cell). Smaller dots — feel like grains, not pebbles.
const DOT_RADIUS = 0.055;
// Radial fade from plane center — tightened: smaller dense center,
// faster falloff so dots feel concentrated under the room rather
// than uniformly across the plane.
const FADE_INNER = 0.05;
const FADE_OUTER = 0.22;
// Cursor dissolve — smaller hole.
const DISSOLVE_RADIUS = 0.04;
const DISSOLVE_FEATHER = 0.02;
const DISSOLVE_LERP_RATE = 9.0;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float uOpacity;
  uniform float uExpansion;
  uniform vec2 uMouseUV;
  uniform float uGridCount;
  uniform float uDotRadius;
  uniform float uFadeInner;
  uniform float uFadeOuter;
  uniform float uDissolveRadius;
  uniform float uDissolveFeather;
  uniform vec3 uBg;
  uniform vec3 uDot;
  varying vec2 vUv;

  void main() {
    // Procedural dot pattern. fract() builds a 0..1 cell at every
    // grid step; centering subtracts 0.5 so distance is from the
    // cell midpoint.
    vec2 cell = fract(vUv * uGridCount) - 0.5;
    float dotMask = 1.0 - smoothstep(uDotRadius - 0.02, uDotRadius + 0.02, length(cell));

    // Radial fade from plane center (vignette).
    float r = distance(vUv, vec2(0.5));
    float fade = 1.0 - smoothstep(uFadeInner, uFadeOuter, r);

    // Radial EXPANSION — only show dots whose distance from center
    // is within the current expansion frontier. uExpansion ramps
    // from 0 (no dots) → 1 (all dots up to FADE_OUTER visible) over
    // the post-climax animation. Small smoothstep band at the
    // frontier so it feels like a soft wavefront, not a hard ring.
    float frontier = uExpansion * uFadeOuter;
    float reveal = 1.0 - smoothstep(frontier, frontier + 0.025, r);

    // Cursor dissolve — removes dots in a blob around mouseUV.
    float md = distance(vUv, uMouseUV);
    float dissolve = 1.0 - smoothstep(
      uDissolveRadius - uDissolveFeather,
      uDissolveRadius + uDissolveFeather,
      md
    );

    // Combine: dot presence × radial fade × radial reveal × inverse dissolve.
    float a = dotMask * fade * reveal * (1.0 - dissolve) * 0.32;

    vec3 color = mix(uBg, uDot, a);
    gl_FragColor = vec4(color, uOpacity);
  }
`;

export function GroundPlane() {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const assembly = useAssembly();
  const { camera, size } = useThree();

  const uniforms = useMemo(
    () => ({
      uOpacity: { value: 0 },
      uExpansion: { value: 0 },
      uMouseUV: { value: new THREE.Vector2(-1, -1) },
      uGridCount: { value: GRID_COUNT },
      uDotRadius: { value: DOT_RADIUS },
      uFadeInner: { value: FADE_INNER },
      uFadeOuter: { value: FADE_OUTER },
      uDissolveRadius: { value: DISSOLVE_RADIUS },
      uDissolveFeather: { value: DISSOLVE_FEATHER },
      uBg: { value: new THREE.Color("#ecedef") },
      uDot: { value: new THREE.Color("#15171a") },
    }),
    [],
  );

  // Start the radial expansion animation only AFTER the wireframe
  // climax has fully completed. We track this with a ref so the
  // useFrame loop knows when to begin ramping uExpansion.
  const expansionStartedRef = useRef<number | null>(null);

  const mousePx = useRef({ x: -10000, y: -10000 });
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      mousePx.current.x = e.clientX;
      mousePx.current.y = e.clientY;
    };
    const onLeave = () => {
      mousePx.current.x = -10000;
      mousePx.current.y = -10000;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const tmpNdc = useMemo(() => new THREE.Vector2(), []);
  const targetUV = useMemo(() => new THREE.Vector2(-1, -1), []);

  useFrame((_, dt) => {
    const mat = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;

    // Material is fully opaque once it's on screen — the reveal is
    // driven by uExpansion, not opacity.
    mat.uniforms.uOpacity.value = 1;

    // Radial expansion: starts the moment climaxDone fires (wireframe
    // assembly is done AND the cover dome has finished fading out).
    // ease-out cubic over ~900ms gives the "dropping ontop of the
    // plane" feel — rapid initial reveal, soft settle.
    const EXPANSION_DURATION_MS = 900;
    if (assembly.climaxDone) {
      if (expansionStartedRef.current == null) {
        expansionStartedRef.current = performance.now();
      }
      const t = Math.min(
        1,
        (performance.now() - expansionStartedRef.current) /
          EXPANSION_DURATION_MS,
      );
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      mat.uniforms.uExpansion.value = eased;
    } else {
      mat.uniforms.uExpansion.value = 0;
    }

    // Raycast mouse → world point on plane → UV.
    if (mousePx.current.x < -1000) {
      targetUV.set(-1, -1);
    } else {
      tmpNdc.set(
        (mousePx.current.x / size.width) * 2 - 1,
        -(mousePx.current.y / size.height) * 2 + 1,
      );
      raycaster.setFromCamera(tmpNdc, camera);
      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length > 0) {
        const p = hits[0]!.point;
        targetUV.set(
          (p.x + PLANE_SIZE / 2) / PLANE_SIZE,
          1 - (p.z + PLANE_SIZE / 2) / PLANE_SIZE,
        );
      } else {
        targetUV.set(-1, -1);
      }
    }

    // Damped lerp toward the target UV — sharp cursor motion still
    // results in a flowing dissolve trail rather than a teleporting
    // hole. Fixed-rate per-frame damping (memory: scroll/cursor
    // animations must be fixed-rate, never raw scroll-bound).
    const uv = mat.uniforms.uMouseUV.value as THREE.Vector2;
    const lerpRate = 1 - Math.exp(-dt * DISSOLVE_LERP_RATE);
    uv.x += (targetUV.x - uv.x) * lerpRate;
    uv.y += (targetUV.y - uv.y) * lerpRate;
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        transparent
      />
    </mesh>
  );
}
