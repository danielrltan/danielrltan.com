import { useEffect, useMemo, useRef } from "react";
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
// Foreground plane sits BETWEEN the camera and the model (negative = toward
// the camera from the model centroid at origin) so the front liquid wisps
// render over the keypad.
const FRONT_PLANE_DISTANCE = -2.6;

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
// White rice grains (user). They sit on the orange fluid fill INSIDE the
// blob, so white reads as bright foam/bubbles suspended in the liquid.
const RICE_COLOR = "#ffffff";

// Number of metaballs in the cursor TRAIL. The head tracks the cursor; each
// following ball lags toward the one ahead, so the chain stretches into a
// liquid trail when you move and collapses to a single blob when you stop.
const TRAIL_N = 12;
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
// Hover-charge color: a warmer, more YELLOW amber than the brand
// orange (user: make it more yellow so it reads as a cohesive warm
// energy filling the keypad, not a hard orange blob).
const HOT_COLOR = "#f7a833";
// Rice grains invert to this light warm tone under the hover charge so
// they contrast against the amber instead of muddying (grey-on-amber
// had almost no separation).
const RICE_HOT_COLOR = "#fff4e2";

// Larger, more legible rice grains. Fewer cells (so each cell is
// bigger) + larger fill fraction (so each dot fills more of its
// cell). Earlier 220 / 0.06 read as faint dotted noise; 110 / 0.13
// reads as clearly visible rice grains.
const GRID_COUNT = 110;
const DOT_RADIUS = 0.13;

// Blob radius / feather in aspect-corrected UV space. Bumped 1.2x
// from 0.13 → 0.156 (and feather proportionally) per user feedback;
// the rice pool reads bigger on screen, easier to spot under the cursor.
// Smaller mass (was 0.156): the pool read as one big slime blob. A tighter
// radius + the filled mercury body below reads as a refined liquid droplet.
const BLOB_RADIUS = 0.112;
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
  uniform vec2 uTrail[${TRAIL_N}]; // cursor trail, [0] = head (0..1, Y-down)
  uniform vec2 uVel;      // smoothed cursor velocity (for grain drag)
  uniform vec2 uAspect;   // canvas aspect (x = width/min, y = height/min)
  uniform float uTime;
  uniform float uBlobRadius;
  uniform float uBlobFeather;
  uniform float uGridCount;
  uniform float uDotRadius;
  uniform vec3 uBg;
  uniform vec3 uRice;
  uniform vec3 uGlow;
  uniform vec3 uHotColor;   // yellow-amber hover charge
  uniform vec3 uRiceHot;    // light rice under the charge (contrast)
  uniform float uActive;
  uniform float uLayer;        // 0 = opaque backdrop, 1 = transparent front
  uniform float uFrontOpacity; // overall opacity of the front wisps
  uniform float uBurst;        // 0..1 knob-press dispersal impulse
  uniform float uGlowOpacity;
  // 0..1: cursor is over an interactive part (cap/dial); the WHOLE
  // keypad warms with a flowy yellow charge while hot.
  uniform float uHot;

  float hash21(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float h1f(float n) {
    return fract(sin(n * 91.345) * 47453.123);
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

    // Aspect-corrected grain grid, DRAGGED by cursor velocity so the grains
    // lag behind the motion (the liquid reacts to HOW you move) and settle
    // when the cursor stops. Clamped so a fast flick doesn't tear the grid.
    vec2 gdrag = clamp(uVel * 0.04, vec2(-0.05), vec2(0.05));
    vec2 gridUv = vec2((uv.x - gdrag.x) * uAspect.x, (uv.y - gdrag.y) * uAspect.y);
    vec2 cell = fract(gridUv * uGridCount) - 0.5;
    float dotMask = 1.0 - smoothstep(
      uDotRadius - 0.02,
      uDotRadius + 0.02,
      length(cell)
    );

    // ----- Liquid blob (signed-distance + smooth union) -----
    // A wobbly fluid body at the cursor PLUS an orbiting droplet that
    // smooth-merges into it - so the glob bulges, necks and floats like
    // liquid. Built from distance fields so the membrane OUTLINE is a
    // clean constant-width ring (abs(sd) band), guaranteed visible.
    float bt = uTime;
    // Liquid TRAIL: smooth-union (polynomial smin) of a chain of metaballs.
    // uTrail[0] is the cursor head; each later ball lags toward the one
    // ahead (updated in JS), so when you MOVE the cursor the chain stretches
    // into a tapering liquid trail that follows your path, and when you stop
    // it flows back together into a single blob. This is the reactivity:
    // the shape is driven by how the cursor actually moved, not a canned loop.
    // Tighter smin (mercury, not stringy slime). The MAX_GAP rope clamp
    // keeps the balls overlapping, so a smaller k stays continuous while
    // reading as a refined cohesive liquid. On knob-press the BURST drops k
    // toward a near-hard union so the body breaks into distinct droplets.
    float k = mix(0.08, 0.025, uBurst);
    float sd = 1e9;
    for (int i = 0; i < ${TRAIL_N}; i++) {
      float fi = float(i) / float(${TRAIL_N});
      vec2 pos = uTrail[i];
      // Knob-press BURST: each ball flies outward in a fixed per-ball
      // direction and shrinks, dispersing the body into smaller scattered
      // particles that flow back together as uBurst decays.
      if (uBurst > 0.001) {
        float ph = h1f(float(i) * 1.7 + 3.0) * 6.2831;
        float mag = 0.55 + 0.45 * h1f(float(i) * 2.3 + 9.0);
        pos += vec2(cos(ph), sin(ph)) * uBurst * 0.075 * mag;
      }
      vec2 d = (uv - pos) * uAspect;
      // Gentle taper toward the tail; subtle surface wobble (mercury is
      // smoother/tighter than the old wavy slime).
      float ang = atan(d.y, d.x);
      float r = (uBlobRadius * (1.0 - fi * 0.30)) * (1.0 - uBurst * 0.4)
        + sin(ang * 3.0 + bt * 1.5 - fi * 6.2) * 0.008
        + sin(ang * 5.0 - bt * 1.0) * 0.004;
      float di = length(d) - r;
      float h = clamp(0.5 + 0.5 * (di - sd) / k, 0.0, 1.0);
      sd = mix(di, sd, h) - k * h * (1.0 - h);
    }
    // Fill (inside sd<0) + a constant-width membrane ring at sd=0.
    float blob = smoothstep(0.006, -0.006, sd) * uActive;
    float outline = (1.0 - smoothstep(0.0, 0.014, abs(sd))) * uActive;

    // Grain drift inside the blob: second noise modulates dot alpha
    // so individual grains seem to flow. Higher floor (0.75 vs 0.55)
    // so grains stay solid most of the time and only subtly fade in
    // and out as the noise field passes over them.
    float drift = 0.75 + 0.25 * noise2(gridUv * 6.0 + uTime * 0.6);

    // Grain alpha. Trimmed (1.1 -> 0.7) so the grains read as light foam
    // suspended IN the filled liquid rather than a dot field that hollows
    // out the body — the fill (above) now carries the mercury mass.
    float a = clamp(dotMask * blob * drift * 0.7, 0.0, 1.0);

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

    // ----- Hover charge: warm envelope around the WHOLE keypad -----
    // Hovering ANY interactive part (cap/dial) charges a large, soft,
    // YELLOW-amber glow centered on the DEVICE (not the cursor, so it
    // never jumps as the pointer moves) - a flowy warmth filling the
    // whole pool. uHot eases slowly in JS for the flow; the big radius
    // (vs the old cursor-local blob) is what spreads it past the knob.
    vec2 hotCenter = vec2(0.5, 0.5);
    float hotD = length((uv - hotCenter) * uAspect);
    float hotField = pow(max(0.0, 1.0 - hotD / 0.62), 1.5)
      * uHot * uActive * uGlowOpacity;

    // Composite: ambient orange tint, then the yellow hover charge over
    // the top.
    vec3 tintedBg = mix(uBg, uGlow, glow);
    tintedBg = mix(tintedBg, uHotColor, clamp(hotField * 0.5, 0.0, 0.5));
    // Liquid fill: a FILLED warm body inside the glob so it reads as a solid
    // droplet of fluid (mercury), not a hollow grain-dotted outline. Bumped
    // 0.5 -> 0.74 per "not enough liquid filling".
    tintedBg = mix(tintedBg, uGlow, blob * 0.74);
    // Rice grains INVERT toward light under the charge so they contrast
    // against the warm glow instead of muddying into it (grey-on-amber
    // had almost no separation).
    vec3 riceCol = mix(uRice, uRiceHot, clamp(hotField * 1.6, 0.0, 1.0));
    vec3 col = mix(tintedBg, riceCol, a);
    // Membrane outline: a crisp accent ring tracing the liquid's edge -
    // the surface-tension skin that makes the glob read as fluid.
    col = mix(col, uGlow, outline * 0.85);

    // BACK layer = opaque backdrop. FRONT layer = transparent: only a few
    // faint orange liquid wisps (fill + membrane) of the trail float over
    // the keypad, so the section reads as liquid in front AND behind it.
    if (uLayer > 0.5) {
      float cov = clamp(blob * 0.24 + outline * 0.9, 0.0, 1.0)
        * uActive * uFrontOpacity;
      gl_FragColor = vec4(uGlow, cov);
    } else {
      gl_FragColor = vec4(col, 1.0);
    }
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

interface Props {
  cursorRef: React.MutableRefObject<CursorState>;
  /** 0..1 target glow opacity. The shader uniform lerps toward this
   *  each frame for a soft fade. Keypad.tsx ramps this from 0 to
   *  1 once the keypad's drop-in animation has finished. */
  glowOpacityRef?: React.MutableRefObject<number>;
  /** Cursor currently over an interactive part (cap/dial). */
  hotRef?: React.MutableRefObject<boolean>;
  /**
   * "back" (default): the opaque cursor-fluid BACKDROP behind the keypad.
   * "front": a transparent plane IN FRONT of the keypad showing only a few
   * faint liquid wisps (fill + membrane) of the same trail, so a little of
   * the liquid floats OVER the device for a 3D layered read.
   */
  layer?: "back" | "front";
}

export function RiceBlob({
  cursorRef,
  glowOpacityRef,
  hotRef,
  layer = "back",
}: Props) {
  const isFront = layer === "front";
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const { size, camera } = useThree();
  const startMs = useMemo(() => performance.now(), []);

  // Knob-press dispersal: the dial dispatches "keypad-knob-press"; we stamp
  // the time and the shader bursts the blob into scattered droplets that
  // reform as the impulse decays. Skipped under reduced motion.
  const burstStartRef = useRef(-1);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const onBurst = () => {
      if (!reduced) burstStartRef.current = performance.now();
    };
    window.addEventListener("keypad-knob-press", onBurst);
    return () => window.removeEventListener("keypad-knob-press", onBurst);
  }, []);

  const uniforms = useMemo(
    () => ({
      uTrail: {
        value: Array.from({ length: TRAIL_N }, () => new THREE.Vector2(-2, -2)),
      },
      uVel: { value: new THREE.Vector2(0, 0) },
      uAspect: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uBlobRadius: { value: BLOB_RADIUS },
      uBlobFeather: { value: BLOB_FEATHER },
      uGridCount: { value: GRID_COUNT },
      uDotRadius: { value: DOT_RADIUS },
      uBg: { value: new THREE.Color(BG_COLOR) },
      uRice: { value: new THREE.Color(RICE_COLOR) },
      uGlow: { value: new THREE.Color(GLOW_COLOR) },
      uHotColor: { value: new THREE.Color(HOT_COLOR) },
      uRiceHot: { value: new THREE.Color(RICE_HOT_COLOR) },
      uActive: { value: 0 },
      uLayer: { value: isFront ? 1 : 0 },
      uFrontOpacity: { value: 0.42 },
      uBurst: { value: 0 },
      uGlowOpacity: { value: 0 },
      uHot: { value: 0 },
    }),
    [isFront],
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
      _planePos
        .copy(_camDir)
        .multiplyScalar(
          isFront ? FRONT_PLANE_DISTANCE : PLANE_DISTANCE_BEHIND_TARGET,
        );
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

    // Knob-press dispersal impulse: 1 at click, exp-decays over ~0.9s.
    const sinceBurst =
      burstStartRef.current >= 0
        ? (performance.now() - burstStartRef.current) / 1000
        : 99;
    mat.uniforms.uBurst.value =
      sinceBurst < 0.9 ? Math.exp(-sinceBurst * 5.0) : 0;

    // ── Cursor TRAIL update (the reactivity) ──────────────────────────
    // Head (trail[0]) chases the cursor quickly; each following ball lags
    // toward the one ahead. Moving fast spreads the chain into a trail;
    // stopping lets it flow back together. All fixed-rate lerps (never
    // bound directly to a per-event value, per project rule).
    const trail = mat.uniforms.uTrail.value as THREE.Vector2[];
    const t = cursorRef.current;
    const dtc = Math.min(dt, 0.05);
    const head = trail[0]!;
    const prevHeadX = head.x;
    const prevHeadY = head.y;
    const kHead = 1 - Math.exp(-dtc * CURSOR_LERP_RATE);
    head.x += (t.x - head.x) * kHead;
    head.y += (t.y - head.y) * kHead;
    // Follower chain as a CONSTANT-SPACING ROPE: each ball eases toward the
    // one ahead, then its gap is clamped to MAX_GAP. The clamp is the key to
    // a continuous, mercury-like trail — without it, fast moves open gaps
    // wider than the balls overlap and the union breaks into discrete blobs
    // (the "spawning / choppy" look). With a fixed max gap < ball overlap,
    // the chain is always fused into one smooth body that stretches + flows.
    const kChain = 1 - Math.exp(-dtc * 26);
    const MAX_GAP = 0.028; // tighter rope -> cohesive mercury, fused + compact
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
    // Smoothed head velocity (units/sec) for the grain drag.
    const vel = mat.uniforms.uVel.value as THREE.Vector2;
    const instVx = (head.x - prevHeadX) / dtc;
    const instVy = (head.y - prevHeadY) / dtc;
    const kVel = 1 - Math.exp(-dtc * 12);
    vel.x += (instVx - vel.x) * kVel;
    vel.y += (instVy - vel.y) * kVel;

    mat.uniforms.uActive.value += (
      (t.active ? 1 : 0) - mat.uniforms.uActive.value
    ) * kHead;
    // Soft lerp toward target glow opacity. Slower coefficient than
    // the cursor-active follow so the fade-in reads as deliberate
    // rather than a snap.
    const targetGlow = glowOpacityRef?.current ?? 1;
    const glowK = 1 - Math.exp(-dt * 2.2);
    mat.uniforms.uGlowOpacity.value +=
      (targetGlow - mat.uniforms.uGlowOpacity.value) * glowK;

    // Hover charge eases in/out SLOWLY (was dt*10, which snapped) so
    // the warm envelope flows in and out instead of popping. Never
    // bound directly to the event, per the fixed-rate rule.
    const hotK = 1 - Math.exp(-dt * 2.5);
    mat.uniforms.uHot.value +=
      ((hotRef?.current ? 1 : 0) - mat.uniforms.uHot.value) * hotK;
  });

  // Base geometry (24, 16): useFrame above repositions, orients,
  // and scales the mesh each frame to keep it as a flat backdrop
  // perpendicular to the camera. Initial position doesn't matter;
  // useFrame overrides on the first tick.
  return (
    <mesh ref={meshRef} renderOrder={isFront ? 999 : -1}>
      <planeGeometry args={[24, 16]} />
      <shaderMaterial
        ref={matRef}
        uniforms={uniforms}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        depthTest={false}
        depthWrite={false}
        transparent={isFront}
      />
    </mesh>
  );
}
