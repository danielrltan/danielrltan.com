import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Hobbies scene: BOLD CLUSTER, floating-in-space edition.
 *
 * All ten interest objects float together as one dense cluster suspended in
 * open space and fill the frame edge-to-edge with low padding (the reference
 * the user supplied). There is no scroll-driven scrub and no one-at-a-time
 * focus: every object is vivid the whole time.
 *
 * MOTION — gentle zero-g drift (NOT a vertical bob):
 *   Each object is a soft body that drifts slowly around its home slot
 *   (spring-damped toward a slowly-wandering target), and the bodies resolve
 *   soft sphere collisions so they BUMP into each other and push apart but
 *   never interpenetrate / clip through one another. A containment clamp keeps
 *   every body fully inside the visible frame so nothing is ever cut off at the
 *   edges. The whole thing reads like objects floating in space, drifting and
 *   slowly knocking into each other. prefers-reduced-motion parks it static.
 *
 * HOVER — focus + face-tracking parallax (ported from the keypad section):
 *   Hovering an object FOCUSES it: it lifts/scales up, eases forward, slows its
 *   drift to hold still, and tilts TOWARD the cursor (±15°, exp-lerp rate 6 —
 *   the same face-tracking the keypad uses). A DOM tooltip shows its label.
 *
 * Palette discipline: the site runs a strict off-white / ink / orange system.
 * The abstract placeholder objects wear a glossy duotone of deep graphite,
 * light steel, and brand orange; the real GLB props keep their authored
 * materials with a gloss boost so the whole cluster reads as one candy set.
 */

interface Hobby {
  id: string;
  file: string;
  label: string;
}

const HOBBIES: Hobby[] = [
  { id: "belt",     file: "belt.glb",     label: "Taekwondo"   },
  { id: "piano",    file: "piano.glb",    label: "Piano"       },
  { id: "pc",       file: "pc.glb",       label: "Workstation" },
  { id: "shoe",     file: "shoe.glb",     label: "Fashion"     },
  { id: "keyboard", file: "keyboard.glb", label: "Keyboards"   },
  { id: "cursor",   file: "cursor.glb",   label: "Design"      },
  { id: "car",      file: "car.glb",      label: "Cars"        },
  { id: "yarn",     file: "yarn.glb",     label: "Crocheting"  },
  { id: "luggage",  file: "luggage.glb",  label: "Travel"      },
  { id: "ski",      file: "ski.glb",      label: "Skiing"      },
];

type PlaceholderKind =
  | "icosahedron"
  | "box"
  | "torus"
  | "cone"
  | "octahedron"
  | "dodecahedron"
  | "cylinder"
  | "sphere"
  | "tetrahedron"
  | "ring";

type Tone = "ink" | "steel" | "orange";

const TONE_COLOR: Record<Tone, string> = {
  ink: "#2b2f36",
  steel: "#aeb4bc",
  orange: "#ff4f00",
};

/**
 * Home slots for the cluster: a SPREAD, not a pile. Each object gets its own
 * clear space on the canvas (user: "I want them all to kind of have their own
 * space that you can see" - no occlusion). Two loose, staggered bands across a
 * landscape frame; the z is kept nearly FLAT so nothing ever hides behind a
 * nearer neighbour (depth occlusion is what made the car disappear). Objects
 * still drift slowly around their home and the soft collisions keep a visible
 * gap between them. `radius` is the collision half-size and is padded a touch
 * beyond the visual size so neighbours hold a clear gap as they drift. `tone`
 * applies only to the abstract placeholder objects.
 */
const LAYOUT: Record<
  string,
  {
    pos: [number, number, number];
    scale: number;
    radius: number;
    placeholder: PlaceholderKind;
    tone: Tone;
  }
> = {
  // upper band
  piano:    { pos: [-2.42,  0.64,  0.04], scale: 1.00, radius: 0.66, placeholder: "box",          tone: "ink"    },
  yarn:     { pos: [-1.28,  0.96, -0.02], scale: 0.82, radius: 0.54, placeholder: "sphere",       tone: "steel"  },
  pc:       { pos: [ 0.06,  0.52,  0.06], scale: 1.16, radius: 0.74, placeholder: "icosahedron",  tone: "orange" },
  keyboard: { pos: [ 1.34,  0.80,  0.00], scale: 1.04, radius: 0.62, placeholder: "torus",        tone: "ink"    },
  luggage:  { pos: [ 2.44,  0.68,  0.02], scale: 0.96, radius: 0.62, placeholder: "tetrahedron",  tone: "ink"    },
  // lower band
  belt:     { pos: [-2.30, -0.72, -0.02], scale: 0.98, radius: 0.64, placeholder: "dodecahedron", tone: "orange" },
  ski:      { pos: [-1.22, -0.42,  0.04], scale: 1.04, radius: 0.62, placeholder: "ring",         tone: "steel"  },
  cursor:   { pos: [-0.08, -0.96,  0.02], scale: 0.88, radius: 0.56, placeholder: "octahedron",   tone: "orange" },
  shoe:     { pos: [ 1.10, -0.86,  0.04], scale: 0.92, radius: 0.58, placeholder: "cone",         tone: "steel"  },
  car:      { pos: [ 2.34, -0.40, -0.02], scale: 1.00, radius: 0.62, placeholder: "cylinder",     tone: "steel"  },
};

// Gentle front-facing sway amplitudes (radians) — a slow breathing rotation so
// the floating objects feel alive without ever turning their backs to camera.
const SWAY_YAW = 0.12;
const SWAY_PITCH = 0.05;
const SWAY_ROLL = 0.025;
const SWAY_YAW_PERIOD = 7.5;
const SWAY_PITCH_PERIOD = 6.1;
const SWAY_ROLL_PERIOD = 8.3;

// Hover focus.
const HOVER_SCALE = 1.1;           // lift the focused object
const HOVER_FORWARD = 0.18;        // ease it this far toward the camera (+z)
// Face-tracking parallax (ported from the keypad: ±15°, exp-lerp rate 6).
const PARALLAX = THREE.MathUtils.degToRad(15);
const PARALLAX_LERP_RATE = 6;

// prefers-reduced-motion: park static (no drift, no sway, no collisions step).
const PREFERS_REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function PlaceholderMesh({ kind, size }: { kind: PlaceholderKind; size: number }) {
  const r = size * 0.55;
  switch (kind) {
    case "icosahedron":
      return <icosahedronGeometry args={[r, 0]} />;
    case "box":
      return <boxGeometry args={[size, size * 0.8, size * 0.9]} />;
    case "torus":
      return <torusGeometry args={[r * 0.85, r * 0.32, 16, 40]} />;
    case "cone":
      return <coneGeometry args={[r, size * 1.2, 20]} />;
    case "octahedron":
      return <octahedronGeometry args={[r, 0]} />;
    case "dodecahedron":
      return <dodecahedronGeometry args={[r, 0]} />;
    case "cylinder":
      return <cylinderGeometry args={[r * 0.7, r * 0.85, size * 0.9, 24]} />;
    case "sphere":
      return <sphereGeometry args={[r, 32, 24]} />;
    case "tetrahedron":
      return <tetrahedronGeometry args={[r * 1.05, 0]} />;
    case "ring":
      return <torusGeometry args={[r * 0.95, r * 0.20, 12, 36]} />;
  }
}

// ----------------------------------------------------------------------
// Module-scope GLB preload (App.tsx also idle-prefetches the module).
// Concurrency capped at 3 so the loads don't starve first-paint assets.
// ----------------------------------------------------------------------
type LoadEntry = {
  scene: THREE.Group | null;
  loaded: boolean;
  listeners: Set<(scene: THREE.Group | null) => void>;
};
const PRELOADED: Record<string, LoadEntry> = {};
let preloadStarted = false;
function startPreload() {
  if (preloadStarted) return;
  preloadStarted = true;
  if (typeof window === "undefined") return;
  const loader = new GLTFLoader();
  const queue: Array<(typeof HOBBIES)[number]> = [];
  HOBBIES.forEach((h) => {
    PRELOADED[h.id] = { scene: null, loaded: false, listeners: new Set() };
    queue.push(h);
  });
  const MAX_CONCURRENT = 3;
  let active = 0;
  const pump = () => {
    while (active < MAX_CONCURRENT && queue.length > 0) {
      const h = queue.shift()!;
      const entry = PRELOADED[h.id]!;
      active += 1;
      const finish = (scene: THREE.Group | null) => {
        entry.scene = scene;
        entry.loaded = true;
        entry.listeners.forEach((cb) => cb(scene));
        active -= 1;
        pump();
      };
      loader.load(
        `/hobbies/${h.file}`,
        (gltf) => finish(gltf.scene),
        undefined,
        () => finish(null),
      );
    }
  };
  pump();
}
startPreload();

/** Per-body deterministic params: same id → same rest pose + drift + sway. */
interface BodyAnim {
  // Natural "tossed in" resting rotation (radians, per axis) so the objects
  // read as jumbled / floating in space rather than a uniform aligned grid.
  // The sway + hover parallax oscillate AROUND this rest pose.
  restRot: [number, number, number];
  swayPhaseY: number;
  swayPhaseX: number;
  swayPhaseZ: number;
  // Slowly-wandering drift target offset (two co-prime-ish sinusoids per axis
  // for an organic, non-repeating-looking path).
  wanderPhase: [number, number, number];
  wanderPhase2: [number, number, number];
}
// How far each object can be tossed off-axis at rest (radians). Generous on Y
// (spin) + a real tilt on X/Z so the spread looks jumbled, not lined up.
const REST_TILT = 0.5;   // ~+-29deg on X / Z
const REST_SPIN = 0.9;   // ~+-52deg on Y
function makeAnim(id: string): BodyAnim {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
  const tau = Math.PI * 2;
  const signed = (a: number) => (rand() - 0.5) * 2 * a;
  return {
    restRot: [signed(REST_TILT), signed(REST_SPIN), signed(REST_TILT)],
    swayPhaseY: rand() * tau,
    swayPhaseX: rand() * tau,
    swayPhaseZ: rand() * tau,
    wanderPhase: [rand() * tau, rand() * tau, rand() * tau],
    wanderPhase2: [rand() * tau, rand() * tau, rand() * tau],
  };
}

// Drift sim tuning.
const WANDER_AMP = 0.13;      // how far the drift target roams from home (small: stay spread)
const WANDER_W1 = 0.085;      // base wander angular speed (rad/s) — slow
const WANDER_W2 = 0.137;      // second harmonic
const SPRING_K = 4.2;         // pull toward the (drifting) target
const LINEAR_DAMP = 2.4;      // velocity damping → floaty, settles, no jitter
const COLLISION_PUSH = 0.5;   // share of overlap each body takes when bumping
const COLLISION_RESTITUTION = 0.16; // gentle bounce on contact
const HOVER_DAMP_BONUS = 9;   // extra damping on the focused body (holds still)
// UNIFORM inset of every body from the frame edge. Generous enough that the
// hover scale + gentle forward dolly grow a focused object WITHIN this margin,
// so it never clips the edge. (A per-hover containment pad was tried instead but
// it abruptly shrank the clamp box for the focused body and HARD-SNAPPED it
// inward on hover - user-flagged. A uniform margin keeps the clamp identical
// hovered or not, so there is no snap.)
const EDGE_MARGIN = 0.18;

// PERF: module-scope scratch reused inside the solver / sway writes.
const _eSway = new THREE.Euler(0, 0, 0, "XYZ");
const _vTmp = new THREE.Vector3();

type Body = {
  id: string;
  index: number;
  home: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  radius: number; // world collision radius (already includes scale)
  scale: number;
  anim: BodyAnim;
};

interface HobbyMeshProps {
  hobby: Hobby;
  scene: THREE.Group | null;
  index: number;
  isTouch: boolean;
  /** Phones: show the name tag STATICALLY over the object (no hover on touch). */
  mobile: boolean;
  hoveredIndexRef: React.RefObject<number>;
  cursorRef: React.RefObject<{ x: number; y: number; active: boolean }>;
  visibleRef: React.RefObject<boolean>;
}

function HobbyMesh({
  hobby,
  scene,
  index,
  isTouch,
  mobile,
  hoveredIndexRef,
  cursorRef,
  visibleRef,
}: HobbyMeshProps) {
  const rotRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const hoverLerpRef = useRef(0);
  const tiltRef = useRef({ x: 0, y: 0 });

  const layout = LAYOUT[hobby.id]!;
  const anim = useMemo(() => makeAnim(hobby.id), [hobby.id]);
  const toneColor = useMemo(() => TONE_COLOR[layout.tone], [layout.tone]);

  // Normalize GLB scale so every prop reads at a consistent base size, plus a
  // gloss boost so the real props sit in the same candy-glossy family as the
  // placeholders (never recolours the authored materials).
  const normalizedScene = useMemo(() => {
    if (!scene) return null;
    const cloned = scene.clone(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const targetRadius = 0.62;
    const k = sphere.radius > 0 ? targetRadius / sphere.radius : 1;
    cloned.scale.setScalar(k);
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
    cloned.position.sub(center);
    cloned.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      const boost = (m: THREE.Material) => {
        const sm = m as THREE.MeshStandardMaterial;
        if (sm.isMeshStandardMaterial) {
          sm.roughness = Math.min(sm.roughness ?? 0.5, 0.34);
          sm.envMapIntensity = Math.max(sm.envMapIntensity ?? 1, 1.1);
          sm.needsUpdate = true;
        }
      };
      if (Array.isArray(mat)) mat.forEach(boost);
      else boost(mat);
    });
    return cloned;
  }, [scene]);

  useFrame((state, dt) => {
    const g = rotRef.current;
    if (!g) return;
    if (visibleRef && visibleRef.current === false) return;
    const t = state.clock.elapsedTime;
    const hovered = hoveredIndexRef.current === index;

    // Hover weight (smoothed) drives scale + parallax blend.
    const targetHover = hovered ? 1 : 0;
    hoverLerpRef.current += (targetHover - hoverLerpRef.current) * (1 - Math.exp(-dt * 9));
    const hw = hoverLerpRef.current;

    // Rotation: gentle front-facing sway, damped as the object focuses, plus
    // the keypad face-tracking parallax that turns it toward the cursor while
    // hovered.
    const rr = anim.restRot;
    if (PREFERS_REDUCED_MOTION) {
      g.rotation.set(rr[0], rr[1], rr[2]);
    } else {
      const swayDamp = 1 - 0.75 * hw;
      const yaw =
        Math.sin((t / SWAY_YAW_PERIOD) * Math.PI * 2 + anim.swayPhaseY) * SWAY_YAW * swayDamp;
      const pitch =
        Math.sin((t / SWAY_PITCH_PERIOD) * Math.PI * 2 + anim.swayPhaseX) * SWAY_PITCH * swayDamp;
      const roll =
        Math.sin((t / SWAY_ROLL_PERIOD) * Math.PI * 2 + anim.swayPhaseZ) * SWAY_ROLL * swayDamp;
      // Face-tracking target (only while focused). cursor 0..1, centre 0.5.
      const c = cursorRef.current;
      const cx = hovered && c && c.active ? (c.x - 0.5) * 2 : 0;
      const cy = hovered && c && c.active ? (c.y - 0.5) * 2 : 0;
      const k = 1 - Math.exp(-dt * PARALLAX_LERP_RATE);
      tiltRef.current.x += (-cy * PARALLAX - tiltRef.current.x) * k;
      tiltRef.current.y += (cx * PARALLAX - tiltRef.current.y) * k;
      // Sway + hover parallax oscillate AROUND the tossed-in rest pose.
      _eSway.set(
        rr[0] + pitch + tiltRef.current.x,
        rr[1] + yaw + tiltRef.current.y,
        rr[2] + roll,
      );
      g.rotation.copy(_eSway);
    }

    // Scale lift on focus.
    const s = layout.scale * (1 + (HOVER_SCALE - 1) * hw);
    g.scale.setScalar(s);

    // Placeholder emissive hover glow.
    if (matRef.current) {
      matRef.current.emissiveIntensity = 0.06 + 0.22 * hw;
    }

    // Label-over-object (jump-menu style): fade + lift the name in as the
    // object focuses. Driven by the same hover weight so it never desyncs.
    if (labelRef.current) {
      if (mobile) {
        // STATIC on phones (no hover on touch): the name tag is always on, fixed
        // over the object so it never jitters with the sway. Placement/no-overlap
        // is owned by the portrait LAYOUT spacing + the wander being off on mobile.
        labelRef.current.style.opacity = "1";
        labelRef.current.style.transform = "translateY(0) scale(1)";
      } else {
        labelRef.current.style.opacity = hw.toFixed(3);
        labelRef.current.style.transform = `translateY(${(-6 - 10 * hw).toFixed(1)}px) scale(${(0.92 + 0.08 * hw).toFixed(3)})`;
      }
    }
  });

  // Teardown contract: this tile writes document.body.style.cursor='pointer' on
  // hover and only clears it on its own pointerOut — but R3F fires NO pointerOut
  // when the Hobbies CANVAS UNMOUNTS (mount-on-approach tears it down as it
  // scrolls out of view), which strands body.cursor='pointer' and sticks the
  // spark cursor on the next section. Clear it on unmount.
  useEffect(
    () => () => {
      if (document.body.style.cursor === "pointer")
        document.body.style.cursor = "";
    },
    [],
  );

  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hoveredIndexRef.current = index;
    document.body.style.cursor = "pointer";
  };
  const onPointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = "";
    // Touch fires over->out in quick succession on a tap; keep the tapped
    // label up until another object is tapped or empty space is hit
    // (onPointerMissed clears it). Pointer devices clear on hover-out.
    if (isTouch) return;
    if (hoveredIndexRef.current === index) hoveredIndexRef.current = -1;
  };

  return (
    <group ref={rotRef} onPointerOver={onPointerOver} onPointerOut={onPointerOut}>
      {normalizedScene ? (
        <primitive object={normalizedScene} />
      ) : (
        <mesh castShadow={false} receiveShadow={false}>
          <PlaceholderMesh kind={layout.placeholder} size={0.78} />
          {/* PERF (touch): the clearcoat MeshPhysicalMaterial is a second BRDF
              lobe per fragment. On phones drop to a plain MeshStandardMaterial
              (no clearcoat) — the gloss difference is imperceptible at phone
              size and DPR, and it halves the placeholder shading cost. Desktop
              keeps the candy clearcoat. */}
          {isTouch ? (
            <meshStandardMaterial
              ref={matRef}
              color={toneColor}
              emissive={toneColor}
              emissiveIntensity={0.06}
              roughness={0.3}
              metalness={0.0}
              envMapIntensity={1.1}
            />
          ) : (
            <meshPhysicalMaterial
              ref={matRef as React.RefObject<THREE.MeshPhysicalMaterial>}
              color={toneColor}
              emissive={toneColor}
              emissiveIntensity={0.06}
              roughness={0.26}
              metalness={0.0}
              clearcoat={1}
              clearcoatRoughness={0.18}
              envMapIntensity={1.1}
            />
          )}
        </mesh>
      )}
      {/* Name label floating ON the object - same recipe as the jump menu's
          spill labels: white pixel text with a dark stroke (no card), so it
          reads over any object. Hidden until hovered (opacity driven above).
          pointer-events:none so it never blocks hovering the object beneath. */}
      <Html
        center
        position={[0, 0, 0]}
        distanceFactor={mobile ? 12 : 9}
        zIndexRange={[30, 0]}
        style={{ pointerEvents: "none" }}
      >
        <span
          ref={labelRef}
          className={`hobbies-label${mobile ? " hobbies-label--static" : ""}`}
          style={{ opacity: mobile ? 1 : 0 }}
        >
          {hobby.label}
        </span>
      </Html>
    </group>
  );
}

// Camera framing: fixed, looking at the cluster centre. The cluster is wider
// than tall; we fit both half-extents against the frame and take whichever axis
// is binding (height on desktop, width on portrait). FILL < 1 leaves a margin
// so nothing is cut off; the per-body containment clamp (below) is the hard
// guarantee that no object ever crosses the visible edge.
const CLUSTER_HALF_W = 3.06;
const CLUSTER_HALF_H = 1.82;
// MOBILE PORTRAIT cluster — a TALL 2-column arrangement so the 10 objects FILL a
// phone's portrait screen. The landscape spread above, framed to fit its WIDTH,
// pulls the camera far back on a narrow viewport (small cluster + dead air); a
// tall cluster lets the camera frame the HEIGHT and fill the screen. Positions
// only — scale / radius / placeholder / tone stay from LAYOUT. Selected at
// <=768px via the reactive `mobile` flag in SceneInner.
const POS_PORTRAIT: Record<string, [number, number, number]> = {
  // 2 cols x 5 rows. LABEL-AWARE: never two LONG names in the same row (their
  // static labels would collide), and the long one alternates sides row to row.
  // row 1 — CROCHETING (long) L | PIANO (short) R
  yarn:     [-0.60,  2.48,  0.03],
  piano:    [ 0.62,  2.50, -0.02],
  // row 2 — SKIING (short) L | WORKSTATION (long) R
  ski:      [-0.62,  1.22,  0.03],
  pc:       [ 0.56,  1.25,  0.05],
  // row 3 — KEYBOARDS (long) L | DESIGN (short) R
  keyboard: [-0.58,  0.00,  0.00],
  cursor:   [ 0.60, -0.04, -0.02],
  // row 4 — TRAVEL (med) L | TAEKWONDO (long) R
  luggage:  [-0.62, -1.22,  0.00],
  belt:     [ 0.58, -1.25,  0.04],
  // row 5 — FASHION (med) L | CARS (short) R
  shoe:     [-0.62, -2.48,  0.03],
  car:      [ 0.64, -2.50, -0.02],
};
const CLUSTER_HALF_W_PORTRAIT = 1.4;
const CLUSTER_HALF_H_PORTRAIT = 3.1;
// Look ABOVE centre so the cluster sits LOWER in the frame — the top row of
// objects (+ their static labels) clears the big "Some interests" wordmark that
// floats over the top of the section.
const CAM_LOOK_Y_PORTRAIT = 0.5;
// Look ABOVE the cluster centre so the whole spread sits in the LOWER part of
// the frame, leaving clear space up top for the giant "Some interests"
// wordmark (objects under the title read as messy / unreviewed). Eased back
// from 0.42 so the lowest objects (the cone) keep clearance at the BOTTOM too.
const CAM_LOOK_Y = 0.34;
const CAM_HEIGHT_OFFSET = 0.0;
const VFOV_DEG = 36;
const VFOV_RAD = (VFOV_DEG * Math.PI) / 180;
const HALF_VFOV_TAN = Math.tan(VFOV_RAD / 2);
// Eased from 0.92 so the cluster sits a touch smaller with clear margin top AND
// bottom (the hovered bottom object was clipping the bottom edge).
const FILL_FRACTION = 0.86;
function camDistanceForAspect(
  aspect: number,
  halfW: number,
  halfH: number,
): number {
  const a = Math.max(0.0001, aspect);
  const distForHeight = halfH / (FILL_FRACTION * HALF_VFOV_TAN);
  const distForWidth = halfW / (FILL_FRACTION * HALF_VFOV_TAN * a);
  return Math.max(distForHeight, distForWidth);
}

function SceneInner({
  loaded,
  isTouch,
  visibleRef,
  liveRef,
  cursorRef,
  hoveredIndexRef,
}: {
  loaded: Record<string, THREE.Group | null>;
  isTouch: boolean;
  visibleRef: React.RefObject<boolean>;
  liveRef: React.RefObject<boolean>;
  cursorRef: React.RefObject<{ x: number; y: number; active: boolean }>;
  hoveredIndexRef: React.RefObject<number>;
}) {
  const { camera, invalidate } = useThree();
  // Outer position groups (one per body) written by the solver each frame.
  const posRefs = useRef<(THREE.Group | null)[]>([]);

  // <=768px → use the TALL portrait cluster (fills a phone screen) instead of the
  // landscape spread. Reactive so an orientation/resize across the breakpoint
  // rebuilds the body home slots + re-frames the camera.
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= 768,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
      return;
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Soft-body state for the drift + collision sim. Rebuilt when the portrait /
  // landscape arrangement flips (positions differ; scale/radius are unchanged).
  const bodies = useMemo<Body[]>(
    () =>
      HOBBIES.map((h, i) => {
        const L = LAYOUT[h.id]!;
        const p = mobile ? POS_PORTRAIT[h.id] ?? L.pos : L.pos;
        const home = new THREE.Vector3(p[0], p[1], p[2]);
        return {
          id: h.id,
          index: i,
          home,
          pos: home.clone(),
          vel: new THREE.Vector3(),
          radius: L.radius,
          scale: L.scale,
          anim: makeAnim(h.id),
        };
      }),
    [mobile],
  );

  useFrame((state, dtRaw) => {
    if (visibleRef.current === false || liveRef.current === false) return;
    invalidate();
    const dt = Math.min(dtRaw, 0.05); // clamp so a stalled tab doesn't explode the sim
    const t = state.clock.elapsedTime;

    // ---- Camera: fixed framing of the whole cluster ----
    const aspect = state.size.height > 0 ? state.size.width / state.size.height : 1;
    // Portrait phones frame the TALL cluster (fills the screen); desktop/tablet
    // frame the landscape spread.
    const halfW = mobile ? CLUSTER_HALF_W_PORTRAIT : CLUSTER_HALF_W;
    const halfH = mobile ? CLUSTER_HALF_H_PORTRAIT : CLUSTER_HALF_H;
    const lookY = mobile ? CAM_LOOK_Y_PORTRAIT : CAM_LOOK_Y;
    const dist = camDistanceForAspect(aspect, halfW, halfH);
    camera.position.set(0, lookY + CAM_HEIGHT_OFFSET, dist);
    camera.lookAt(0, lookY, 0);

    // Visible world half-extents at z=0 (for the containment clamp). Anything
    // kept inside (half - radius - margin) can never be cut off at the edge.
    const visHalfH = dist * HALF_VFOV_TAN;
    const visHalfW = visHalfH * aspect;

    const hoveredIdx = hoveredIndexRef.current;

    if (PREFERS_REDUCED_MOTION) {
      // Static still-life: park each body at its home, no drift / collisions.
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i]!;
        b.pos.copy(b.home);
        posRefs.current[i]?.position.copy(b.pos);
      }
      return;
    }

    // ---- Integrate each body toward its slowly-wandering drift target ----
    // Wander is OFF on mobile: the always-on labels must not drift into each
    // other, so bodies hold their (spaced) portrait home slots. The sway
    // ROTATION below still animates, so the objects stay alive.
    const wAmp = mobile ? 0 : WANDER_AMP;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      const wp = b.anim.wanderPhase;
      const wp2 = b.anim.wanderPhase2;
      // Smooth wander offset around home (two harmonics per axis).
      const ox =
        (Math.sin(t * WANDER_W1 + wp[0]) + 0.5 * Math.sin(t * WANDER_W2 + wp2[0])) * wAmp;
      const oy =
        (Math.sin(t * WANDER_W1 + wp[1]) + 0.5 * Math.sin(t * WANDER_W2 + wp2[1])) * wAmp;
      const oz =
        (Math.sin(t * WANDER_W1 + wp[2]) + 0.5 * Math.sin(t * WANDER_W2 + wp2[2])) * wAmp * 0.5;
      // Focused body eases forward (toward camera) for a clear focus pop.
      const fwd = b.index === hoveredIdx ? HOVER_FORWARD : 0;
      _vTmp.set(b.home.x + ox, b.home.y + oy, b.home.z + oz + fwd).sub(b.pos);
      // Spring toward target + linear damping. The focused body gets extra
      // damping so it slows and holds still under the cursor.
      const damp = LINEAR_DAMP + (b.index === hoveredIdx ? HOVER_DAMP_BONUS : 0);
      b.vel.addScaledVector(_vTmp, SPRING_K * dt);
      b.vel.addScaledVector(b.vel, -Math.min(1, damp * dt));
      b.pos.addScaledVector(b.vel, dt);
    }

    // ---- Soft sphere collisions: bump apart, never interpenetrate ----
    // PERF (touch): skip the O(n²) pair solver on phones — it's the most
    // expensive per-frame work here and the slow drift alone reads fine on a
    // small screen (the EDGE_MARGIN + spread home slots already keep visible
    // gaps). Desktop keeps the full bump-apart sim. frameloop stays 'demand'.
    if (!isTouch) {
      for (let i = 0; i < bodies.length; i++) {
        const a = bodies[i]!;
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j]!;
          _vTmp.subVectors(b.pos, a.pos);
          const distSq = _vTmp.lengthSq();
          const minDist = a.radius + b.radius;
          if (distSq > 0 && distSq < minDist * minDist) {
            const d = Math.sqrt(distSq);
            const pen = minDist - d;
            _vTmp.multiplyScalar(1 / d); // contact normal a→b
            // Positional separation, split between the pair.
            a.pos.addScaledVector(_vTmp, -pen * COLLISION_PUSH);
            b.pos.addScaledVector(_vTmp, pen * COLLISION_PUSH);
            // Velocity response: only damp the APPROACHING component, gently.
            const rvn = b.vel.dot(_vTmp) - a.vel.dot(_vTmp);
            if (rvn < 0) {
              const imp = (1 + COLLISION_RESTITUTION) * rvn * 0.5;
              a.vel.addScaledVector(_vTmp, imp);
              b.vel.addScaledVector(_vTmp, -imp);
            }
          }
        }
      }
    }

    // ---- Containment: keep every body fully inside the visible frame ----
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      // Same clamp whether or not this body is focused, so hovering never snaps
      // it. The uniform EDGE_MARGIN already leaves room for the hover growth.
      const er = b.radius;
      const limX = Math.max(0, visHalfW - er - EDGE_MARGIN);
      const limY = Math.max(0, visHalfH - er - EDGE_MARGIN - lookY);
      const limYNeg = Math.max(0, visHalfH - er - EDGE_MARGIN + lookY);
      if (b.pos.x > limX) { b.pos.x = limX; if (b.vel.x > 0) b.vel.x *= -0.3; }
      else if (b.pos.x < -limX) { b.pos.x = -limX; if (b.vel.x < 0) b.vel.x *= -0.3; }
      if (b.pos.y > limY) { b.pos.y = limY; if (b.vel.y > 0) b.vel.y *= -0.3; }
      else if (b.pos.y < -limYNeg) { b.pos.y = -limYNeg; if (b.vel.y < 0) b.vel.y *= -0.3; }
      posRefs.current[i]?.position.copy(b.pos);
    }
  });

  return (
    <>
      {/* Punchy cool-retro lighting tuned for gloss. */}
      <ambientLight intensity={0.5} color="#eef1f4" />
      <directionalLight position={[4, 6, 4]} intensity={2.7} color="#ffffff" />
      <directionalLight position={[-5, 3, 2]} intensity={0.8} color="#d7dde3" />
      <directionalLight position={[-2, -1, -5]} intensity={1.1} color="#ff4f00" />
      <directionalLight position={[3, -4, 2]} intensity={0.35} color="#ff6a2a" />
      {HOBBIES.map((h, i) => (
        <group key={h.id} ref={(el) => { posRefs.current[i] = el; }}>
          <HobbyMesh
            hobby={h}
            index={i}
            isTouch={isTouch}
            mobile={mobile}
            scene={loaded[h.id] ?? null}
            hoveredIndexRef={hoveredIndexRef}
            cursorRef={cursorRef}
            visibleRef={visibleRef}
          />
        </group>
      ))}
    </>
  );
}

interface HobbiesSceneProps {
  hobbyIds?: string[];
  live?: boolean;
}

export const HobbiesScene = memo(function HobbiesScene({
  hobbyIds,
  live = true,
}: HobbiesSceneProps) {
  const [loaded, setLoaded] = useState<Record<string, THREE.Group | null>>(() => {
    const init: Record<string, THREE.Group | null> = {};
    for (const h of HOBBIES) {
      const entry = PRELOADED[h.id];
      if (entry && entry.loaded) init[h.id] = entry.scene;
    }
    return init;
  });
  const visibleRef = useRef<boolean>(false);
  const liveRef = useRef<boolean>(live);
  // Which body is hovered (index, -1 = none). Shared by the meshes (parallax /
  // scale) and the solver (drift hold).
  const hoveredIndexRef = useRef<number>(-1);
  // Viewport-relative cursor for the face-tracking parallax.
  const parallaxCursorRef = useRef({ x: 0.5, y: 0.5, active: false });
  const containerRef = useRef<HTMLDivElement>(null);
  const isTouch = useMemo(
    () => typeof window !== "undefined" && "ontouchstart" in window,
    [],
  );
  const dprCap = useMemo<[number, number]>(() => {
    const narrow = typeof window !== "undefined" && window.innerWidth <= 768;
    return isTouch || narrow ? [1, 1.25] : [1, 1.5];
  }, [isTouch]);

  // Roster sanity check (dev only).
  useEffect(() => {
    if (!hobbyIds) return;
    const sceneIds = HOBBIES.map((h) => h.id);
    if (
      import.meta.env.DEV &&
      (sceneIds.length !== hobbyIds.length ||
        sceneIds.some((id, i) => id !== hobbyIds[i]))
    ) {
      console.warn("[HobbiesScene] hobby roster mismatch with parent", {
        parent: hobbyIds,
        scene: sceneIds,
      });
    }
  }, [hobbyIds]);

  // Subscribe to the module-scope preload so late-arriving GLBs swap in.
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    HOBBIES.forEach((h) => {
      const entry = PRELOADED[h.id];
      if (!entry) return;
      if (entry.loaded) return;
      const cb = (scene: THREE.Group | null) => {
        setLoaded((p) => ({ ...p, [h.id]: scene }));
      };
      entry.listeners.add(cb);
      unsubs.push(() => entry.listeners.delete(cb));
    });
    return () => unsubs.forEach((u) => u());
  }, []);

  // Wake the demand loop on the live rising edge.
  const canvasInvalidateRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const was = liveRef.current;
    liveRef.current = live;
    if (live && !was && visibleRef.current) {
      canvasInvalidateRef.current?.();
    }
  }, [live]);

  // Face-tracking cursor feed (desktop pointers only).
  useEffect(() => {
    if (isTouch) return;
    const onMove = (e: PointerEvent) => {
      parallaxCursorRef.current.x = e.clientX / Math.max(1, window.innerWidth);
      parallaxCursorRef.current.y = e.clientY / Math.max(1, window.innerHeight);
      parallaxCursorRef.current.active = true;
    };
    const onLeave = () => {
      parallaxCursorRef.current.active = false;
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, [isTouch]);

  // IntersectionObserver: gate per-frame work + wake the demand loop.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const next = entry.isIntersecting;
          const was = visibleRef.current;
          visibleRef.current = next;
          if (next && !was && canvasInvalidateRef.current) {
            canvasInvalidateRef.current();
          }
        }
      },
      { rootMargin: "20% 0px 20% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Tap empty space to dismiss a tapped label (touch); also clears the body
  // cursor. On pointer devices a hover-out already clears the hovered index.
  const handleMissed = () => {
    hoveredIndexRef.current = -1;
    document.body.style.cursor = "";
  };

  return (
    <div ref={containerRef} className="hobbies-canvas-wrap">
      <Canvas
        camera={{ position: [0, -0.06, 6], fov: VFOV_DEG, near: 0.1, far: 50 }}
        dpr={dprCap}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          preserveDrawingBuffer:
            typeof window !== "undefined" &&
            new URLSearchParams(window.location.search).get("tune") === "other",
        }}
        frameloop="demand"
        onCreated={({ invalidate }) => {
          canvasInvalidateRef.current = invalidate;
        }}
        onPointerMissed={handleMissed}
      >
        <SceneInner
          loaded={loaded}
          isTouch={isTouch}
          visibleRef={visibleRef}
          liveRef={liveRef}
          cursorRef={parallaxCursorRef}
          hoveredIndexRef={hoveredIndexRef}
        />
      </Canvas>
    </div>
  );
});
