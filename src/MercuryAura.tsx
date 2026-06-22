import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { blobRiceColor, blobBgColor, BLOB_COMPOSITE_GLSL } from "./cursorBlob";

/**
 * CURSOR RICE POOL + VENOM HUG — the spill menu's liquid cursor effect.
 *
 * Two coupled behaviours in one screen-space metaball field:
 *  1) A mercury TRAIL follows the cursor (lagging metaball rope, like the
 *     keypad RiceBlob) that lights up the faint orange background rice and
 *     draws a thin membrane outline. No filled glow disc.
 *  2) A VENOM HUG: when the cursor is over a 3D object, an extra metaball
 *     grows at that object's projected screen position (sized to the object)
 *     and SMOOTH-UNIONS into the trail, so the liquid reaches out from the
 *     cursor and engulfs/wraps the shape like a symbiote — then releases when
 *     you move away.
 *
 * Honest effect: real screen-space dot grid + real SDF (polynomial smin), no
 * gradient overlays. sRGB-encoded. Fixed-rate lerps (never bound to a
 * per-event value).
 */

// Rice colour (= --accent) + the backdrop it composites over (= --bg-page) come
// from the shared cursorBlob module (src/cursorBlob.ts), and the rice is mixed
// over the backdrop in LINEAR space via the shared blobComposite() — the SAME
// inputs + SAME math the keypad RiceBlob uses, so the two blobs render the EXACT
// same colour and can't drift. (Orange over #eef0f3 in linear space, NOT orange
// alpha-blended over white in sRGB, which read warmer.)
const GRID_COUNT = 96; // rice density
const DOT_RADIUS = 0.14; // grain size within a cell
const POOL_RADIUS = 0.07; // head ball radius (screen-height units)
const TRAIL_N = 10; // metaballs in the liquid trail

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uTrail[${TRAIL_N}]; // [0] = head, 0..1 y-down
  uniform float uActive;  // 0..1 cursor present
  uniform float uTime;
  uniform vec2 uAspect;   // (W/H,1) landscape / (1,H/W) portrait
  uniform vec3 uRice;
  uniform vec3 uRiceHot;
  uniform vec3 uBg;
  uniform float uGrid;
  uniform float uDot;
  uniform float uPoolR;
  uniform vec2 uHugCenter;  // hovered object centre, 0..1 y-down
  uniform float uHugRadius; // object radius, screen-height units
  uniform float uHugStrength; // 0..1 hug presence

  float hash21(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // polynomial smooth-union (smin) accumulator
  float sunion(float sd, float di, float k) {
    float h = clamp(0.5 + 0.5 * (di - sd) / k, 0.0, 1.0);
    return mix(di, sd, h) - k * h * (1.0 - h);
  }
  ${BLOB_COMPOSITE_GLSL}
  void main() {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y); // y-down to match the cursor

    // Aspect-corrected rice grid (round grains).
    vec2 g = vec2(uv.x * uAspect.x, uv.y * uAspect.y);
    vec2 cell = fract(g * uGrid) - 0.5;
    float grain = 1.0 - smoothstep(uDot - 0.02, uDot + 0.02, length(cell));

    // Liquid trail: smooth-union of a chain of wobbling metaballs.
    float k = 0.065;
    float sd = 1e9;
    for (int i = 0; i < ${TRAIL_N}; i++) {
      float fi = float(i) / float(${TRAIL_N});
      vec2 d = (uv - uTrail[i]) * uAspect;
      vec2 dir = normalize(d + vec2(1e-4));
      float wob = (noise2(dir * 1.7 + vec2(uTime * 0.45, fi * 4.0)) - 0.5) * 0.02;
      float r = uPoolR * (1.0 - fi * 0.45) + wob;
      sd = sunion(sd, length(d) - r, k);
    }

    // VENOM HUG: a metaball at the hovered object that the liquid engulfs.
    // A wider smin (kHug) makes the trail reach out and wrap it as it grows.
    if (uHugStrength > 0.001) {
      vec2 dh = (uv - uHugCenter) * uAspect;
      vec2 hdir = normalize(dh + vec2(1e-4));
      float hwob = (noise2(hdir * 2.0 + vec2(uTime * 0.5, 7.0)) - 0.5) * 0.03;
      float rh = uHugRadius * (0.55 + 0.45 * uHugStrength) + hwob;
      sd = sunion(sd, length(dh) - rh, 0.11);
    }

    float inside = smoothstep(0.006, -0.006, sd);          // 1 inside the pool
    float ring = (1.0 - smoothstep(0.0, 0.009, abs(sd))) * uActive; // membrane

    // A slow noise drift makes the grains shimmer like wet rice.
    float drift = 0.78 + 0.22 * noise2(g * 5.0 + vec2(uTime * 0.6, 0.0));

    // RICE VIGNETTE: instead of a uniform field, the rice forms a GRADIENT
    // concentrated on the OUTSIDE — bright at the edges, fading to a clear
    // centre — the reverse of the keypad's central glow. The vignette centre
    // slowly DRIFTS + breathes (low-freq value noise) so the edge glow moves
    // organically + fluid. The lit cursor pool + membrane ride on top.
    vec2 vc = vec2(0.5, 0.5) + 0.06 * (vec2(
      noise2(vec2(uTime * 0.04, 5.3)),
      noise2(vec2(uTime * 0.04, 19.1))
    ) * 2.0 - 1.0);
    float vd = length((uv - vc) * uAspect);
    float vbreath = 0.85 + 0.15 * noise2(vec2(uTime * 0.05, 41.0));
    float vig = smoothstep(0.22, 0.95, vd) * vbreath; // 0 centre -> bright edges
    float fieldA = grain * mix(0.10, 0.62, vig) * (0.7 + 0.3 * drift);
    float lit = grain * inside * uActive * drift;

    vec3 col = mix(uRice, uRiceHot, inside);
    float a = clamp(fieldA + lit * 0.95 + ring * 0.9, 0.0, 1.0);
    // Shared blobComposite(): mix the rice OVER the page tone in LINEAR space,
    // OPAQUE — the SAME inputs + math as the keypad RiceBlob (src/cursorBlob.ts),
    // so the two cursor blobs render the identical colour. (Was a transparent
    // rice the browser alpha-blended over a white scrim in sRGB, reading warmer.)
    gl_FragColor = vec4(blobComposite(uBg, col, a), 1.0);
    #include <colorspace_fragment>
  }
`;

export interface CursorState {
  x: number;
  y: number;
  active: boolean;
}

export interface AuraTarget {
  pos: THREE.Vector3;
  r: number;
}

interface Props {
  cursorRef: React.MutableRefObject<CursorState>;
  positionsRef: React.MutableRefObject<AuraTarget[]>;
  reduced: boolean;
}

// Plane z (just behind the ring). The menu camera looks straight down -z with
// no roll, so the plane is simply axis-aligned (facing +z toward the camera) —
// no lookAt (which mirrored the UVs). depthTest is off so it always draws
// behind the objects via renderOrder regardless of its exact z.
const PLANE_Z = -3;
const _c = new THREE.Vector3();
const _up = new THREE.Vector3();

export function MercuryAura({ cursorRef, positionsRef, reduced }: Props) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const { size, camera } = useThree();
  const startMs = useMemo(() => performance.now(), []);

  const uniforms = useMemo(
    () => ({
      uTrail: {
        value: Array.from({ length: TRAIL_N }, () => new THREE.Vector2(0.5, 0.5)),
      },
      uActive: { value: 0 },
      uTime: { value: 0 },
      uAspect: { value: new THREE.Vector2(1, 1) },
      uRice: { value: blobRiceColor() },
      uRiceHot: { value: blobRiceColor() },
      uBg: { value: blobBgColor() },
      uGrid: { value: GRID_COUNT },
      uDot: { value: DOT_RADIUS },
      uPoolR: { value: POOL_RADIUS },
      uHugCenter: { value: new THREE.Vector2(0.5, 0.5) },
      uHugRadius: { value: 0.12 },
      uHugStrength: { value: 0 },
    }),
    [],
  );

  useFrame((_, dt) => {
    const mat = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;
    const dtc = Math.min(dt, 0.05);

    const aspect = mat.uniforms.uAspect.value as THREE.Vector2;
    if (size.width >= size.height) aspect.set(size.width / size.height, 1);
    else aspect.set(1, size.height / size.width);

    // Axis-aligned screen-filling plane (no lookAt; camera looks down -z).
    const pc = camera as THREE.PerspectiveCamera;
    if (pc.isPerspectiveCamera) {
      const distFromCam = pc.position.z - PLANE_Z;
      const h = 2 * Math.tan(THREE.MathUtils.degToRad(pc.fov / 2)) * distFromCam;
      const w = h * (size.width / size.height);
      mesh.position.set(0, 0, PLANE_Z);
      mesh.rotation.set(0, 0, 0);
      mesh.scale.set(w, h, 1);
    }

    if (!reduced) mat.uniforms.uTime.value = (performance.now() - startMs) / 1000;

    const tgt = cursorRef.current;
    const trail = mat.uniforms.uTrail.value as THREE.Vector2[];
    const active = mat.uniforms.uActive.value as number;

    // Snap the whole rope onto the cursor while invisible, so it forms AT the
    // cursor instead of flying in from the centre on first appearance.
    if (active < 0.02) {
      for (let i = 0; i < TRAIL_N; i++) trail[i]!.set(tgt.x, tgt.y);
    } else {
      // Head chases the cursor; each follower lags toward the one ahead and is
      // clamped to MAX_GAP so the union stays a continuous mercury rope that
      // stretches when moving and flows back together when still.
      const head = trail[0]!;
      const kHead = 1 - Math.exp(-dtc * 32);
      head.x += (tgt.x - head.x) * kHead;
      head.y += (tgt.y - head.y) * kHead;
      const kChain = 1 - Math.exp(-dtc * 26);
      const MAX_GAP = 0.03;
      for (let i = 1; i < TRAIL_N; i++) {
        const p = trail[i]!;
        const a = trail[i - 1]!;
        p.x += (a.x - p.x) * kChain;
        p.y += (a.y - p.y) * kChain;
        const dx = a.x - p.x;
        const dy = a.y - p.y;
        const dist = Math.hypot(dx, dy) || 1;
        if (dist > MAX_GAP) {
          p.x = a.x - (dx / dist) * MAX_GAP;
          p.y = a.y - (dy / dist) * MAX_GAP;
        }
      }
    }

    const ak = 1 - Math.exp(-dtc * 8);
    mat.uniforms.uActive.value += ((tgt.active ? 1 : 0) - active) * ak;

    // VENOM HUG: find which object the CURSOR is over by screen-space proximity,
    // recomputed EVERY FRAME — so it can never get "stuck" the way the R3F
    // pointer-out events did when objects spun/dragged under the cursor. Lerp
    // the hug metaball onto the nearest object the cursor is inside; release
    // when the cursor isn't over any object.
    const ax = aspect.x;
    const ay = aspect.y;
    let best = -1;
    let bestDist = 1e9;
    let bx = 0;
    let by = 0;
    let brad = 0.12;
    const arr = positionsRef.current;
    for (let i = 0; i < arr.length; i++) {
      const e = arr[i];
      if (!e || e.r < 0.0001) continue;
      _c.copy(e.pos).project(camera);
      const cx = _c.x * 0.5 + 0.5;
      const cy = (1 - _c.y) * 0.5; // y-down
      _up.copy(e.pos);
      _up.y += e.r;
      _up.project(camera);
      const rad = Math.abs((1 - _up.y) * 0.5 - cy);
      const dist = Math.hypot((cx - tgt.x) * ax, (cy - tgt.y) * ay);
      if (dist < rad * 1.1 && dist < bestDist) {
        best = i;
        bestDist = dist;
        bx = cx;
        by = cy;
        brad = rad;
      }
    }
    const hugTarget = best >= 0 && tgt.active ? 1 : 0;
    const curHug = mat.uniforms.uHugStrength.value as number;
    const hugCenter = mat.uniforms.uHugCenter.value as THREE.Vector2;
    if (best >= 0) {
      const radT = brad * 1.12;
      if (curHug < 0.02) {
        hugCenter.set(bx, by);
        mat.uniforms.uHugRadius.value = radT;
      } else {
        const kc = 1 - Math.exp(-dtc * 14);
        hugCenter.x += (bx - hugCenter.x) * kc;
        hugCenter.y += (by - hugCenter.y) * kc;
        mat.uniforms.uHugRadius.value +=
          (radT - (mat.uniforms.uHugRadius.value as number)) * kc;
      }
    } else {
      // Releasing (cursor left every object): let the fading hug follow the
      // cursor instead of clinging to the object you just left, so it visibly
      // lets go the instant you move off rather than sitting stuck on the shape.
      const kr = 1 - Math.exp(-dtc * 10);
      hugCenter.x += (tgt.x - hugCenter.x) * kr;
      hugCenter.y += (tgt.y - hugCenter.y) * kr;
    }
    // Release ~2.5× faster than before (7 -> 18) so the hug snaps off the moment
    // the cursor leaves, instead of lingering for ~0.4s.
    const hk = 1 - Math.exp(-dtc * (hugTarget > 0 ? 12 : 18));
    mat.uniforms.uHugStrength.value += (hugTarget - curHug) * hk;
  });

  return (
    <mesh ref={meshRef} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        transparent
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
