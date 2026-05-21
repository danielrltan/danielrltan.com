import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// Plane lives in front of camera's far-from-model side, oriented to
// face the camera. Distance is measured along the camera's view
// direction so the plane is perpendicular to view and reads as a
// flat backdrop. Each frame we re-position + re-scale to track the
// camera (handles off-axis camera angles + canvas resize).
const PLANE_DISTANCE_BEHIND_TARGET = 4;

/**
 * Backdrop for the keypad section — a large plane behind the model,
 * rendered with a custom shader. Default state is the section's
 * near-white bg. Rice grains only appear inside a soft, noise-warped
 * blob centred on the cursor — feels like wet rice pooling around
 * where the user is pointing. Inverse of the room's GroundPlane
 * (rice everywhere, dissolves AT the cursor) so this section reads
 * as a different spatial register.
 *
 * The plane is sized to overshoot the camera frustum at its z depth,
 * so we don't need exact frustum math.
 */

const BG_COLOR = "#f3f3f3";
const RICE_COLOR = "#C4C4C4";

// Larger, more legible rice grains. Fewer cells (so each cell is
// bigger) + larger fill fraction (so each dot fills more of its
// cell). Earlier 220 / 0.06 read as faint dotted noise; 110 / 0.13
// reads as clearly visible rice grains.
const GRID_COUNT = 110;
const DOT_RADIUS = 0.13;

// Blob radius / feather in aspect-corrected UV space. Bumped 1.2x
// from 0.13 → 0.156 (and feather proportionally) per user feedback —
// the rice pool reads bigger on screen, easier to spot under the cursor.
const BLOB_RADIUS = 0.156;
const BLOB_FEATHER = 0.096;

// rAF damping rate for cursor follow.
const CURSOR_LERP_RATE = 11.0;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform vec2 uCursor;   // 0..1 canvas-normalized, Y-down
  uniform vec2 uAspect;   // canvas aspect (x = width/min, y = height/min)
  uniform float uTime;
  uniform float uBlobRadius;
  uniform float uBlobFeather;
  uniform float uGridCount;
  uniform float uDotRadius;
  uniform vec3 uBg;
  uniform vec3 uRice;
  uniform float uActive;

  float hash21(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    // Plane UV V is 0 at bottom; canvas cursor Y is 0 at top. Flip
    // so vUv and uCursor are in the same convention.
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);

    // Aspect-corrected grid — uses uAspect so cells stay square.
    vec2 gridUv = vec2(uv.x * uAspect.x, uv.y * uAspect.y);
    vec2 cell = fract(gridUv * uGridCount) - 0.5;
    float dotMask = 1.0 - smoothstep(
      uDotRadius - 0.02,
      uDotRadius + 0.02,
      length(cell)
    );

    // Distance from cursor in aspect-corrected screen-space, so the
    // blob is a true circle regardless of canvas aspect ratio.
    vec2 d = (uv - uCursor) * uAspect;
    float dist = length(d);

    // Noise-warp the blob edge so it feels like flowing rice fluid
    // rather than a hard circle.
    float n = noise2(d * 4.0 + uTime * 0.35) - 0.5;
    float warpedDist = dist + n * 0.05;

    float blob = 1.0 - smoothstep(
      uBlobRadius - uBlobFeather,
      uBlobRadius + uBlobFeather,
      warpedDist
    );
    blob *= uActive;

    // Grain drift inside the blob — second noise modulates dot alpha
    // so individual grains seem to flow. Higher floor (0.75 vs 0.55)
    // so grains stay solid most of the time and only subtly fade in
    // and out as the noise field passes over them.
    float drift = 0.75 + 0.25 * noise2(gridUv * 6.0 + uTime * 0.6);

    // Final alpha mult clamped to 1 so we don't extrapolate past
    // the rice color in mix(). 1.1 floor keeps the centers of dots
    // fully solid (mix.t == 1 hits pure rice color).
    float a = clamp(dotMask * blob * drift * 1.1, 0.0, 1.0);
    vec3 col = mix(uBg, uRice, a);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export interface CursorState {
  x: number;
  y: number;
  active: boolean;
}

interface Props {
  cursorRef: React.MutableRefObject<CursorState>;
}

export function RiceBlob({ cursorRef }: Props) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const { size, camera } = useThree();
  const startMs = useMemo(() => performance.now(), []);

  const uniforms = useMemo(
    () => ({
      uCursor: { value: new THREE.Vector2(-2, -2) },
      uAspect: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uBlobRadius: { value: BLOB_RADIUS },
      uBlobFeather: { value: BLOB_FEATHER },
      uGridCount: { value: GRID_COUNT },
      uDotRadius: { value: DOT_RADIUS },
      uBg: { value: new THREE.Color(BG_COLOR) },
      uRice: { value: new THREE.Color(RICE_COLOR) },
      uActive: { value: 0 },
    }),
    [],
  );

  useFrame((_, dt) => {
    const mat = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;
    const aspect = mat.uniforms.uAspect.value as THREE.Vector2;
    if (size.width >= size.height) {
      aspect.set(size.width / size.height, 1);
    } else {
      aspect.set(1, size.height / size.width);
    }
    // Position + orient + size the plane to be a flat backdrop
    // perpendicular to the camera's view direction, sitting on the
    // far side of the lookAt point. This way the plane appears as a
    // clean rectangle filling the visible frame, regardless of
    // off-axis camera angles. Cursor-canvas-UV maps 1:1 onto plane
    // UV because the plane is now screen-aligned.
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const pc = camera as THREE.PerspectiveCamera;
      const camDir = new THREE.Vector3();
      pc.getWorldDirection(camDir);
      // World-origin is the scene's lookAt (KeypadModel recenters the
      // model centroid there). Plane sits behind it along camDir.
      const planePos = camDir
        .clone()
        .multiplyScalar(PLANE_DISTANCE_BEHIND_TARGET);
      mesh.position.copy(planePos);
      mesh.lookAt(pc.position);
      // Visible size of the plane at its distance from the camera.
      const distFromCam = pc.position.distanceTo(planePos);
      const h =
        2 * Math.tan(THREE.MathUtils.degToRad(pc.fov / 2)) * distFromCam;
      const w = h * (size.width / size.height);
      mesh.scale.set(w / 24, h / 16, 1);
    }
    mat.uniforms.uTime.value = (performance.now() - startMs) / 1000;

    // Fixed-rate lerp toward cursor target — never bind a uniform
    // directly to a per-event value.
    const uv = mat.uniforms.uCursor.value as THREE.Vector2;
    const t = cursorRef.current;
    const k = 1 - Math.exp(-dt * CURSOR_LERP_RATE);
    uv.x += (t.x - uv.x) * k;
    uv.y += (t.y - uv.y) * k;
    mat.uniforms.uActive.value += (
      (t.active ? 1 : 0) - mat.uniforms.uActive.value
    ) * k;
  });

  // Base geometry (24, 16) — useFrame above repositions, orients,
  // and scales the mesh each frame to keep it as a flat backdrop
  // perpendicular to the camera. Initial position doesn't matter;
  // useFrame overrides on the first tick.
  return (
    <mesh ref={meshRef} renderOrder={-1}>
      <planeGeometry args={[24, 16]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
