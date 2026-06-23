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

export interface Hobby {
  id: string;
  file: string;
  label: string;
}

// NOTE: `id` is an opaque, STABLE key (drives LAYOUT / POS_PORTRAIT lookups +
// the parent roster-sync check). It deliberately does NOT have to match `file`.
// Three slots were re-modelled from new .blend drops: belt→glove.glb (relabelled
// Kickboxing), shoe→boot.glb (Fashion), yarn→donut.glb (3D Modelling — the
// Blender donut). Keeping the ids avoids churning the layout maps below.
export const HOBBIES: Hobby[] = [
  { id: "belt",     file: "glove.glb",    label: "Kickboxing"  },
  { id: "piano",    file: "piano.glb",    label: "Piano"       },
  { id: "pc",       file: "gpu.glb",      label: "Workstation" },
  { id: "shoe",     file: "boot.glb",     label: "Fashion"     },
  { id: "keyboard", file: "keyboard.glb", label: "Keyboards"   },
  { id: "cursor",   file: "cursor.glb",   label: "Design"      },
  { id: "car",      file: "car.glb",      label: "Cars"        },
  { id: "yarn",     file: "donut.glb",    label: "3D Modelling" },
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
// `rot` (radians, XYZ Euler) is the object's authored REST orientation. The
// gentle sway + hover parallax oscillate AROUND it.
export interface HobbyLayoutEntry {
  pos: [number, number, number];
  scale: number;
  rot: [number, number, number];
  radius: number;
  placeholder: PlaceholderKind;
  tone: Tone;
}
export const LAYOUT: Record<string, HobbyLayoutEntry> = {
  belt:     { pos: [-2.94,  0.31, -0.02], scale: 1.50, rot: [-0.85, -0.65, -3.10], radius: 0.64, placeholder: "dodecahedron", tone: "orange" },
  piano:    { pos: [-2.49,  1.42,  0.04], scale: 1.31, rot: [ 0.57, -0.03, -0.04], radius: 0.66, placeholder: "box",          tone: "ink"    },
  pc:       { pos: [-0.17,  1.33,  0.11], scale: 2.03, rot: [-0.32, -0.27, -0.14], radius: 0.74, placeholder: "icosahedron",  tone: "orange" },
  shoe:     { pos: [ 1.43,  0.42,  0.04], scale: 1.90, rot: [ 0.48, -0.79,  0.07], radius: 0.58, placeholder: "cone",         tone: "steel"  },
  keyboard: { pos: [ 0.07, -0.88,  0.00], scale: 1.80, rot: [ 0.61,  0.07, -0.29], radius: 0.62, placeholder: "torus",        tone: "ink"    },
  cursor:   { pos: [-2.43, -0.56,  0.02], scale: 1.57, rot: [-0.53,  0.10, -0.61], radius: 0.56, placeholder: "octahedron",   tone: "orange" },
  car:      { pos: [ 2.74, -0.78, -0.02], scale: 2.42, rot: [ 0.33,  0.24,  0.07], radius: 0.62, placeholder: "cylinder",     tone: "steel"  },
  yarn:     { pos: [-0.24,  0.61, -0.04], scale: 1.71, rot: [ 0.80, -0.09,  0.04], radius: 0.54, placeholder: "sphere",       tone: "steel"  },
  luggage:  { pos: [ 3.00,  0.92,  0.02], scale: 1.98, rot: [ 0.04,  0.40,  0.19], radius: 0.62, placeholder: "tetrahedron",  tone: "ink"    },
  ski:      { pos: [-1.44, -0.06,  0.04], scale: 2.76, rot: [-0.31, -0.35,  0.13], radius: 0.62, placeholder: "ring",         tone: "steel"  },
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

/**
 * Normalize a loaded GLB scene to the cluster's base size + candy gloss, so
 * every prop reads at a consistent footprint no matter how it was modelled.
 * Returns a CLONE (never mutates the cached PRELOADED scene).
 */
export function normalizeHobbyScene(scene: THREE.Group): THREE.Group {
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
  // Effective rest transform (rot + scale) for the active arrangement; mobile
  // inherits desktop unless POS_PORTRAIT overrides. Position is owned by the
  // parent solver group (drift), so only rot + scale are read here.
  const tr = useMemo(() => resolveTransform(hobby.id, mobile), [hobby.id, mobile]);
  const anim = useMemo(() => makeAnim(hobby.id), [hobby.id]);
  const toneColor = useMemo(() => TONE_COLOR[layout.tone], [layout.tone]);

  // Normalize GLB scale so every prop reads at a consistent base size, plus a
  // gloss boost so the real props sit in the same candy-glossy family as the
  // placeholders (never recolours the authored materials).
  const normalizedScene = useMemo(
    () => (scene ? normalizeHobbyScene(scene) : null),
    [scene],
  );

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
    const rr = tr.rot;
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
    const s = tr.scale * (1 + (HOVER_SCALE - 1) * hw);
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

// Camera framing. Desktop is handled by desktopFraming() below (parks the cluster
// low, reserving a top band for the wordmark). Mobile portrait uses the half-extents
// + camDistanceForAspect() with the constants below. The per-body containment clamp
// (further down) is the hard guarantee that no object ever crosses the visible edge.
// MOBILE PORTRAIT cluster — a TALL 2-column arrangement so the 10 objects FILL a
// phone's portrait screen. The landscape spread above, framed to fit its WIDTH,
// pulls the camera far back on a narrow viewport (small cluster + dead air); a
// tall cluster lets the camera frame the HEIGHT and fill the screen. `pos` is
// the portrait home; optional `scale`/`rot` override the desktop LAYOUT values
// for mobile (omit to inherit). Selected at <=768px via the reactive `mobile`
// flag in SceneInner.
export interface HobbyPortraitEntry {
  pos: [number, number, number];
  scale?: number;
  rot?: [number, number, number];
}
export const POS_PORTRAIT: Record<string, HobbyPortraitEntry> = {
  // scale/rot are set only where they differ from the desktop LAYOUT; pos is the
  // portrait home slot.
  belt:     { pos: [ 0.78, -2.52,  0.04], scale: 1.29, rot: [-0.69, -1.01, -2.06] },
  piano:    { pos: [ 0.94,  1.67, -0.02], scale: 1.24, rot: [ 0.61, -0.31,  0.07] },
  pc:       { pos: [ 0.33,  0.81,  0.05], scale: 1.67, rot: [-0.29, -0.27, -0.07] },
  shoe:     { pos: [ 0.66, -1.20,  0.03], scale: 1.48, rot: [-0.35,  0.82,  0.38] },
  keyboard: { pos: [-0.71, -0.28,  0.00], scale: 1.32, rot: [ 0.68, -0.07,  0.28] },
  cursor:   { pos: [ 1.06,  0.11, -0.02], scale: 1.16, rot: [-0.17,  0.09, -0.65] },
  car:      { pos: [-0.75, -2.61, -0.02], scale: 1.45, rot: [ 3.01,  0.45, -3.00] },
  yarn:     { pos: [-0.41,  1.71,  0.03], scale: 1.11, rot: [ 0.69,  0.27, -0.08] },
  luggage:  { pos: [-0.81, -1.47,  0.00], scale: 1.41, rot: [-0.38,  0.51,  0.25] },
  ski:      { pos: [-1.08,  0.81,  0.03], scale: 1.57, rot: [-0.21,  0.28,  0.37] },
};

/** Resolve an object's effective transform for the active arrangement.
 *  Mobile inherits desktop scale/rot unless POS_PORTRAIT overrides them. */
export interface ResolvedTransform {
  pos: [number, number, number];
  scale: number;
  rot: [number, number, number];
}
export function resolveTransform(id: string, mobile: boolean): ResolvedTransform {
  const L = LAYOUT[id]!;
  if (mobile) {
    const P = POS_PORTRAIT[id];
    return {
      pos: P?.pos ?? L.pos,
      scale: P?.scale ?? L.scale,
      rot: P?.rot ?? L.rot,
    };
  }
  return { pos: L.pos, scale: L.scale, rot: L.rot };
}
export const CLUSTER_HALF_W_PORTRAIT = 1.4;
export const CLUSTER_HALF_H_PORTRAIT = 3.1;
// Look ABOVE centre so the cluster sits LOWER in the frame — the top row of
// objects (+ their static labels) clears the big "Some interests" wordmark that
// floats over the top of the section.
export const CAM_LOOK_Y_PORTRAIT = 0.5;
const CAM_HEIGHT_OFFSET = 0.0;
export const VFOV_DEG = 36;
const VFOV_RAD = (VFOV_DEG * Math.PI) / 180;
const HALF_VFOV_TAN = Math.tan(VFOV_RAD / 2);
// Eased from 0.92 so the cluster sits a touch smaller with clear margin top AND
// bottom (the hovered bottom object was clipping the bottom edge).
const FILL_FRACTION = 0.86;
export function camDistanceForAspect(
  aspect: number,
  halfW: number,
  halfH: number,
): number {
  const a = Math.max(0.0001, aspect);
  const distForHeight = halfH / (FILL_FRACTION * HALF_VFOV_TAN);
  const distForWidth = halfW / (FILL_FRACTION * HALF_VFOV_TAN * a);
  return Math.max(distForHeight, distForWidth);
}

// ---------------------------------------------------------------------------
// DESKTOP framing: fit the cluster into the LOWER part of the viewport, leaving
// a clear band at the TOP for the giant "Some interests" wordmark. The header
// floats over the section (pointer-events:none) and was crashing straight through
// the top-row objects (piano / GPU) — user-flagged. We keep the cluster as wide
// as possible but map its HEIGHT into [TOP_RESERVE .. 1 - BOTTOM_MARGIN] of the
// frame, then look ABOVE the cluster centre so the freed space lands up top.
//
// At a ~16:9 aspect, width-binding alone only frees ~0.2 frame-heights of slack —
// not enough for the wordmark — so reserving the band shrinks the cluster a touch
// and small side margins appear. That's the cost of giving the title clean space.
//
// The cluster bounds are DERIVED from the LAYOUT (+ a per-object visual pad), so
// editing the positions reframes the camera automatically — there is no
// hand-maintained half-extent to drift out of sync with the layout.
const _LAYOUT_XABS = Object.values(LAYOUT).map((l) => Math.abs(l.pos[0]));
const _LAYOUT_Y = Object.values(LAYOUT).map((l) => l.pos[1]);
const CLUSTER_PAD = 0.55; // object visual allowance beyond its home centre
const DESK_TOP_Y = Math.max(..._LAYOUT_Y) + CLUSTER_PAD;
const DESK_BOT_Y = Math.min(..._LAYOUT_Y) - CLUSTER_PAD;
const DESK_HALF_W = Math.max(..._LAYOUT_XABS) + CLUSTER_PAD;
// Vertical band the cluster may occupy: top fraction reserved for the wordmark,
// a small bottom breathing margin. WIDTH_FILL keeps it near edge-to-edge.
const TOP_RESERVE = 0.3;
const BOTTOM_MARGIN = 0.04;
const WIDTH_FILL = 0.99;
export interface Framing {
  dist: number;
  lookY: number;
}
export function desktopFraming(aspect: number): Framing {
  const a = Math.max(0.0001, aspect);
  const halfHc = (DESK_TOP_Y - DESK_BOT_Y) / 2; // cluster world half-height
  const centerY = (DESK_TOP_Y + DESK_BOT_Y) / 2; // cluster world centre
  const visibleFracV = 1 - TOP_RESERVE - BOTTOM_MARGIN;
  // Distance so the cluster height fills `visibleFracV` of the frame AND its width
  // fills `WIDTH_FILL` of the frame; take whichever needs MORE distance so neither
  // axis overflows its budget.
  const distForHeight = halfHc / (visibleFracV * HALF_VFOV_TAN);
  const distForWidth = DESK_HALF_W / (WIDTH_FILL * a * HALF_VFOV_TAN);
  const dist = Math.max(distForHeight, distForWidth);
  const visHalfH = dist * HALF_VFOV_TAN;
  // Park the cluster centre at the centre of the reserved band so the slack lands
  // on TOP (under the wordmark) instead of being split evenly top/bottom.
  const bandCenterFrac = (TOP_RESERVE + (1 - BOTTOM_MARGIN)) / 2;
  const lookY = centerY + (bandCenterFrac - 0.5) * 2 * visHalfH;
  return { dist, lookY };
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
        const tr = resolveTransform(h.id, mobile);
        const home = new THREE.Vector3(tr.pos[0], tr.pos[1], tr.pos[2]);
        return {
          id: h.id,
          index: i,
          home,
          pos: home.clone(),
          vel: new THREE.Vector3(),
          radius: L.radius,
          scale: tr.scale,
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
    // frame the landscape spread into the LOWER part of the frame, leaving a clear
    // top band for the wordmark (desktopFraming).
    let lookY: number;
    let dist: number;
    if (mobile) {
      lookY = CAM_LOOK_Y_PORTRAIT;
      dist = camDistanceForAspect(
        aspect,
        CLUSTER_HALF_W_PORTRAIT,
        CLUSTER_HALF_H_PORTRAIT,
      );
    } else {
      const f = desktopFraming(aspect);
      lookY = f.lookY;
      dist = f.dist;
    }
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

    // ---- Containment: keep every body inside the visible frame ----
    // The (frame - radius - margin) box is the hard safety net, but the LAYOUT
    // home slots deliberately fill the frame EDGE-TO-EDGE with big props, so
    // several homes sit OUTSIDE that naive box. Clamping
    // to it would yank those objects inward and bunch the cluster (the left-side
    // pile-up + vertical squash the user saw). So each body's limit is the UNION
    // of the safety box and its OWN tuned home extent: a body may always rest at
    // its tuned slot, and the clamp only stops DRIFT from carrying it any further
    // off-frame than that slot already sits. Interior bodies (home well inside the
    // safety box) are unaffected — they keep the original frame clamp.
    // The visible frame spans world Y [lookY - visHalfH, lookY + visHalfH] and
    // world X [-visHalfW, visHalfW]; a body of radius er stays fully inside with
    // margin when its centre is within (edge - er - EDGE_MARGIN). lookY is now well
    // off zero (the cluster is parked low so the wordmark gets the top band), so
    // the band MUST be computed around lookY — a symmetric-about-origin clamp would
    // be wrong. Each limit is then unioned with the body's tuned home so the clamp
    // never pulls a body inward of its tuned slot, only stops outward drift.
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i]!;
      // Same clamp whether or not this body is focused, so hovering never snaps it.
      const er = b.radius;
      const sideLim = Math.max(visHalfW - er - EDGE_MARGIN, Math.abs(b.home.x));
      const topLim = Math.max(lookY + visHalfH - er - EDGE_MARGIN, b.home.y);
      const botLim = Math.min(lookY - visHalfH + er + EDGE_MARGIN, b.home.y);
      if (b.pos.x > sideLim) { b.pos.x = sideLim; if (b.vel.x > 0) b.vel.x *= -0.3; }
      else if (b.pos.x < -sideLim) { b.pos.x = -sideLim; if (b.vel.x < 0) b.vel.x *= -0.3; }
      if (b.pos.y > topLim) { b.pos.y = topLim; if (b.vel.y > 0) b.vel.y *= -0.3; }
      else if (b.pos.y < botLim) { b.pos.y = botLim; if (b.vel.y < 0) b.vel.y *= -0.3; }
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
      if (entry.loaded) {
        // Already resolved — possibly in the GAP between this component's initial
        // state snapshot and this effect running. Returning here (the old code)
        // left such a GLB neither in the snapshot NOR subscribed, so it was stuck
        // on its placeholder forever (a fast scroll-to-section right after load
        // could strand 2-3 props — and showing a placeholder for a GLB that DID
        // load violates "never fake"). Fold it into state instead. Mirrors the
        // useHobbyScenes hook's loaded-entry handling.
        setLoaded((p) => (h.id in p ? p : { ...p, [h.id]: entry.scene }));
        return;
      }
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
