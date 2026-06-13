import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// Plane lives in front of camera's far-from-model side, oriented to
// face the camera. Distance is measured along the camera's view
// direction so the plane is perpendicular to view and reads as a
// flat backdrop. Each frame we re-position + re-scale to track the
// camera (handles off-axis camera angles + canvas resize).
//
// 4 → 12: at the old 4-unit distance, the keypad's fitted bounding
// sphere radius (~1.77 world units) left only ~2.2 units of clearance
// behind the model. Close enough that the rice-dot plane read as
// "stuck to" the keypad rather than a backdrop, and parts of the
// model's outer geometry (the protruding side buttons + dial)
// approached the plane closely enough that the user reported it as
// looking like the keypad was clipping through. 12 puts a clear
// depth gap between the model and the backdrop. The plane auto-
// rescales to fill the camera frustum at its new distance (see
// useFrame below) so the rice-dot density on screen is unchanged,
// and 12 + camera distance ~6.7 = 18.7 from camera, well within the
// 50-unit far plane.
const PLANE_DISTANCE_BEHIND_TARGET = 12;

// Module-scope scratch vectors: reused every frame instead of allocating
// inside useFrame.  OLD: 2 Vector3 allocs/frame.  NEW: O(1) space, 0 allocs.
const _camDir = new THREE.Vector3();
const _planePos = new THREE.Vector3();

/**
 * Backdrop for the keypad section: a large plane behind the model,
 * rendered with a custom shader. Default state is the section's
 * near-white bg. Rice grains only appear inside a soft, noise-warped
 * blob centred on the cursor, feels like wet rice pooling around
 * where the user is pointing. Inverse of the room's GroundPlane
 * (rice everywhere, dissolves AT the cursor) so this section reads
 * as a different spatial register.
 *
 * The plane is sized to overshoot the camera frustum at its z depth,
 * so we don't need exact frustum math.
 */

// Elevated tone (= --bg-elevated #f7f8fa, same as the trophy room /
// bp section bg per user direction, so the white transition banner
// reads as a bright band framed by two identical tones). This shader
// is the full-screen backdrop BEHIND the keypad, so it overrides the
// CSS section bg and must stay in sync with keypad.css. Canvas
// shaders can't read CSS vars, so the token value is inlined.
const BG_COLOR = "#f7f8fa";
// Cool neutral grey rice (was #C4C4C4 warm-neutral), nudged toward the
// cool stack so the grain doesn't warm the backdrop.
const RICE_COLOR = "#c3c6cc";
// Brand orange. Painted in the SAME shader as the rice (not a separate
// transparent plane) so it composites correctly behind the keypad.
// three.js puts transparent objects after all opaque ones regardless
// of renderOrder, so a separate transparent glow layer ended up
// drawing OVER the keypad keys. Living in this shader, the glow is
// part of the opaque backdrop pass and the keypad's depth-tested
// materials cover it as expected.
// Brand orange (= --accent #e87040). Was #FFA700, a warm amber/yellow
// that read off-brand + warm against the cool palette. The brand orange
// keeps the rice-pool glow cohesive with every other accent on the site.
const GLOW_COLOR = "#e87040";

// Larger, more legible rice grains. Fewer cells (so each cell is
// bigger) + larger fill fraction (so each dot fills more of its
// cell). Earlier 220 / 0.06 read as faint dotted noise; 110 / 0.13
// reads as clearly visible rice grains.
const GRID_COUNT = 110;
const DOT_RADIUS = 0.13;

// Blob radius / feather in aspect-corrected UV space. Bumped 1.2x
// from 0.13 → 0.156 (and feather proportionally) per user feedback;
// the rice pool reads bigger on screen, easier to spot under the cursor.
const BLOB_RADIUS = 0.156;
const BLOB_FEATHER = 0.096;

// rAF damping rate for cursor follow. Was 11.0 (~91ms time constant)
// which left a perceptible "rice still catching up" lag after the
// cursor stopped. The blob centroid sat noticeably behind the orange
// ring on quick flicks. Bumped to 35 (~29ms time constant) so the blob
// is visually pinned to the cursor while still being lerped (the
// project's "never bind a uniform directly to a per-event value" rule
// still applies). At 35, two-three frames after a pointer event the
// blob is >95% of the way to the new cursor position, fast enough
// that the lag is below human perceptual threshold for static targets.
const CURSOR_LERP_RATE = 35.0;

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
  uniform vec3 uGlow;
  uniform float uActive;
  uniform float uGlowOpacity;
  // Interaction shockwaves: up to 3 CONCURRENT ripples (ring buffer;
  // rapid presses each spawn their own wave instead of restarting the
  // last one). Per slot: x = age in seconds (-1 = idle), yz = origin
  // in canvas UV; strength in the matching uPulseStr slot.
  uniform vec3 uPulses[3];
  uniform float uPulseStr[3];
  // 0..1: cursor is over an interactive part (cap/dial); the rice pool
  // charges orange while hot.
  uniform float uHot;

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

    // Aspect-corrected grid: uses uAspect so cells stay square.
    vec2 gridUv = vec2(uv.x * uAspect.x, uv.y * uAspect.y);
    vec2 cellId = floor(gridUv * uGridCount);
    vec2 cell = fract(gridUv * uGridCount) - 0.5;

    // ----- Interaction shockwaves (cell-quantized) -----
    // Evaluated at the CELL CENTER so the wavefront lights whole rice
    // grains - the field itself reacting - rather than sweeping a
    // smooth elliptical gradient over it (the "cheap gradient ring"
    // the user flagged). The profile is a wave, not a Gaussian: sharp
    // leading edge, exponential wake trailing behind, with a per-cell
    // shimmer so the wake sparkles grain by grain.
    vec2 cellCenter = (cellId + 0.5) / uGridCount;
    float wave = 0.0;
    for (int i = 0; i < 3; i++) {
      if (uPulses[i].x < 0.0) continue;
      float age = uPulses[i].x;
      vec2 pc = cellCenter - uPulses[i].yz * uAspect;
      float front = age * 1.5 - length(pc);
      float w = smoothstep(-0.022, 0.01, front) * exp(-max(front, 0.0) * 7.0);
      wave += w * exp(-age * 2.8) * uPulseStr[i];
    }
    wave *= 0.8 + 0.4 * hash21(cellId);
    // Gated by the reveal opacity like the glow, so pre-landing
    // presses stay invisible.
    wave = clamp(wave, 0.0, 1.25) * uGlowOpacity;

    // Grains SWELL under the wavefront: the dot radius itself grows,
    // so the wave physically displaces the field instead of just
    // tinting it.
    float dotR = uDotRadius * (1.0 + wave * 0.55);
    float dotMask = 1.0 - smoothstep(
      dotR - 0.02,
      dotR + 0.02,
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

    // Grain drift inside the blob: second noise modulates dot alpha
    // so individual grains seem to flow. Higher floor (0.75 vs 0.55)
    // so grains stay solid most of the time and only subtly fade in
    // and out as the noise field passes over them.
    float drift = 0.75 + 0.25 * noise2(gridUv * 6.0 + uTime * 0.6);

    // Final alpha mult clamped to 1 so we don't extrapolate past
    // the rice color in mix(). 1.1 floor keeps the centers of dots
    // fully solid (mix.t == 1 hits pure rice color). The wave term
    // REVEALS grains along the front independently of the cursor
    // blob, so a ripple crossing empty field lights the grains it
    // passes (works on touch devices with no hover cursor too).
    float a = clamp(dotMask * (blob * drift * 1.1 + wave * 0.9), 0.0, 1.0);

    // ----- Orange fluid glow -----
    // Three large overlapping blobs anchored near canvas center, each
    // drifting around its rest position via slow noise. Motion is
    // intentionally just-barely-perceptible: at t-rate 0.03 the
    // centers shift ~50px over a 10s observation. Stare and you can
    // see it; glance and it reads as static.
    float gt = uTime * 0.03;
    vec2 g1 = vec2(0.42, 0.52) + 0.04 * vec2(
      noise2(vec2(gt, 0.0)) - 0.5,
      noise2(vec2(0.0, gt)) - 0.5
    );
    vec2 g2 = vec2(0.58, 0.48) + 0.04 * vec2(
      noise2(vec2(gt + 17.0, 0.0)) - 0.5,
      noise2(vec2(0.0, gt + 17.0)) - 0.5
    );
    vec2 g3 = vec2(0.50, 0.55) + 0.04 * vec2(
      noise2(vec2(gt + 31.0, 0.0)) - 0.5,
      noise2(vec2(0.0, gt + 31.0)) - 0.5
    );
    // pow(1 - d/r, 1.5) gives a smooth shoulder without a hard edge.
    // Big radii in aspect-corrected UV so the blobs overlap heavily.
    // the "fluid" feel comes from the union of three sources, not from
    // any single one being visible as a discrete circle.
    float gi1 = pow(max(0.0, 1.0 - length((uv - g1) * uAspect) / 0.45), 1.5);
    float gi2 = pow(max(0.0, 1.0 - length((uv - g2) * uAspect) / 0.42), 1.5);
    float gi3 = pow(max(0.0, 1.0 - length((uv - g3) * uAspect) / 0.50), 1.5);
    float glow = max(max(gi1, gi2), gi3);
    // Imperceptible "breathing" of the overall intensity. Couples the
    // three blobs into a single field that gently swells/recedes.
    glow *= 0.92 + 0.08 * noise2(vec2(gt * 0.7 + 5.0, 0.0));
    // Cap so the glow tints the bg without ever fully overwriting it
    // Even at peak intensity the section still reads as light grey
    // with an orange wash, not pure orange. Toned 0.45 → 0.30 so that,
    // now the colour is encoded correctly (see colorspace_fragment
    // below), the TRUE brand orange reads as a refined halo behind the
    // keypad rather than a broad wash competing with the cool palette.
    glow = clamp(glow * 0.30, 0.0, 0.30);
    // Multiply by external reveal opacity (driven from KeypadScene
    // → ref → useFrame). 0 = no glow at all, 1 = full glow. Lets
    // Keypad.tsx hide the orange wash until AFTER the keypad's
    // drop-in animation completes. Without this gate, the orange
    // backdrop appeared before any keypad was visible, making the
    // scene look unfinished.
    glow *= uGlowOpacity;

    // Shockwave energy joins the same glow field (computed above,
    // cell-quantized, already gated by uGlowOpacity).
    glow += wave * 0.38;
    // ----- Hot-cursor charge -----
    // While hovering an interactive part, the rice pool itself charges
    // toward the accent: the cursor feels electric exactly where the
    // device can be touched.
    glow += (1.0 - smoothstep(0.0, uBlobRadius * 1.9, dist))
      * uHot * 0.25 * uActive * uGlowOpacity;
    glow = clamp(glow, 0.0, 0.62);

    // Composite: orange tint first, then rice grains on top of the
    // tinted bg (so dots remain crisp gray over the orange field).
    // Grains caught in a wave warm toward the accent, so the ripple
    // reads as energy passing THROUGH the grains, not under them.
    vec3 tintedBg = mix(uBg, uGlow, glow);
    vec3 grain = mix(uRice, uGlow, clamp(wave * 0.55, 0.0, 0.55));
    vec3 col = mix(tintedBg, grain, a);
    gl_FragColor = vec4(col, 1.0);
    // COLOUR-COORDINATION FIX (user-flagged "messy / pink, not
    // coordinated"): this raw ShaderMaterial wrote its mixed colour
    // straight to gl_FragColor with NO output-colorspace encode. Three's
    // ColorManagement is on, so the uniform colours (uBg/uRice/uGlow) are
    // LINEAR. Writing them un-encoded made the grey render DARKER than
    // the CSS #eef0f3 of every neighbouring section, and the orange-over-
    // grey mix came out as an off-palette PINK/SALMON field. Encoding to
    // the renderer's output colorspace (sRGB) via three's chunk makes the
    // backdrop grey match its neighbours exactly and renders the glow as
    // the TRUE brand orange, coordinated with the rest of the site.
    #include <colorspace_fragment>
  }
`;

interface CursorState {
  x: number;
  y: number;
  active: boolean;
}

/** One interaction ripple: start = performance.now() stamp (-1 idle),
 *  origin in canvas UV. */
export interface RicePulse {
  start: number;
  strength: number;
  x: number;
  y: number;
}

/** Ring buffer of concurrent ripples. Rapid presses each take their
 *  own slot, so an in-flight wave always completes instead of being
 *  restarted from the middle (the spam-click bug). With PULSE_SLOTS
 *  waves at ~1.4s life, stealing a live slot needs >2 clicks/s
 *  sustained, and the stolen slot is always the most-faded one. */
export const PULSE_SLOTS = 3;
export interface PulseChannel {
  slots: RicePulse[];
  next: number;
  lastAt: number;
}

export function createPulseChannel(): PulseChannel {
  return {
    slots: Array.from({ length: PULSE_SLOTS }, () => ({
      start: -1,
      strength: 0,
      x: 0.5,
      y: 0.5,
    })),
    next: 0,
    lastAt: 0,
  };
}

/** Stamp a new ripple into the channel's next slot (round-robin).
 *  Presses within 70ms collapse into one wave: a single gesture can
 *  emit pointer + synthetic events back-to-back, and two waves born
 *  one frame apart read as a glitch, not as two ripples. */
export function stampRicePulse(
  ch: PulseChannel,
  strength: number,
  x: number,
  y: number,
) {
  const now = performance.now();
  if (now - ch.lastAt < 70) return;
  ch.lastAt = now;
  const slot = ch.slots[ch.next]!;
  slot.start = now;
  slot.strength = strength;
  slot.x = x;
  slot.y = y;
  ch.next = (ch.next + 1) % PULSE_SLOTS;
}

interface Props {
  cursorRef: React.MutableRefObject<CursorState>;
  /** 0..1 target glow opacity. The shader uniform lerps toward this
   *  each frame for a soft fade. Keypad.tsx ramps this from 0 to
   *  1 once the keypad's drop-in animation has finished. */
  glowOpacityRef?: React.MutableRefObject<number>;
  /** Concurrent interaction ripples (landing thud / cap press / dial
   *  spin). Stamp via stampRicePulse. */
  pulsesRef?: React.MutableRefObject<PulseChannel>;
  /** Cursor currently over an interactive part (cap/dial). */
  hotRef?: React.MutableRefObject<boolean>;
}

export function RiceBlob({ cursorRef, glowOpacityRef, pulsesRef, hotRef }: Props) {
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
      uGlow: { value: new THREE.Color(GLOW_COLOR) },
      uActive: { value: 0 },
      uGlowOpacity: { value: 0 },
      uPulses: {
        value: Array.from(
          { length: PULSE_SLOTS },
          () => new THREE.Vector3(-1, 0.5, 0.5),
        ),
      },
      uPulseStr: { value: new Array(PULSE_SLOTS).fill(0) },
      uHot: { value: 0 },
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
      pc.getWorldDirection(_camDir);
      // World-origin is the scene's lookAt (KeypadModel recenters the
      // model centroid there). Plane sits behind it along camDir.
      _planePos.copy(_camDir).multiplyScalar(PLANE_DISTANCE_BEHIND_TARGET);
      mesh.position.copy(_planePos);
      mesh.lookAt(pc.position);
      // Visible size of the plane at its distance from the camera.
      const distFromCam = pc.position.distanceTo(_planePos);
      const h =
        2 * Math.tan(THREE.MathUtils.degToRad(pc.fov / 2)) * distFromCam;
      const w = h * (size.width / size.height);
      mesh.scale.set(w / 24, h / 16, 1);
    }
    mat.uniforms.uTime.value = (performance.now() - startMs) / 1000;

    // Fixed-rate lerp toward cursor target; never bind a uniform
    // directly to a per-event value.
    const uv = mat.uniforms.uCursor.value as THREE.Vector2;
    const t = cursorRef.current;
    const k = 1 - Math.exp(-dt * CURSOR_LERP_RATE);
    uv.x += (t.x - uv.x) * k;
    uv.y += (t.y - uv.y) * k;
    mat.uniforms.uActive.value += (
      (t.active ? 1 : 0) - mat.uniforms.uActive.value
    ) * k;
    // Soft lerp toward target glow opacity. Slower coefficient than
    // the cursor-active follow so the fade-in reads as deliberate
    // rather than a snap.
    const targetGlow = glowOpacityRef?.current ?? 1;
    const glowK = 1 - Math.exp(-dt * 2.2);
    mat.uniforms.uGlowOpacity.value +=
      (targetGlow - mat.uniforms.uGlowOpacity.value) * glowK;

    // Interaction ripples: ages computed here from the stamped
    // wall-clocks so each wave expands at a fixed real-time rate;
    // a slot expires after its wave has fully decayed (~1.4s).
    const ch = pulsesRef?.current;
    const uPulses = mat.uniforms.uPulses.value as THREE.Vector3[];
    const uStr = mat.uniforms.uPulseStr.value as number[];
    for (let i = 0; i < PULSE_SLOTS; i++) {
      const p = ch?.slots[i];
      if (p && p.start > 0) {
        const age = (performance.now() - p.start) / 1000;
        if (age < 1.4) {
          uPulses[i]!.set(age, p.x, p.y);
          uStr[i] = p.strength;
          continue;
        }
      }
      uPulses[i]!.x = -1;
      uStr[i] = 0;
    }
    // Hot-cursor charge eases in/out (never bound directly to the
    // event, per the fixed-rate rule).
    const hotK = 1 - Math.exp(-dt * 10);
    mat.uniforms.uHot.value +=
      ((hotRef?.current ? 1 : 0) - mat.uniforms.uHot.value) * hotK;
  });

  // Base geometry (24, 16): useFrame above repositions, orients,
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
