import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  blobRiceColor,
  blobBgColor,
  BLOB_COMPOSITE_GLSL,
  advanceCursorTrail,
} from "./cursorBlob";

/**
 * CURSOR RICE POOL + VENOM HUG — the spill menu's liquid cursor effect.
 *
 * Two coupled behaviours in one screen-space metaball field:
 *  1) A mercury TRAIL follows the cursor (lagging metaball rope, like the
 *     keypad RiceBlob) that lights up the faint orange background rice and
 *     draws a thin membrane outline. No filled glow disc.
 *  2) A VENOM HUG: when the cursor is over a 3D object, the liquid wraps that
 *     object's ACTUAL SILHOUETTE (not a circle around it). The hovered mesh is
 *     drawn flat into a small offscreen mask, gaussian-blurred, and the blurred
 *     field is thresholded into a soft-edged SDF a margin outside the outline.
 *     It SMOOTH-UNIONS into the trail, so the liquid reaches out from the
 *     cursor and shrink-wraps the shape like a symbiote, filling its small
 *     gaps (trophy handles, the camera lens) — then releases when you move away.
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
// Silhouette mask for the hug: rendered at 1/MASK_DOWN of the drawing buffer,
// then blurred. HUG_SIGMA (screen-height units) sets how far outside the
// outline the liquid sits and how rounded its corners are; HUG_T is the
// blurred-mask level the membrane follows (lower = looser wrap).
const MASK_DOWN = 6;
const HUG_SIGMA = 0.026;
const HUG_T = 0.2;
const BLUR_TAPS = 8; // per side, per pass (17-tap separable gaussian)

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
  uniform sampler2D uHugMap; // blurred silhouette field of the hugged object(s)
  uniform float uHugOn;       // 0/1: any object currently (un)wrapping
  uniform float uHugScale;    // field -> screen-height distance

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

    // VENOM HUG: the liquid shrink-wraps the hovered object's silhouette.
    // uHugMap holds max(weight_i * mask_i) blurred, so each object's contour
    // GROWS out of its core as its weight rises and sinks back into it on
    // release; two neighbours crossfade (and briefly merge) when you slide
    // from one to the next. The field's level set at HUG_T sits a margin
    // outside the outline; scaled by the blur width it reads as a distance,
    // so it smooth-unions with the trail like any other metaball. A little
    // slow noise keeps the membrane liquid instead of a traced outline.
    if (uHugOn > 0.5) {
      float field = texture2D(uHugMap, vUv).r;
      float hwob = (noise2(g * 7.0 + vec2(uTime * 0.5, 7.0)) - 0.5) * 0.012;
      float sh = (${HUG_T.toFixed(3)} - field) * uHugScale + hwob;
      sd = sunion(sd, sh, 0.05);
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
  /** The object's visible mesh, drawn flat into the hug silhouette mask. */
  mesh?: THREE.Mesh | null;
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
const _clear = new THREE.Color();
const _buf = new THREE.Vector2();

// Fullscreen-pass plumbing for the hug mask blur.
const BLUR_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uSrc;
  uniform vec2 uStep;   // one texel along the blur axis
  uniform float uSigma; // in texels
  void main() {
    float acc = 0.0;
    float wsum = 0.0;
    for (int i = -${BLUR_TAPS}; i <= ${BLUR_TAPS}; i++) {
      float fi = float(i);
      float w = exp(-fi * fi / (2.0 * uSigma * uSigma));
      acc += texture2D(uSrc, vUv + uStep * fi).r * w;
      wsum += w;
    }
    gl_FragColor = vec4(acc / wsum, 0.0, 0.0, 1.0);
  }
`;

/** Max-blended flat silhouette: each hugged object writes its hug weight. */
function makeMaskMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    toneMapped: false,
  });
}

interface HugRig {
  maskScene: THREE.Scene;
  proxies: THREE.Mesh[];
  rtA: THREE.WebGLRenderTarget;
  rtB: THREE.WebGLRenderTarget;
  blurScene: THREE.Scene;
  blurCam: THREE.OrthographicCamera;
  blurMat: THREE.ShaderMaterial;
  weights: number[];
}

function makeHugRig(): HugRig {
  const rtOpts = {
    type: THREE.HalfFloatType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  } as const;
  const blurMat = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: BLUR_FRAG,
    uniforms: {
      uSrc: { value: null },
      uStep: { value: new THREE.Vector2() },
      uSigma: { value: 4 },
    },
    depthTest: false,
    depthWrite: false,
  });
  const blurScene = new THREE.Scene();
  blurScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blurMat));
  return {
    maskScene: new THREE.Scene(),
    proxies: [],
    rtA: new THREE.WebGLRenderTarget(4, 4, rtOpts),
    rtB: new THREE.WebGLRenderTarget(4, 4, rtOpts),
    blurScene,
    blurCam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    blurMat,
    weights: [],
  };
}

export function MercuryAura({ cursorRef, positionsRef, reduced }: Props) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const { size, camera, gl } = useThree();
  const startMs = useMemo(() => performance.now(), []);
  const rig = useMemo(makeHugRig, []);
  useEffect(
    () => () => {
      rig.rtA.dispose();
      rig.rtB.dispose();
      rig.blurMat.dispose();
      for (const p of rig.proxies) (p.material as THREE.Material).dispose();
    },
    [rig],
  );

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
      uHugMap: { value: rig.rtA.texture },
      uHugOn: { value: 0 },
      uHugScale: { value: HUG_SIGMA * 3.6 }, // ~sigma / gaussian slope at HUG_T
    }),
    [rig],
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
    // Cursor TRAIL update (shared step; identical to the keypad RiceBlob).
    advanceCursorTrail(trail, tgt, active, dtc);

    const ak = 1 - Math.exp(-dtc * 8);
    mat.uniforms.uActive.value += ((tgt.active ? 1 : 0) - active) * ak;

    // VENOM HUG: find which object the CURSOR is over by screen-space proximity,
    // recomputed EVERY FRAME — so it can never get "stuck" the way the R3F
    // pointer-out events did when objects spun/dragged under the cursor. Same
    // 1.3x disc as SpillField's arming test, so the wrap and the enlarge agree.
    const ax = aspect.x;
    const ay = aspect.y;
    let best = -1;
    let bestDist = 1e9;
    const arr = positionsRef.current;
    if (tgt.active) {
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
        if (dist < rad * 1.3 && dist < bestDist) {
          best = i;
          bestDist = dist;
        }
      }
    }

    // Per-object hug weights: the hovered one grows in, the rest release
    // (release faster than grow so the liquid lets go the moment you leave).
    const w = rig.weights;
    let any = false;
    for (let i = 0; i < arr.length; i++) {
      const want = i === best ? 1 : 0;
      const cur = w[i] ?? 0;
      const k = 1 - Math.exp(-dtc * (want > cur ? 12 : 18));
      let next = cur + (want - cur) * k;
      if (next < 0.002 && want === 0) next = 0;
      w[i] = next;
      if (next > 0) any = true;
    }
    mat.uniforms.uHugOn.value = any ? 1 : 0;
    if (!any) return;

    // SILHOUETTE MASK: flat proxies of the hugged meshes (sharing their
    // geometry + world matrix) max-blend their eased weight into a small
    // target, so the field below is max_i(weight_i * mask_i).
    const buf = gl.getDrawingBufferSize(_buf);
    const mw = Math.max(8, Math.round(buf.x / MASK_DOWN));
    const mh = Math.max(8, Math.round(buf.y / MASK_DOWN));
    if (rig.rtA.width !== mw || rig.rtA.height !== mh) {
      rig.rtA.setSize(mw, mh);
      rig.rtB.setSize(mw, mh);
    }
    for (let i = 0; i < arr.length; i++) {
      let proxy = rig.proxies[i];
      if (!proxy) {
        proxy = new THREE.Mesh(undefined, makeMaskMaterial());
        proxy.matrixAutoUpdate = false;
        proxy.frustumCulled = false;
        rig.proxies[i] = proxy;
        rig.maskScene.add(proxy);
      }
      const src = arr[i]?.mesh;
      const wi = w[i] ?? 0;
      proxy.visible = !!src && wi > 0;
      if (!src || wi <= 0) continue;
      src.updateWorldMatrix(true, false);
      proxy.geometry = src.geometry;
      proxy.matrix.copy(src.matrixWorld);
      proxy.matrixWorld.copy(src.matrixWorld);
      const ew = wi * wi * (3 - 2 * wi); // smoothstep: punchy grow, soft tail
      (proxy.material as THREE.MeshBasicMaterial).color.setScalar(ew);
    }

    const prevTarget = gl.getRenderTarget();
    const prevAlpha = gl.getClearAlpha();
    gl.getClearColor(_clear);
    gl.setClearColor(0x000000, 0);
    rig.maskScene.matrixWorldAutoUpdate = false;
    gl.setRenderTarget(rig.rtA);
    gl.clear(true, false, false);
    gl.render(rig.maskScene, camera);
    // Separable gaussian, A -> B (x) -> A (y). The taps always span +-2.5
    // sigma; `spread` stretches their spacing to reach HUG_SIGMA in texels.
    const sigmaTaps = BLUR_TAPS / 2.5;
    rig.blurMat.uniforms.uSigma!.value = sigmaTaps;
    const spread = Math.max(1, (HUG_SIGMA * mh) / sigmaTaps);
    rig.blurMat.uniforms.uSrc!.value = rig.rtA.texture;
    (rig.blurMat.uniforms.uStep!.value as THREE.Vector2).set(spread / mw, 0);
    gl.setRenderTarget(rig.rtB);
    gl.render(rig.blurScene, rig.blurCam);
    rig.blurMat.uniforms.uSrc!.value = rig.rtB.texture;
    (rig.blurMat.uniforms.uStep!.value as THREE.Vector2).set(0, spread / mh);
    gl.setRenderTarget(rig.rtA);
    gl.render(rig.blurScene, rig.blurCam);
    gl.setRenderTarget(prevTarget);
    gl.setClearColor(_clear, prevAlpha);
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
