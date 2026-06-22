import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { blobRiceColor, blobBgColor, BLOB_COMPOSITE_GLSL } from "../cursorBlob";

/**
 * Keypad cursor pool — a FAITHFUL PORT of the jump-menu cursor effect
 * (src/MercuryAura.tsx), so the keypad blob reads EXACTLY like the jump menu:
 *
 *   - a faint International-Orange rice DOT FIELD across the whole backdrop,
 *   - a lagging metaball TRAIL that lights the rice bright orange where the
 *     cursor pools (the grains pop via OPACITY, not a warmer hue),
 *   - a thin orange MEMBRANE ring outlining the pool.
 *
 * Honest screen-space SDF (polynomial smin) — no gradient overlays, no filled
 * dome, no warm tints, no hover charge. sRGB-encoded (ColorManagement is on, so
 * the THREE.Color uniforms are linear; the `colorspace_fragment` chunk encodes
 * the output — it is a no-op into the RipplePost linear FBO, which then does the
 * sRGB encode, so the result matches the jump menu's direct-to-canvas path).
 *
 * Two things differ from MercuryAura, both invisible:
 *   1. The plane is OPAQUE and paints the page tone (--bg-page) before the rice,
 *      so the RipplePost FBO pass has a solid backdrop to refract (the jump menu
 *      draws transparent rice over its own scrim instead — same on-screen look).
 *   2. The plane is re-fitted to the camera frustum every frame, because the
 *      keypad camera looks at the model off-axis; this keeps cursor canvas-UV
 *      mapping 1:1 onto the screen-aligned plane.
 *
 * `glowOpacityRef` gates the reveal so the field doesn't appear behind an empty
 * section before the keypad drops in.
 */

// Rice colour (= --accent) and the backdrop it composites over (= --bg-page)
// both come from the shared cursorBlob module (src/cursorBlob.ts) so the keypad
// + jump-menu blobs stay in sync and can't drift. The behind-keypad glow is
// carried by bright orange DOTS (a smooth grey->orange wash on the light bg goes
// salmon), so there is no separate glow colour — the dots use the rice colour.
// Behind-keypad orange halo. Pushed bigger + brighter (user: make the glow more
// enhanced / popped, give it the "wow"): radius 0.8→1.05 spreads it wider around
// the device; strength 1.5→2.5 drives more dots to full #ff4f00 coverage so the
// centre reads as a rich saturated bloom, not a faint wash. Still DOT-coverage
// (not a smooth gradient), so it stays International Orange and never slides to
// salmon (see the colour-trap note in the shader below).
const GLOW_RADIUS = 1.05; // radial size, aspect-corrected screen units
const GLOW_STRENGTH = 2.5; // centre brightness

// MercuryAura parameters, verbatim, so the look matches the jump menu exactly.
const GRID_COUNT = 96; // rice density
const DOT_RADIUS = 0.14; // grain size within a cell
const POOL_RADIUS = 0.07; // head ball radius (screen-height units)
// Metaballs in the liquid trail. This is the dominant per-pixel cost: the
// fragment loops TRAIL_N times, each iteration running a value-noise wobble
// (4 hashes) + an smin. On desktop it stays at the MercuryAura-matching 10.
// PERF (mobile): halved to 5 — the trail is a thin orange membrane chasing
// the cursor; on touch there is no cursor at all (the field is the static
// orange wash + the centre glow), so the trail is barely exercised. Halving
// the loop ~halves the fragment shader's noise cost across the whole plane.
const TRAIL_N_DESKTOP = 10;
const TRAIL_N_MOBILE = 5;
// Mobile renders the field at fewer noise octaves overall: the centre-glow
// "drift" shimmer and the lit-grain shimmer (each a noise2 call per pixel)
// are dropped to a constant. The static orange wash reads the same.

// Backdrop plane sits this far behind the model (origin) along the view dir, so
// it reads as a flat backdrop with a clear depth gap from the keypad.
const PLANE_DISTANCE_BEHIND_TARGET = 12;

// Module-scope scratch (no per-frame allocation).
const _camDir = new THREE.Vector3();
const _planePos = new THREE.Vector3();

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Shader is built per-quality so TRAIL_N (the dominant per-pixel loop count)
// is a compile-time constant, and the mobile variant additionally drops the
// per-pixel value-noise shimmer (centre-wander, breath, grain drift) to cheap
// constants. The on-screen read of the STATIC orange wash is unchanged; only
// the (subtle, animated) shimmer is sacrificed where the GPU budget is tight.
function buildFragment(trailN: number, mobile: boolean): string {
  // Drift / glow-centre / breath: on mobile these collapse to constants so the
  // fragment runs zero value-noise calls for the ambient wash. On desktop they
  // keep the live shimmer (verbatim MercuryAura behaviour).
  const driftExpr = mobile
    ? "1.0"
    : "0.78 + 0.22 * noise2(g * 5.0 + vec2(uTime * 0.6, 0.0))";
  const glowCentreExpr = mobile
    ? "vec2(0.5, 0.5)"
    : `vec2(0.5, 0.5) + 0.09 * (vec2(
        noise2(vec2(uTime * 0.045, 11.3)),
        noise2(vec2(uTime * 0.045, 27.7))
      ) * 2.0 - 1.0)`;
  const breathExpr = mobile ? "1.0" : "0.9 + 0.1 * noise2(vec2(uTime * 0.07, 5.0))";
  // Trail wobble: the in-loop noise2 is the single biggest cost. Drop it on
  // mobile (the trail is unused on touch — no cursor) so each iteration is just
  // a length + smin.
  const wobExpr = mobile
    ? "0.0"
    : "(noise2(dir * 1.7 + vec2(uTime * 0.45, fi * 4.0)) - 0.5) * 0.02";
  return /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uTrail[${trailN}]; // [0] = head, 0..1 y-down
  uniform float uActive;  // 0..1 cursor present
  uniform float uTime;
  uniform vec2 uAspect;   // (W/H,1) landscape / (1,H/W) portrait
  uniform vec3 uBg;
  uniform vec3 uRice;
  uniform vec3 uRiceHot;
  uniform float uGrid;
  uniform float uDot;
  uniform float uPoolR;
  uniform float uReveal;       // glow fade-in gate 0..1
  uniform float uGlowRadius;   // radial size of the glow
  uniform float uGlowStrength; // glow intensity

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
    for (int i = 0; i < ${trailN}; i++) {
      float fi = float(i) / float(${trailN});
      vec2 d = (uv - uTrail[i]) * uAspect;
      vec2 dir = normalize(d + vec2(1e-4));
      float wob = ${wobExpr};
      float r = uPoolR * (1.0 - fi * 0.45) + wob;
      sd = sunion(sd, length(d) - r, k);
    }

    float inside = smoothstep(0.006, -0.006, sd);          // 1 inside the pool
    float ring = (1.0 - smoothstep(0.0, 0.009, abs(sd))) * uActive; // membrane

    // Rice: faint everywhere; lit bright where the pool passes over it. A slow
    // noise drift makes the lit grains shimmer like wet rice (constant on mobile).
    float drift = ${driftExpr};
    float lit = grain * inside * uActive * drift;

    vec3 rice = mix(uRice, uRiceHot, inside);

    // ORANGE GLOW behind the keypad — a radial of bright orange rice dots with a
    // STEEP drop-off (pow 3) so the centre glows and the far edges fade to (near)
    // TRANSPARENT — a strong vignette (user direction). It reads as SATURATED
    // orange because the dots reach high coverage (near-pure #ff4f00); a smooth
    // grey->orange WASH on the light bg goes salmon/pink (the colour trap). There
    // is NO uniform field floor any more — the corners are clear; the rice lives
    // in the centre. The centre slowly WANDERS + breathes (low-freq value noise)
    // so the glow feels alive + organic (static on mobile). The keypad model
    // occludes the centre, so it reads as a warm orange halo around the device.
    vec2 gc = ${glowCentreExpr};
    float gbreath = ${breathExpr};
    float gd = length((uv - gc) * uAspect);
    // Falloff widened 3.0→2.4: a touch less pinpoint so the saturated core blooms
    // into a fuller halo around the device (still a vignette — the edges fade to
    // clear, the dots keep it orange-not-salmon).
    float glow = pow(max(0.0, 1.0 - gd / uGlowRadius), 2.4) * uGlowStrength * gbreath;
    float glowLit = grain * glow * drift; // bright orange dots, centre-concentrated

    // Centre glow + the cursor pool's lit dots + the membrane (the cursor blob
    // works anywhere; only the ambient glow is centre-concentrated), composited
    // over the page tone. uReveal fades it in after the drop.
    float a = clamp((lit + glowLit) * 0.95 + ring * 0.9, 0.0, 1.0) * uReveal;
    gl_FragColor = vec4(blobComposite(uBg, rice, a), 1.0);
    #include <colorspace_fragment>
  }
`;
}

interface CursorState {
  x: number;
  y: number;
  active: boolean;
}

interface Props {
  cursorRef: React.MutableRefObject<CursorState>;
  /** 0..1 target reveal. The shader lerps toward this each frame so the rice
   *  fades in only after the keypad's drop-in animation completes. */
  glowOpacityRef?: React.MutableRefObject<number>;
  /** PERF: phones build a cheaper shader (shorter trail loop, no per-pixel
   *  value-noise shimmer). The static orange wash reads the same. */
  isMobile?: boolean;
}

export function RiceBlob({ cursorRef, glowOpacityRef, isMobile = false }: Props) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const { size, camera } = useThree();
  const startMs = useMemo(() => performance.now(), []);

  // Quality is fixed at mount (the breakpoint flip remounts KeypadScene's
  // canvas tree anyway, so isMobile can't change under a live RiceBlob).
  const trailN = isMobile ? TRAIL_N_MOBILE : TRAIL_N_DESKTOP;
  const fragment = useMemo(
    () => buildFragment(trailN, isMobile),
    [trailN, isMobile],
  );

  const uniforms = useMemo(
    () => ({
      uTrail: {
        value: Array.from({ length: trailN }, () => new THREE.Vector2(0.5, 0.5)),
      },
      uActive: { value: 0 },
      uTime: { value: 0 },
      uAspect: { value: new THREE.Vector2(1, 1) },
      uBg: { value: blobBgColor() },
      uRice: { value: blobRiceColor() },
      uRiceHot: { value: blobRiceColor() },
      uGrid: { value: GRID_COUNT },
      uDot: { value: DOT_RADIUS },
      uPoolR: { value: POOL_RADIUS },
      uReveal: { value: 0 },
      uGlowRadius: { value: GLOW_RADIUS },
      uGlowStrength: { value: GLOW_STRENGTH },
    }),
    [trailN],
  );

  // Click PUNCH: a keypad interaction (cap or dial-knob press dispatches the
  // "keypad-interact" event) briefly SWELLS + brightens the blob, so the cursor
  // blob itself visibly reacts to a click — not just the background ripple. The
  // punch decays in useFrame. Skipped under reduced motion.
  const punchRef = useRef(0);
  useEffect(() => {
    const onInteract = (e: Event) => {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      const s = (e as CustomEvent<{ strength?: number }>).detail?.strength ?? 1;
      punchRef.current = Math.min(1.5, punchRef.current + s);
    };
    window.addEventListener("keypad-interact", onInteract);
    return () => window.removeEventListener("keypad-interact", onInteract);
  }, []);

  useFrame((_, dt) => {
    const mat = matRef.current;
    const mesh = meshRef.current;
    if (!mat || !mesh) return;
    const dtc = Math.min(dt, 0.05);

    // Aspect (longer axis = 1), matching MercuryAura.
    const aspect = mat.uniforms.uAspect.value as THREE.Vector2;
    if (size.width >= size.height) aspect.set(size.width / size.height, 1);
    else aspect.set(1, size.height / size.width);

    // Fit the plane to the camera frustum as a screen-aligned backdrop (the
    // keypad camera looks at the model off-axis), so cursor canvas-UV maps 1:1.
    const pc = camera as THREE.PerspectiveCamera;
    if (pc.isPerspectiveCamera) {
      pc.getWorldDirection(_camDir);
      _planePos.copy(_camDir).multiplyScalar(PLANE_DISTANCE_BEHIND_TARGET);
      mesh.position.copy(_planePos);
      mesh.lookAt(pc.position);
      const distFromCam = pc.position.distanceTo(_planePos);
      const h =
        2 * Math.tan(THREE.MathUtils.degToRad(pc.fov / 2)) * distFromCam;
      const w = h * (size.width / size.height);
      mesh.scale.set(w / 24, h / 16, 1);
    }

    mat.uniforms.uTime.value = (performance.now() - startMs) / 1000;

    // ── Cursor TRAIL update — identical to MercuryAura ──────────────────
    const tgt = cursorRef.current;
    const trail = mat.uniforms.uTrail.value as THREE.Vector2[];
    const active = mat.uniforms.uActive.value as number;
    // Snap the rope onto the cursor while invisible so it forms AT the cursor
    // instead of flying in from the centre on first appearance.
    if (active < 0.02) {
      for (let i = 0; i < trail.length; i++) trail[i]!.set(tgt.x, tgt.y);
    } else {
      const head = trail[0]!;
      const kHead = 1 - Math.exp(-dtc * 32);
      head.x += (tgt.x - head.x) * kHead;
      head.y += (tgt.y - head.y) * kHead;
      const kChain = 1 - Math.exp(-dtc * 26);
      const MAX_GAP = 0.03;
      for (let i = 1; i < trail.length; i++) {
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

    // Reveal fade-in (driven by Keypad.tsx once the drop-in completes).
    const targetReveal = glowOpacityRef?.current ?? 1;
    const rk = 1 - Math.exp(-dt * 2.2);
    mat.uniforms.uReveal.value +=
      (targetReveal - (mat.uniforms.uReveal.value as number)) * rk;

    // Click punch: decay toward 0, swelling the glow radius + strength while it
    // rings out so a press reads as the blob reacting under the cursor.
    const punch = punchRef.current;
    punchRef.current = punch > 0.001 ? punch * Math.exp(-dtc * 4.5) : 0;
    mat.uniforms.uGlowStrength.value = GLOW_STRENGTH * (1 + punch * 0.85);
    mat.uniforms.uGlowRadius.value = GLOW_RADIUS * (1 + punch * 0.4);
  });

  // planeGeometry(24, 16): useFrame repositions/orients/scales it each frame to
  // a screen-aligned backdrop. renderOrder -1 + depthTest off keeps it behind
  // the keypad's depth-tested materials.
  return (
    // key on trailN: if the breakpoint flips while mounted, React remounts the
    // mesh so a fresh ShaderMaterial compiles with the new fragment + a matched
    // uTrail array length (R3F's <shaderMaterial> won't recompile a swapped
    // fragmentShader prop in place).
    <mesh key={trailN} ref={meshRef} renderOrder={-1}>
      <planeGeometry args={[24, 16]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={fragment}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}
