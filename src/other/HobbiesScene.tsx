import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Hobbies scene: 10 floating 3D objects representing personal
 * interests, arranged as a loose asymmetric cluster in empty space.
 *
 * POST-REDESIGN (curated reel mode):
 *   The parent Other.tsx now pins the section and cycles through one
 *   hobby at a time. This scene FOCUSES one object per beat: the
 *   camera dollies toward the focused object's world position, the
 *   focused object scales up + glows lightly, and the other nine
 *   recede (opacity 0.15, scale 0.55, pushed outward from origin).
 *   The whole scene feels like a curated reel rather than a cluster.
 *
 * Props (post-redesign):
 *   - focusRef: 0..N-1 fractional. Integer part = current focused
 *     hobby index, fractional part = transition progress to the next.
 *     The scene reads this each frame and smoothly tweens camera +
 *     per-object material state.
 *   - hobbyIds: ordered array of hobby ids from the parent. Must
 *     match the order the parent uses for its reel. Lets the scene
 *     map focusRef -> hobby id without duplicating the master list.
 *
 * Backwards-compat:
 *   - The old pinProgressRef API has been retired. Other.tsx is the
 *     only consumer.
 *
 * Each item:
 *   - Loads its GLB from /public/hobbies/{file} in parallel via
 *     GLTFLoader. Module-scope preload kicks the requests off at
 *     import time so the first scroll into the section finds the
 *     assets already cached (or in flight). Until the asset arrives
 *     (or if it 404s), a varied primitive placeholder occupies the
 *     same slot so the layout is correct from t=0.
 *   - Has independent gentle Y bob + a small front-facing SWAY (a
 *     bounded oscillation about identity, never a full rotation, so the
 *     authored front face always stays toward the camera). Phases are
 *     per-item so the cluster feels organic rather than mechanical.
 *
 * Tooltip:
 *   - DOM <div> overlaid on the canvas. Positioned via mousemove
 *     listener at cursor + 20px offset. 180ms enter delay,
 *     200ms leave delay.
 *   - Tap to show / tap elsewhere to dismiss on touch.
 */

interface Hobby {
  id: string;
  file: string;
  label: string;
}

// Master roster: order must match the parent's HOBBIES array. The
// parent passes `hobbyIds` so we can detect mismatches if the lists
// ever drift.
const HOBBIES: Hobby[] = [
  { id: "belt",     file: "belt.glb",     label: "Taekwondo"   },
  { id: "piano",    file: "piano.glb",    label: "Piano"       },
  { id: "pc",       file: "pc.glb",       label: "Workstation" },
  { id: "shoe",     file: "shoe.glb",     label: "Fashion"     },
  { id: "keyboard", file: "keyboard.glb", label: "Keyboards"   },
  { id: "cursor",   file: "cursor.glb",   label: "Design"      },
  { id: "turbo",    file: "turbo.glb",    label: "Cars"        },
  { id: "yarn",     file: "yarn.glb",     label: "Crocheting"  },
  { id: "luggage",  file: "luggage.glb",  label: "Travel"      },
  { id: "ski",      file: "ski.glb",      label: "Skiing"      },
];

/**
 * Per-hobby world-space slot in the cluster. The reel mode dollies
 * the camera toward the focused slot's position so each hobby gets
 * its own "framed" view. Positions are spread around origin so the
 * camera rotation between hobbies feels meaningful (not all stacked
 * in one corner).
 *
 * ARTFUL ARRANGEMENT (overhaul): the previous slots scattered the
 * objects roughly evenly which read as random. These positions form a
 * deliberate, asymmetric, depth-staggered cluster: a loose rising
 * diagonal from lower-left to upper-right, with a few objects pushed
 * deep (-z) and a few pulled near (+z) so the composition has front-to-
 * back layering rather than a flat ring. The camera orbits whichever
 * slot is focused, so each becomes the centred hero in turn; the
 * surrounding slots (pushed further out by DIM_OUTWARD when dim) frame
 * it instead of crowding it. Envelope kept inside roughly -1.5..+1.5 so
 * dim neighbours never wander to the frame edges.
 */
const LAYOUT: Record<string, { pos: [number, number, number]; placeholder: PlaceholderKind }> = {
  belt:     { pos: [-1.35, -0.55, -0.18], placeholder: "dodecahedron" },
  piano:    { pos: [-0.92,  0.58,  0.22], placeholder: "box"          },
  pc:       { pos: [-0.05, -0.10,  0.30], placeholder: "icosahedron"  },
  shoe:     { pos: [ 0.62, -0.72,  0.10], placeholder: "cone"         },
  keyboard: { pos: [ 1.20,  0.05,  0.20], placeholder: "torus"        },
  cursor:   { pos: [ 0.78,  0.98, -0.15], placeholder: "octahedron"   },
  turbo:    { pos: [ 1.42, -0.42, -0.22], placeholder: "cylinder"     },
  yarn:     { pos: [-0.62,  1.00,  0.28], placeholder: "sphere"       },
  luggage:  { pos: [ 0.18, -1.02, -0.28], placeholder: "tetrahedron"  },
  ski:      { pos: [-0.55,  0.28, -0.30], placeholder: "ring"         },
};

/**
 * ORIENTATION MODEL: FRONT-FACING ALWAYS.
 *
 * Every model is authored in Blender so that rotation identity (0,0,0)
 * is its correct FRONT face, i.e. at rest the object looks straight at
 * the camera. The code therefore NEVER rotates an object to an arbitrary
 * authored angle and NEVER spins it continuously (which would turn its
 * back / underside to the viewer). The earlier per-hobby `HERO_ROT`
 * guessed-Euler table and the idle-tumble spin have been removed for
 * exactly this reason: they were what flipped objects backward.
 *
 * Instead each object gets a gentle SWAY around the front-facing pose:
 *   - small yaw (Y) oscillation: ±SWAY_YAW
 *   - smaller pitch (X) oscillation: ±SWAY_PITCH
 *   - a tiny roll (Z) shimmer: ±SWAY_ROLL
 * centred on identity, with a per-object phase offset so the ten objects
 * are not synchronised. The amplitude stays small enough that the front
 * face always dominates; it is a breathing motion, not a rotation. When
 * an object is FOCUSED the sway is damped further (FOCUS_SWAY_DAMP) and a
 * tiny flattering downward look (FOCUS_PITCH) is applied so the hero
 * reads cleanly and head-on.
 *
 * The three real GLBs (piano, keyboard, ski) currently still carry
 * non-front Blender orientations; once the user re-exports them with the
 * front face at identity they will face the camera here automatically,
 * because the code applies no per-object correction.
 */
// Sway amplitudes (radians) around the front-facing identity pose.
const SWAY_YAW = 0.17;    // ~±9.7° on Y, the dominant lively motion
const SWAY_PITCH = 0.06;  // ~±3.4° on X, gentle nod
const SWAY_ROLL = 0.03;   // ~±1.7° on Z, barely-there shimmer
// Sway angular periods (seconds), co-prime-ish so the axes don't beat
// back into lockstep, keeping the motion organic per object.
const SWAY_YAW_PERIOD = 6.5;
const SWAY_PITCH_PERIOD = 5.1;
const SWAY_ROLL_PERIOD = 7.3;
// While focused, scale the sway down to this fraction so the hero reads
// clearly (still alive, but near-still and front-dominant).
const FOCUS_SWAY_DAMP = 0.35;
// A small downward-look pitch (radians) eased in as an object focuses,
// a flattering 3/4-ish tip that keeps the front face toward the camera.
const FOCUS_PITCH = 0.07; // ~4° nose-down

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

// Placeholder tones: cool-retro-futurism palette. The DIM tone is a
// cool graphite (ink family) so an out-of-focus artifact reads as a
// neutral machined object; the HOT tone is the signature orange
// (var(--accent) #e87040) so the focused object snaps to brand colour.
// Per-kind dim tones (below) nudge each placeholder along a tight
// graphite→clay axis so the ten artifacts read as distinct without
// introducing any off-palette chroma (no teal/purple/etc; design
// system rule: white + ink + orange only).
const PLACEHOLDER_COLOR = "#6f7378";       // cool graphite base
const FOCUSED_PLACEHOLDER_COLOR = "#e87040"; // var(--accent)

// Per-kind dim base tone: all within the cool-graphite → warm-clay
// neutral band that sits comfortably beside the orange accent. Keeps
// each artifact individually legible while the palette stays honest.
// Deepened from the first pass so the dim artifacts hold presence
// against the bright cool-white page instead of washing out.
const PLACEHOLDER_TONES: Record<PlaceholderKind, string> = {
  dodecahedron: "#4c5158", // cool slate
  box:          "#646970", // light graphite
  icosahedron:  "#565b62", // mid graphite
  cone:         "#766a5f", // warm taupe
  torus:        "#6c6256", // clay-grey
  octahedron:   "#5d6168", // neutral steel
  cylinder:     "#71665c", // warm stone
  sphere:       "#52565d", // deep graphite
  tetrahedron:  "#796d61", // pale clay
  ring:         "#62666d", // brushed steel
};

// prefers-reduced-motion: read once at module load. When set, the scene
// parks statically: objects sit at their layout slots with no idle bob,
// no per-object rotation, and the camera holds a fixed framing (no slow
// orbit drift). Focus changes (dot-strip jump) still re-frame, but as an
// instant settle rather than a continuous animation. The reel cannot
// scroll-scrub under reduced motion (the parent disables the pin), so
// this scene is effectively a still life unless a dot is activated.
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
      return <torusGeometry args={[r * 0.85, r * 0.32, 12, 32]} />;
    case "cone":
      return <coneGeometry args={[r, size * 1.2, 16]} />;
    case "octahedron":
      return <octahedronGeometry args={[r, 0]} />;
    case "dodecahedron":
      return <dodecahedronGeometry args={[r, 0]} />;
    case "cylinder":
      return <cylinderGeometry args={[r * 0.7, r * 0.85, size * 0.9, 16]} />;
    case "sphere":
      return <sphereGeometry args={[r, 20, 16]} />;
    case "tetrahedron":
      return <tetrahedronGeometry args={[r * 1.05, 0]} />;
    case "ring":
      return <torusGeometry args={[r * 0.95, r * 0.18, 8, 28]} />;
  }
}

// ----------------------------------------------------------------------
// Module-scope GLB preload: kick off the loads as soon as this module
// is imported, not on first canvas mount. Even though the canvas waits
// on the GLB to arrive, having the requests already in flight by the
// time the canvas mounts means the placeholder → real-mesh swap
// happens almost instantly.
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
  // Create every entry up front so subscribers can attach before any load
  // finishes, then pump the actual requests through a small concurrency
  // limit. Firing all ~10 GLB loads at once saturated the socket pool and
  // starved first-paint assets (fonts, the room mesh); capping in-flight to
  // 3 paces the SAME loads without delaying them past when the user reaches
  // the Other section. Behaviour (entries, listener callbacks) is unchanged.
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
        // 404 / parse error: placeholder takes over.
        () => finish(null),
      );
    }
  };
  pump();
}
startPreload();

/** Per-item deterministic animation params: same id → same motion. */
interface AnimParams {
  bobAmp: number;
  bobPeriod: number;
  bobPhase: number;
  // Per-object sway phase offsets (radians) on each axis so the ten
  // objects breathe out of sync, organic, but all centred on the
  // front-facing identity pose. NO continuous rotation, NO authored
  // per-object yaw: the sway only ever oscillates ±SWAY_* about front.
  swayPhaseY: number;
  swayPhaseX: number;
  swayPhaseZ: number;
}
function makeAnim(id: string): AnimParams {
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
  return {
    bobAmp: 0.08 + rand() * 0.05,
    bobPeriod: 3 + rand() * 3,
    bobPhase: rand() * Math.PI * 2,
    swayPhaseY: rand() * Math.PI * 2,
    swayPhaseX: rand() * Math.PI * 2,
    swayPhaseZ: rand() * Math.PI * 2,
  };
}

// PERF: module-scope euler scratch reused by every HobbyMesh's per-frame
// sway write so the rotation update never allocates inside useFrame
// (60Hz × 10 meshes). The sway is applied directly to group.rotation
// (small Euler angles about identity), so a single scratch euler is all
// we need, no quaternion slerp / accumulation.
const _eSway = new THREE.Euler(0, 0, 0, "XYZ");

interface HobbyMeshProps {
  hobby: Hobby;
  scene: THREE.Group | null;
  index: number;
  /** Committed active (integer) hobby index from the parent, resolved
   *  via NEAREST + hysteresis. The mesh compares its own `index` to this
   *  each frame: equal ⇒ this is the hero (weight → 1), otherwise dim
   *  (weight → 0). Driving the weight from the *committed* index (rather
   *  than a fractional floor(focusRef)) guarantees exactly one hero with
   *  no in-between state, and keeps the highlight in lockstep with the
   *  floating label, which uses the same index. */
  activeIdxRef: React.RefObject<number>;
  /** Set when the section is on-screen (parent's IntersectionObserver).
   *  Per-frame transforms / opacity tweens are skipped while hidden so
   *  the canvas doesn't spend GPU + JS time on an invisible scene. */
  visibleRef: React.RefObject<boolean>;
  onHoverChange: (hovering: boolean, label: string) => void;
}

// How much non-focused objects shrink relative to base (1.0). Kept well
// below the focused scale so a dim neighbour that happens to sit a touch
// closer to the camera still never out-sizes the centred hero (the old
// 0.82 let a near neighbour visually compete with the focused object).
const DIM_SCALE = 0.55;
// How much the focused object grows above base.
//
// "FULLY VISIBLE WITH MARGIN" tune: the previous 2.10 (radius ~1.26)
// was LARGER than the visible half-height at the old close camera
// (~0.9), so the focused object clipped off the top/bottom and sides.
// Dropped to 1.5 (normalized radius 0.6 × 1.5 = 0.90) and PAIRED with a
// pulled-back camera (CAM_DISTANCE 4.4) whose visible half-height is
// ~1.51, so the object fills ~60% of the frame's short axis: big and
// commanding, but with clear margin on every side. Bigger-but-visible
// beats bigger-but-clipped.
const FOCUS_SCALE = 1.5;
// How far non-focused objects drift outward from origin (multiplier
// on their layout position). Raised so dim neighbours clear well away
// from the centred hero and read as a framing halo rather than crowding
// / clipping into it. Note the camera orbits the FOCUSED slot, so
// "outward from origin" also tends to push neighbours toward the frame
// edges of whichever hero is centred, exactly the framing-halo read we
// want.
const DIM_OUTWARD = 2.0;

// Opacity band. DIM raised 0.18 → 0.42 so out-of-focus artifacts read
// as "present but secondary" rather than ghosted; FOCUS lands at a
// true 1.0 so the active object is fully vivid. The focused write is
// also force-clamped to >= 0.995 whenever its focus weight resolves to
// ~1 (see useFrame) so the threshold gate can never leave it dim.
const DIM_OPACITY = 0.42;
const FOCUS_OPACITY = 1.0;

// PERF: pre-allocated THREE.Color instance used for the per-frame
// placeholder color lerp HOT endpoint. The DIM endpoint is per-instance
// (each kind has its own tone) so it lives on the component via a ref.
// Allocating `new THREE.Color()` inside useFrame (60Hz × 10 hobbies)
// would churn the GC, so the hot color is shared + immutable.
const PLACEHOLDER_COLOR_HOT = new THREE.Color(FOCUSED_PLACEHOLDER_COLOR);

function HobbyMesh({ hobby, scene, index, activeIdxRef, visibleRef, onHoverChange }: HobbyMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const hoveredRef = useRef(false);
  const hoverLerpRef = useRef(0);
  // Smoothed focus weight (0 = fully dim, 1 = fully focused). Tracks
  // a triangle-shaped target derived from |index - focusRef|.
  const focusLerpRef = useRef(0);
  // Last applied opacity: when nothing has changed materially we skip
  // the per-material traverse below.
  const lastOpacityRef = useRef(-1);
  // Mirrors lastOpacityRef but gates the matRef placeholder writes.
  // OLD: matRef block ran unconditionally every frame (O(1) writes × frame-rate).
  // NEW: writes only on visible weight delta > threshold (O(1) amortised).
  const lastMatWeightRef = useRef(-1);

  const layout = LAYOUT[hobby.id]!;
  const anim = useMemo(() => makeAnim(hobby.id), [hobby.id]);

  // Per-instance dim tone (each placeholder kind reads as a distinct
  // machined artifact). Pre-allocated so the per-frame color lerp never
  // allocates. Falls back to the shared graphite base if a kind is
  // somehow missing from the tone map.
  const dimColor = useMemo(
    () => new THREE.Color(PLACEHOLDER_TONES[layout.placeholder] ?? PLACEHOLDER_COLOR),
    [layout.placeholder],
  );

  // Normalize GLB scale so every hobby reads at consistent size
  // regardless of how it was modeled. PERF: we ALSO collect a flat
  // list of every material in the cloned tree so the per-frame opacity
  // update can iterate a small array instead of traversing the entire
  // scene graph every frame (traverse allocates closures and walks
  // children recursively, expensive at 60Hz × 10 hobbies).
  const normalizedScene = useMemo(() => {
    if (!scene) return null;
    const cloned = scene.clone(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const targetRadius = 0.6;
    const k = sphere.radius > 0 ? targetRadius / sphere.radius : 1;
    cloned.scale.setScalar(k);
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
    cloned.position.sub(center);
    return cloned;
  }, [scene]);

  // Flat material list collected once when normalizedScene resolves,
  // used by the per-frame opacity update (no traverse per tick). Each
  // material starts transparent+dim; the useFrame loop drives it to the
  // correct opacity (and flips transparent off once it reaches full).
  const sceneMaterials = useMemo<THREE.Material[]>(() => {
    if (!normalizedScene) return [];
    const list: THREE.Material[] = [];
    const seed = (m: THREE.Material) => {
      m.transparent = true;
      m.opacity = DIM_OPACITY;
      list.push(m);
    };
    normalizedScene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach(seed);
      else seed(mat);
    });
    return list;
  }, [normalizedScene]);

  // Reset the opacity-write memo whenever the material set changes
  // (placeholder → GLB swap) so the first post-swap frame always
  // re-applies opacity to the freshly collected materials instead of
  // being skipped by the threshold gate against a stale value.
  useEffect(() => {
    lastOpacityRef.current = -1;
    lastMatWeightRef.current = -1;
  }, [sceneMaterials]);

  useFrame((state, dt) => {
    const g = groupRef.current;
    if (!g) return;
    // PERF: skip per-frame work entirely when the section isn't on
    // screen. visibleRef is toggled by the parent's IntersectionObserver.
    if (visibleRef && visibleRef.current === false) return;

    // Compute target focus weight.
    //
    // BUGFIX HISTORY:
    //   v1 used `1 - |index - f| / 0.6`, a narrow triangle on the integer
    //      index: the active object only hit weight 1 at the exact
    //      integer, so for most of each slot NOTHING was focused (ghosting).
    //   v2 used `floor(f)` with a tail crossfade. Better, but the crossfade
    //      window (sub > 0.75) plus the label's own boundary fade created a
    //      DEAD-ZONE between hobbies where neither object clearly read as
    //      the hero and the label blanked out, giving the glitchy/twitchy feel.
    //
    // CURRENT model: the hero is the parent's COMMITTED active index
    // (NEAREST + hysteresis, the same index the label + dot strip use).
    // The target weight is binary (1 for the hero, 0 for everyone else),
    // and the exponential `focusLerpRef` below smooths the handoff. Because
    // the active index only changes once (hysteresis prevents flicker), the
    // handoff is a single clean crossfade between the old hero and the new
    // one, never an ambiguous in-between with two half-lit objects.
    const activeIdx = activeIdxRef.current ?? 0;
    const targetWeight = index === activeIdx ? 1 : 0;
    // Smooth toward target: exponential lerp so a focus change (scroll
    // crossing a hysteresis boundary, or a dot-strip jump) eases rather
    // than snaps. Same smoothness model as before; only the target source
    // changed (committed index instead of fractional floor).
    // dt*7 → dt*4.5: slower focus-weight ease so each object's scale/
    // opacity arrival between hobbies feels more gradual (matches the
    // slower camera glide + the widened reel window in Other.tsx).
    focusLerpRef.current += (targetWeight - focusLerpRef.current) * (1 - Math.exp(-dt * 4.5));
    const weight = focusLerpRef.current;

    // Bob: sinusoidal Y offset around an outward-pushed layout pos.
    // Non-focused items drift outward via DIM_OUTWARD, focused snap
    // back to their layout slot.
    const outward = DIM_OUTWARD - (DIM_OUTWARD - 1) * weight;
    const t = state.clock.elapsedTime;
    // Reduced motion: no idle bob, no per-object rotation. The object
    // still snaps between its outward (dim) and layout (focused) slot so
    // dot-strip jumps re-frame, but it doesn't float or spin.
    const bobY = PREFERS_REDUCED_MOTION
      ? 0
      : Math.sin((t / anim.bobPeriod) * Math.PI * 2 + anim.bobPhase) * anim.bobAmp;
    g.position.set(
      layout.pos[0] * outward,
      layout.pos[1] * outward + bobY,
      layout.pos[2] * outward,
    );
    // ---- Rotation: gentle FRONT-FACING sway (never a full rotation) ----
    // The object is authored so identity == its front face toward the
    // camera. We only ever apply a small oscillation about that pose, so
    // the front always dominates and the back/underside is never shown.
    // Focused objects damp the sway further (read clearly) and pick up a
    // tiny flattering downward look; dim objects sway a touch more so the
    // surrounding cluster still feels alive. No continuous spin, no
    // authored per-object yaw.
    if (PREFERS_REDUCED_MOTION) {
      // Static still life: park front-facing. Focused hero gets the small
      // flattering downward look; everything else sits at identity.
      g.rotation.set(FOCUS_PITCH * weight, 0, 0);
    } else {
      // Damp amplitude as the object focuses (1 - weight blends from full
      // sway when dim toward FOCUS_SWAY_DAMP of it when focused).
      const damp = 1 - (1 - FOCUS_SWAY_DAMP) * weight;
      const yaw =
        Math.sin((t / SWAY_YAW_PERIOD) * Math.PI * 2 + anim.swayPhaseY) *
        SWAY_YAW * damp;
      const pitch =
        Math.sin((t / SWAY_PITCH_PERIOD) * Math.PI * 2 + anim.swayPhaseX) *
        SWAY_PITCH * damp +
        FOCUS_PITCH * weight; // flattering nose-down as it focuses
      const roll =
        Math.sin((t / SWAY_ROLL_PERIOD) * Math.PI * 2 + anim.swayPhaseZ) *
        SWAY_ROLL * damp;
      _eSway.set(pitch, yaw, roll);
      g.rotation.copy(_eSway);
    }

    // Hover scale on top of the focus-driven base scale.
    const target = hoveredRef.current ? 1.1 : 1.0;
    hoverLerpRef.current += (target - hoverLerpRef.current) * (1 - Math.exp(-dt * 8));
    const focusScale = DIM_SCALE + (FOCUS_SCALE - DIM_SCALE) * weight;
    g.scale.setScalar(hoverLerpRef.current * focusScale);

    // Opacity dim: non-focused items at DIM_OPACITY, focused at 1.0.
    // Snap to a clean FOCUS_OPACITY when weight is essentially 1 so the
    // active object can never be left fractionally transparent by the
    // lerp's asymptotic tail (it approaches but never exactly reaches 1).
    let targetOp = DIM_OPACITY + (FOCUS_OPACITY - DIM_OPACITY) * weight;
    if (weight > 0.985) targetOp = FOCUS_OPACITY;
    // A material only needs the (sorting-prone) transparent pass while
    // it's actually < 1. At full opacity we flip transparent off so the
    // focused object renders crisp in the opaque pass, no depth-sort
    // wash, no blend against the bright page background.
    const needsTransparent = targetOp < 0.995;

    if (matRef.current && Math.abs(weight - lastMatWeightRef.current) > 0.003) {
      lastMatWeightRef.current = weight;
      matRef.current.opacity = targetOp;
      matRef.current.transparent = needsTransparent;
      matRef.current.depthWrite = !needsTransparent;
      // PERF: reuse the pre-allocated per-instance dim color + shared hot
      // color (used to be `new THREE.Color(...)` per frame × 10 hobbies).
      matRef.current.color.lerpColors(dimColor, PLACEHOLDER_COLOR_HOT, weight);
      // Light emissive lift on the focused placeholder so it glows
      // slightly into the orange rather than just brightening flatly.
      matRef.current.emissive.copy(PLACEHOLDER_COLOR_HOT);
      matRef.current.emissiveIntensity = 0.18 * weight;
    }
    // PERF: write opacity only when it has visibly changed. With 10
    // hobbies each carrying dozens of GLB materials, the unconditional
    // write was ~hundreds of property sets per frame even when nothing
    // moved. Threshold gates the iteration to actual transitions.
    if (Math.abs(targetOp - lastOpacityRef.current) > 0.003) {
      lastOpacityRef.current = targetOp;
      // Iterate the cached flat material list (no scene traversal).
      for (let i = 0; i < sceneMaterials.length; i++) {
        const m = sceneMaterials[i]!;
        m.opacity = targetOp;
        // Keep transparency state in sync so a focused GLB renders in
        // the opaque pass (crisp) and a dim one blends correctly.
        if (m.transparent !== needsTransparent) {
          m.transparent = needsTransparent;
          m.depthWrite = !needsTransparent;
          m.needsUpdate = true;
        }
      }
    }
  });

  // Rotation is fully driven each frame by the useFrame sway block
  // (small oscillation about the front-facing identity pose), so no
  // mount-time rotation write is needed.

  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hoveredRef.current = true;
    onHoverChange(true, hobby.label);
  };
  const onPointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hoveredRef.current = false;
    onHoverChange(false, hobby.label);
  };

  return (
    <group ref={groupRef} onPointerOver={onPointerOver} onPointerOut={onPointerOut}>
      {normalizedScene ? (
        <primitive object={normalizedScene} />
      ) : (
        <mesh castShadow={false} receiveShadow={false}>
          <PlaceholderMesh kind={layout.placeholder} size={0.7} />
          {/* Slightly polished retro-machined look: lower roughness +
              a touch more metalness picks up the directional rim so the
              artifacts read as crafted objects, not flat clay blobs. The
              useFrame loop drives color / opacity / emissive each tick. */}
          <meshStandardMaterial
            ref={matRef}
            color={PLACEHOLDER_COLOR}
            roughness={0.42}
            metalness={0.28}
            transparent
            opacity={DIM_OPACITY}
          />
        </mesh>
      )}
    </group>
  );
}

// Camera dolly geometry: the camera orbits around the FOCUSED object's
// world position, sitting at a fixed offset. As focus shifts between
// hobbies the lookAt + camera position both lerp to the new target.
//
// "FULLY VISIBLE WITH MARGIN" tune: the previous 2.6 was too close. At
// 38° fov the visible half-height was only ~0.9 world units, smaller
// than the focused object's radius (~1.26 at the old FOCUS_SCALE), so
// the hero clipped off the edges. Pulled back to 4.4: visible
// half-height ≈ 4.4·tan(19°) ≈ 1.51, and the focused radius is now ~0.9
// (FOCUS_SCALE 1.5), so the hero sits at ~60% of the short axis with a
// generous margin all around. Slightly above the focus for a flattering
// 3/4 read. Well clear of the 0.1 near plane / 50 far plane.
const CAM_DISTANCE = 4.4;     // camera-to-focus distance (landscape baseline)
const CAM_HEIGHT_OFFSET = 0.35; // camera sits this much above focus
// PORTRAIT FRAMING GUARD: the focused hero's normalized world radius
// (targetRadius 0.6 × FOCUS_SCALE 1.5 ≈ 0.9). On a wide aspect the
// vertical fov (38°) is the limiting axis and 4.4 frames it with margin.
// In a tall narrow phone viewport (aspect < 1) the HORIZONTAL extent
// becomes the tight axis (horizontal half-width = d·tan(vfov/2)·aspect),
// so the same 4.4 clips the hero's sides. We pull the camera back just
// enough that the LIMITING axis still fits the hero at ~FILL_FRACTION of
// the frame's short side. Computed per-frame from the live canvas aspect
// (state.size) so a portrait↔landscape rotation re-frames correctly.
const FOCUS_WORLD_RADIUS = 0.6 * FOCUS_SCALE; // ≈ 0.9
const VFOV_RAD = (38 * Math.PI) / 180;
const HALF_VFOV_TAN = Math.tan(VFOV_RAD / 2);
// Aim the hero at ~60% of the short axis (radius vs half-extent): clear
// margin all around without looking lost in space.
const FILL_FRACTION = 0.6;
/** Distance at which FOCUS_WORLD_RADIUS fills FILL_FRACTION of the frame's
 *  LIMITING (short) axis for a given canvas aspect (w/h). At aspect ≥ 1 the
 *  vertical axis limits → returns the landscape baseline; below 1 the
 *  horizontal axis limits → distance scales up by 1/aspect. */
function camDistanceForAspect(aspect: number): number {
  const minAxis = Math.min(1, aspect); // <1 ⇒ horizontal is the tight axis
  const need =
    FOCUS_WORLD_RADIUS / (FILL_FRACTION * HALF_VFOV_TAN * Math.max(0.0001, minAxis));
  // Never pull CLOSER than the authored landscape distance (keeps the
  // desktop framing exactly as tuned); only ever pull back for portrait.
  return Math.max(CAM_DISTANCE, need);
}
// How fast camera position/lookAt lerps to the new focus per second.
// 2.4 = ~420ms catch-up at 60fps (lowered from 4.0 ≈ 250ms): a more
// deliberate, cinematic glide between hobbies so the jump rate between
// the 3D objects reads slower. Still settles well within a chip-click.
const CAM_LERP_RATE = 2.4;
// Bounded orbit sway about dead-front. The camera oscillates within
// ±CAM_ORBIT_AMP radians of straight-on (so it NEVER swings around to an
// object's side/back (the front-facing rule), at CAM_ORBIT_RATE rad/s
// on the sine phase. ~6° of parallax keeps the framing alive without
// spoiling the head-on read of the authored front faces.
const CAM_ORBIT_AMP = 0.11;   // ~±6.3° of yaw about dead-front
const CAM_ORBIT_RATE = 0.22;  // sine-phase speed (rad/s)

function SceneInner({
  loaded,
  activeIdxRef,
  visibleRef,
  onHoverChange,
}: {
  loaded: Record<string, THREE.Group | null>;
  activeIdxRef: React.RefObject<number>;
  visibleRef: React.RefObject<boolean>;
  onHoverChange: (hovering: boolean, label: string) => void;
}) {
  const { camera, invalidate } = useThree();
  const targetLookAt = useRef(new THREE.Vector3(0, 0, 0));
  const currentLookAt = useRef(new THREE.Vector3(0, 0, 0));
  const targetCamPos = useRef(new THREE.Vector3(0, 0, CAM_DISTANCE));
  // Orbit phase around the focus target: drives a BOUNDED gentle
  // oscillation about head-on (angle 0 == camera directly in front along
  // +Z), NOT an unbounded accumulating orbit. Objects are authored so
  // identity faces +Z; a continuously-drifting orbit would eventually
  // swing the camera around to their sides/backs, defeating the
  // front-facing rule. Instead the camera sways within ±CAM_ORBIT_AMP of
  // dead-front, so the front face is always toward the viewer while still
  // getting a touch of parallax life.
  const orbitPhaseRef = useRef(0);

  useFrame((state, dt) => {
    // PERF: skip the camera dolly logic when the scene is off-screen.
    // Combined with frameloop="demand" on the Canvas, this lets the
    // canvas idle entirely while the user is elsewhere on the page.
    if (visibleRef.current === false) return;
    // Keep the demand loop alive while visible.
    invalidate();
    // Aspect-aware dolly distance: pull back in portrait so the hero's
    // sides aren't clipped in a tall narrow viewport (see
    // camDistanceForAspect). state.size is the live canvas pixel size.
    const aspect =
      state.size.height > 0 ? state.size.width / state.size.height : 1;
    const camDist = camDistanceForAspect(aspect);
    // Camera framing locks onto the COMMITTED active hero (the same
    // NEAREST+hysteresis index the label + per-mesh highlight use), not a
    // fractional floor(focusRef). The target snaps to the active slot's
    // world position; the exponential lerp below (CAM_LERP_RATE) provides
    // the smooth (but not hair-trigger) handoff between heroes. Because
    // the target is the committed index, the camera never sits halfway
    // between two slots framing nothing: there is always exactly one hero
    // centred, matching the label.
    const idx = Math.max(
      0,
      Math.min(HOBBIES.length - 1, activeIdxRef.current ?? 0),
    );
    const a = HOBBIES[idx]!;
    const layA = LAYOUT[a.id]!;
    targetLookAt.current.set(layA.pos[0], layA.pos[1], layA.pos[2]);

    // Advance the orbit PHASE slowly so the framing breathes, then map it
    // to a BOUNDED sway about head-on via sin(). Frozen under reduced
    // motion so the camera holds a fixed, dead-front framing (no orbit).
    // Focus jumps still re-frame via the lerp below.
    if (!PREFERS_REDUCED_MOTION) {
      orbitPhaseRef.current += dt * CAM_ORBIT_RATE;
    }
    // Bounded orbit angle: oscillates within ±CAM_ORBIT_AMP of dead-front
    // (angle 0). Never accumulates past front, so the objects' authored
    // front faces stay toward the camera at all times.
    const angle = Math.sin(orbitPhaseRef.current) * CAM_ORBIT_AMP;

    // Camera sits on an arc around the lookAt point, at a fixed distance +
    // height offset, swaying gently to either side of dead-front.
    targetCamPos.current.set(
      targetLookAt.current.x + Math.sin(angle) * camDist,
      targetLookAt.current.y + CAM_HEIGHT_OFFSET,
      targetLookAt.current.z + Math.cos(angle) * camDist,
    );

    // Exponential lerp toward target. Same easing on lookAt + camPos
    // so the camera moves as one rigid system rather than separately.
    const k = 1 - Math.exp(-dt * CAM_LERP_RATE);
    currentLookAt.current.lerp(targetLookAt.current, k);
    camera.position.lerp(targetCamPos.current, k);
    camera.lookAt(currentLookAt.current);
  });

  return (
    <>
      {/* Cool-retro lighting: a clean neutral key picks out form, a low
          cool fill keeps shadow sides from going muddy against the
          white-grey page, and a warm orange-tinted rim from behind ties
          the objects to the accent without warming the whole scene. */}
      <ambientLight intensity={0.45} color="#eef1f4" />
      <directionalLight position={[4, 6, 3]} intensity={2.4} color="#ffffff" />
      <directionalLight position={[-4, 4, 2]} intensity={0.7} color="#d7dde3" />
      <directionalLight position={[-2, 2, -5]} intensity={0.9} color="#e87040" />
      {HOBBIES.map((h, i) => (
        <HobbyMesh
          key={h.id}
          hobby={h}
          index={i}
          scene={loaded[h.id] ?? null}
          activeIdxRef={activeIdxRef}
          visibleRef={visibleRef}
          onHoverChange={onHoverChange}
        />
      ))}
    </>
  );
}

const HOVER_ENTER_DELAY_MS = 180;
const HOVER_LEAVE_DELAY_MS = 200;

interface TooltipState {
  visible: boolean;
  label: string;
  x: number;
  y: number;
}

interface HobbiesSceneProps {
  /** 0..N-1 fractional focus index: integer = current hobby,
   *  fractional = transition progress to the next. Used only for the
   *  smooth camera dolly tween between heroes. */
  focusRef: React.RefObject<number>;
  /** Committed active (integer) hobby index, resolved by the parent with
   *  NEAREST + hysteresis. This is the single source of truth for "which
   *  object is the hero": the per-mesh focus weight + the camera framing
   *  both target THIS index, so exactly one object reads as focused at
   *  all times (no in-between dead-zone) and the highlight always agrees
   *  with the floating label, which uses the same index. */
  activeIdxRef: React.RefObject<number>;
  /** Ordered hobby ids from the parent. Provided as a sanity guard
   *  that parent + scene rosters agree; logged once on mount if not. */
  hobbyIds?: string[];
}

export function HobbiesScene({ activeIdxRef, hobbyIds }: HobbiesSceneProps) {
  const [loaded, setLoaded] = useState<Record<string, THREE.Group | null>>(() => {
    const init: Record<string, THREE.Group | null> = {};
    for (const h of HOBBIES) {
      const entry = PRELOADED[h.id];
      if (entry && entry.loaded) init[h.id] = entry.scene;
    }
    return init;
  });
  // PERF: visibility ref, true when the canvas wrapper is intersecting
  // the viewport. Used by useFrame loops below to short-circuit per-
  // frame work when the section isn't on-screen.
  const visibleRef = useRef<boolean>(false);
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    label: "",
    x: 0,
    y: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef({ x: 0, y: 0 });
  const enterTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);
  const pendingLabelRef = useRef<string>("");
  const isTouch = useMemo(
    () => typeof window !== "undefined" && "ontouchstart" in window,
    [],
  );
  // PERF (mobile): cap the device-pixel-ratio lower on touch / narrow
  // viewports. Phone GPUs pay a heavy fragment-shader cost per extra
  // pixel, and ten simple GLBs over a TRANSPARENT canvas at 38° FOV gain
  // almost nothing visually from 1.5x supersampling on a small screen.
  // Desktop keeps the crisper [1, 1.5] cap; touch/≤768px drops to
  // [1, 1.25] for a meaningful fragment-work saving without a visible
  // softening of these low-detail objects.
  const dprCap = useMemo<[number, number]>(() => {
    const narrow =
      typeof window !== "undefined" && window.innerWidth <= 768;
    return isTouch || narrow ? [1, 1.25] : [1, 1.5];
  }, [isTouch]);

  // Roster sanity check: warn (don't throw) if the parent and the
  // scene's HOBBIES list drift. Helps catch a future "added a hobby
  // in one place but not the other" bug.
  useEffect(() => {
    if (!hobbyIds) return;
    const sceneIds = HOBBIES.map((h) => h.id);
    if (
      sceneIds.length !== hobbyIds.length ||
      sceneIds.some((id, i) => id !== hobbyIds[i])
    ) {
      console.warn(
        "[HobbiesScene] hobby roster mismatch with parent",
        { parent: hobbyIds, scene: sceneIds },
      );
    }
  }, [hobbyIds]);

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

  // IntersectionObserver: sets visibleRef so per-frame loops can
  // short-circuit when the section isn't on screen. rootMargin set
  // generously so the scene is already "live" by the time it's
  // visible (avoids a one-frame blip when transitioning in). The
  // visible-edge transition pokes the demand frame loop alive via
  // canvasInvalidateRef (set in Canvas onCreated below), otherwise
  // the loop would never restart since SceneInner's useFrame is the
  // only invalidator and it early-returns until visibleRef flips.
  const canvasInvalidateRef = useRef<(() => void) | null>(null);
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

  // Tooltip position tracking: write coords to the DOM via ref + rAF
  // so pointermove never triggers a React re-render. Previously every
  // pointer move while the tooltip was visible called setTooltip,
  // reconciling the entire HobbiesScene tree on each event (50+ Hz).
  // Now the tooltip element style is mutated directly.
  const tooltipElRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // PERF: cache the container's client rect, recomputed on
    // window resize / scroll instead of per pointermove.
    let rect = el.getBoundingClientRect();
    const refreshRect = () => {
      rect = el.getBoundingClientRect();
    };
    const onMove = (e: PointerEvent) => {
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      cursorRef.current.x = x;
      cursorRef.current.y = y;
      const tip = tooltipElRef.current;
      if (tip) {
        // Direct DOM write: bypasses React reconciliation entirely.
        tip.style.transform = `translate(${x + 20}px, ${y + 20}px)`;
      }
    };
    // PERF: scroll fires for the whole page lifetime; getBoundingClientRect
    // forces a layout.  OLD: refreshRect ran on every scroll event always.
    // NEW: O(1) guard — skip when section is off-screen (visibleRef=false).
    const refreshRectIfVisible = () => {
      if (visibleRef.current) refreshRect();
    };
    el.addEventListener("pointermove", onMove);
    window.addEventListener("resize", refreshRect, { passive: true });
    window.addEventListener("scroll", refreshRectIfVisible, { passive: true });
    return () => {
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", refreshRect);
      window.removeEventListener("scroll", refreshRectIfVisible);
    };
  }, []);

  const handleHoverChange = (hovering: boolean, label: string) => {
    document.body.style.cursor = hovering ? "pointer" : "";
    if (hovering) {
      pendingLabelRef.current = label;
      if (leaveTimerRef.current != null) {
        window.clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      if (isTouch) {
        setTooltip({
          visible: true,
          label,
          x: cursorRef.current.x,
          y: cursorRef.current.y,
        });
        return;
      }
      if (enterTimerRef.current != null) return;
      enterTimerRef.current = window.setTimeout(() => {
        enterTimerRef.current = null;
        setTooltip({
          visible: true,
          label: pendingLabelRef.current,
          x: cursorRef.current.x,
          y: cursorRef.current.y,
        });
      }, HOVER_ENTER_DELAY_MS);
    } else {
      if (enterTimerRef.current != null) {
        window.clearTimeout(enterTimerRef.current);
        enterTimerRef.current = null;
      }
      // TOUCH TAP-TO-SHOW (no hover dependency): on a touch tap R3F fires
      // pointerover→…→pointerout in quick succession, so a leave timer here
      // would flash the tooltip for ~200ms and auto-hide it. On touch we
      // therefore IGNORE the leave entirely; the tapped label persists
      // until the user taps another object (replaces it) or taps empty
      // space (handleMissed dismisses it). Pointer/mouse keeps the timed
      // leave so a desktop hover-out still fades the tooltip out.
      if (isTouch) return;
      if (leaveTimerRef.current != null) return;
      leaveTimerRef.current = window.setTimeout(() => {
        leaveTimerRef.current = null;
        setTooltip((prev) => ({ ...prev, visible: false }));
      }, HOVER_LEAVE_DELAY_MS);
    }
  };

  // Tap empty canvas to dismiss the tap-shown tooltip (touch only). On
  // pointer devices a hover-out already fades it via the leave timer.
  const handleMissed = () => {
    if (!isTouch) return;
    if (leaveTimerRef.current != null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    setTooltip((prev) => ({ ...prev, visible: false }));
  };

  return (
    <div ref={containerRef} className="hobbies-canvas-wrap">
      <Canvas
        camera={{ position: [0, 0.35, 4.4], fov: 38, near: 0.1, far: 50 }}
        // PERF: cap DPR at 1.5 on desktop (was capped at 2). On a 3x
        // retina display the difference between 1.5 and 2 is a 78%
        // increase in fragment shader work for fairly small visual gain,
        // and 10 simple GLBs at 38° FOV don't benefit much from
        // supersampling past 1.5x. On touch / ≤768px we drop further to
        // 1.25 (see dprCap) for phone-GPU headroom. MSAA still on.
        dpr={dprCap}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          // TUNE/verification only: retain the drawing buffer so the
          // Playwright harness can grab canvas.toDataURL() atomically
          // (the shared browser is heavily contended, so a separate
          // screenshot call races with other agents stealing the tab).
          // Off in production: it has a small perf cost and no user
          // benefit. Gated on the ?tune=other flag.
          preserveDrawingBuffer:
            typeof window !== "undefined" &&
            new URLSearchParams(window.location.search).get("tune") === "other",
        }}
        // PERF: demand frame loop, useFrame inside SceneInner calls
        // invalidate() each visible frame so the loop keeps ticking,
        // but as soon as visibleRef flips false useFrame early-returns
        // and stops scheduling new frames. Saves an entire WebGL
        // submit pipeline while the user is on Hero/About/Mac/Work.
        frameloop="demand"
        onCreated={({ invalidate }) => {
          canvasInvalidateRef.current = invalidate;
        }}
        onPointerMissed={handleMissed}
      >
        <SceneInner
          loaded={loaded}
          activeIdxRef={activeIdxRef}
          visibleRef={visibleRef}
          onHoverChange={handleHoverChange}
        />
      </Canvas>
      {tooltip.visible && (
        <div
          ref={tooltipElRef}
          className="hobbies-tooltip"
          style={{
            transform: `translate(${tooltip.x + 20}px, ${tooltip.y + 20}px)`,
          }}
        >
          {tooltip.label}
        </div>
      )}
    </div>
  );
}
