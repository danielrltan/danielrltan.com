import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html, useGLTF } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { DraggableRigidBody } from "./DraggableRigidBody";
import { Drawer, type DrawerData } from "./Drawer";
import { GlowBox } from "./GlowBox";
import { playOneShot } from "./audio";
import {
  useDeskViewActiveRef,
  useSceneReadyRef,
  useStartDeskView,
} from "./SceneState";

// Drawer meshes are handled by Drawer.tsx (kinematic slide). They MUST NOT
// go through DraggableRigidBody — the kinematic translation handler would
// be overwritten by the dynamic body sync.
const DRAWER_NAMES = new Set<string>([
  "th_drawer_1",
  "th_drawer_2",
  "th_drawer_3",
  "th_drawer_4",
  "th_drawer_5",
  "th_drawer_6",
]);

/** `th_*` meshes default to interactive; these are fixed statics instead. */
const TH_STATIC_NAMES = new Set<string>(["th_keyboard_frame"]);

/**
 * Moveables not named `th_*` that must be reparented to the clone root, or
 * `processNode` never sees them (e.g. `clk_mirror_round` under `shelf`).
 */
const EXTRA_THROWABLE_NAMES = new Set<string>(["clk_mirror_round"]);

/**
 * Skip DraggableRigidBody proximity wake-up for these names. They sit against
 * fixed desk geometry (e.g. `th_keyboard_frame`); waking them when another
 * throwable moves nearby turns them dynamic while still overlapping that
 * trimesh → Rapier contact jitter.
 */
const TH_NO_PROXIMITY_WAKE = new Set<string>([
  "th_wristrest",
  // Wall-mounted dome mirror — proximity-wake would let the standing mirror
  // knock it off its bracket just by being dragged past.
  "clk_mirror_round",
]);

const ROOM_URL = "/room.glb";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROOM = {
  cx: 0.076,
  cz: 0.098,
  hw: 2.25,
  hd: 2.25,
  floorY: 0.025,
  ceilY: 2.8,
  wallH: 1.4,
} as const;

type Triple = [number, number, number];
type Quat = [number, number, number, number];

interface CuboidSpec {
  pos: Triple;
  half: Triple;
}

const MIN_HALF = 0.02;
const MIN_VOLUME = 1e-6;

const BOUNDARIES: ReadonlyArray<CuboidSpec> = [
  { pos: [ROOM.cx, ROOM.floorY - 0.1, ROOM.cz], half: [ROOM.hw, 0.1, ROOM.hd] },
  { pos: [ROOM.cx, ROOM.ceilY + 0.1, ROOM.cz], half: [ROOM.hw, 0.1, ROOM.hd] },
  { pos: [ROOM.cx, ROOM.wallH, -2.303], half: [ROOM.hw, ROOM.wallH, 0.15] },
  { pos: [-2.324, ROOM.wallH, ROOM.cz], half: [0.15, ROOM.wallH, ROOM.hd] },
  { pos: [2.476, ROOM.wallH, ROOM.cz], half: [0.15, ROOM.wallH, ROOM.hd] },
  { pos: [ROOM.cx, ROOM.wallH, 2.498], half: [ROOM.hw, ROOM.wallH, 0.15] },
];

const HARDCODED_STATICS: ReadonlyArray<{ name: string } & CuboidSpec> = [
  // Desk surface — thickened from 0.012 → 0.05 half-Y (top still at
  // 1.2369 = 1.1869 + 0.05) so fast tiny props (wristrest, pens, etc.)
  // can't tunnel through the slab between physics steps.
  { name: "desk_surface",     pos: [2.1863, 1.1869, -1.0111],  half: [0.3618, 0.05, 0.8502] },

  // ----- Dresser shell -----
  // Thin (thickness 0.02) outer panels + center divider + horizontal shelves
  // between the three drawer rows. No front face — that side is open so
  // items can be dropped into open drawer cavities. The drawers themselves
  // (th_drawer_1..6) provide the sliding floor/front of each slot via the
  // kinematic Drawer component.
  { name: "d_top",      pos: [-0.1632, 0.8957, 2.0659], half: [0.881, 0.01, 0.286] },
  { name: "d_bottom",   pos: [-0.1632, 0.0173, 2.0659], half: [0.881, 0.01, 0.286] },
  { name: "d_left",     pos: [-1.0442, 0.4565, 2.0659], half: [0.01, 0.439, 0.286] },
  { name: "d_right",    pos: [0.7178, 0.4565, 2.0659],  half: [0.01, 0.439, 0.286] },
  { name: "d_back",     pos: [-0.1632, 0.4565, 2.3518], half: [0.881, 0.439, 0.01] },
  { name: "d_div_v",    pos: [-0.1629, 0.4565, 2.0659], half: [0.01, 0.439, 0.286] },
  { name: "d_shelf_l1", pos: [-0.5768, 0.5732, 2.0659], half: [0.405, 0.01, 0.286] },
  { name: "d_shelf_l2", pos: [-0.5768, 0.3358, 2.0659], half: [0.405, 0.01, 0.286] },
  { name: "d_shelf_r1", pos: [ 0.2509, 0.5732, 2.0659], half: [0.405, 0.01, 0.286] },
  { name: "d_shelf_r2", pos: [ 0.2509, 0.3358, 2.0659], half: [0.405, 0.01, 0.286] },
];

const HARDCODED_NAMES = new Set(HARDCODED_STATICS.map((s) => s.name));

/**
 * Static bodies that can start seated desk view. Only the desk itself
 * (and via the allowlist, only its monitor sub-meshes — see
 * `matchesDeskFocusPickMesh`). The keyboard frame is no longer a
 * trigger — the monitor is the visual focus and the only thing the
 * user is expected to click to sit down.
 */
const DESK_FOCUS_STATIC_NAMES = new Set<string>(["desk"]);

/** Under the `desk` static only: meshes that count as “desk peripherals” for focus. */
const DESK_FOCUS_MESH_PREFIXES: ReadonlyArray<string> = ["monitor_"];
const DESK_FOCUS_MESH_EXACT = new Set<string>([
  "mousepad_static",
  "clk_monitor_frame",
  "screen",
]);

function matchesDeskFocusPickMesh(name: string): boolean {
  if (DESK_FOCUS_MESH_EXACT.has(name)) return true;
  return DESK_FOCUS_MESH_PREFIXES.some((p) => name.startsWith(p));
}

const SKIP_NAMES = new Set<string>([
  "wall_right",
  "floor",
  "jewelery_dish",
  "sun_target",
  "mushroom_bulb_1",
  "mushroom_bulb_2",
  "mushroom_bulb_3",
  "mushroom_bulb_4",
  "dresser",
  "vinyl_disc",
  "mouse",
]);

// Individual key meshes are visual-only — they're reparented to the cloned
// root in useMemo so the keyboard's trimesh collider doesn't include 70+
// tiny per-key shapes, and then skipped by processNode here.
const SKIP_PREFIXES: ReadonlyArray<string> = ["key_"];

const EXPLICIT_STATIC_NAMES = new Set<string>([
  "wallpanel",
  "windowsill",
  "curtains",
  "headboard",
  "mic_clamp",
  "clk_pegboard",
  "floor_lamp",
  "desk",
  "shelf",
  "bed_blanket",
]);

const EXPLICIT_STATIC_PREFIXES: ReadonlyArray<string> = [
  "poster_",
  "keyboard_",
  "monitor_",
  "board_",
];

const EXPLICIT_STATIC_SUFFIXES: ReadonlyArray<string> = ["_static"];

function shouldSkip(name: string): boolean {
  if (SKIP_NAMES.has(name)) return true;
  if (SKIP_PREFIXES.some((p) => name.startsWith(p))) return true;
  return false;
}

function isExplicitStatic(name: string): boolean {
  if (EXPLICIT_STATIC_NAMES.has(name)) return true;
  if (EXPLICIT_STATIC_PREFIXES.some((p) => name.startsWith(p))) return true;
  if (EXPLICIT_STATIC_SUFFIXES.some((s) => name.endsWith(s))) return true;
  return false;
}

const EMISSIVE_PATTERNS: Array<{
  match: string;
  intensity: number;
  color: THREE.Color;
}> = [
  { match: "emit_orange", intensity: 3, color: new THREE.Color().setRGB(1.0, 0.5, 0.15) },
  { match: "emit_light_orange", intensity: 3, color: new THREE.Color().setRGB(1.0, 0.3, 0.06) },
  { match: "lightbar_emission", intensity: 8, color: new THREE.Color().setRGB(1.0, 0.7, 0.4) },
];

// ---------------------------------------------------------------------------
// Keyboard typing animation
// ---------------------------------------------------------------------------

const PRESS_DEPTH = 0.008;
const PRESS_LERP = 0.35;

const KEY_MAP: Record<string, string> = {
  KeyA: "key_a", KeyB: "key_b", KeyC: "key_c",
  KeyD: "key_d", KeyE: "key_e", KeyF: "key_f",
  KeyG: "key_g", KeyH: "key_h", KeyI: "key_i",
  KeyJ: "key_j", KeyK: "key_k", KeyL: "key_l",
  KeyM: "key_m", KeyN: "key_n", KeyO: "key_o",
  KeyP: "key_p", KeyQ: "key_q", KeyR: "key_r",
  KeyS: "key_s", KeyT: "key_t", KeyU: "key_u",
  KeyV: "key_v", KeyW: "key_w", KeyX: "key_x",
  KeyY: "key_y", KeyZ: "key_z",
  Digit0: "key_0", Digit1: "key_1", Digit2: "key_2",
  Digit3: "key_3", Digit4: "key_4", Digit5: "key_5",
  Digit6: "key_6", Digit7: "key_7", Digit8: "key_8",
  Digit9: "key_9",
  Space: "key_space", Enter: "key_enter", Tab: "key_tab",
  Escape: "key_esc", Backspace: "key_bkspc", Delete: "key_del",
  ShiftLeft: "key_shiftl", ShiftRight: "key_shftr",
  ControlLeft: "key_ctrll", ControlRight: "key_ctrlr",
  AltLeft: "key_alt", CapsLock: "key_caplk",
  ArrowUp: "key_arwup", ArrowDown: "key_arwdwn",
  ArrowLeft: "key_arwlft", ArrowRight: "key_arwrt",
  Backquote: "key_tilde", Minus: "key_dash",
  Equal: "key_equals", Semicolon: "key_colon",
  Quote: "key_quote", Slash: "key_slsh",
  Backslash: "key_bkslsh", BracketLeft: "key_sqbrktl",
  BracketRight: "key_sqrbrktr",
  Comma: "key_comma", Period: "key_period",
  PageUp: "key_pgup", PageDown: "key_pgdn", End: "key_end",
  MetaLeft: "key_win",
  F1: "key_f1", F2: "key_f2", F3: "key_f3", F4: "key_f4",
  F5: "key_f5", F6: "key_f6", F7: "key_f7", F8: "key_f8",
  F9: "key_f9", F10: "key_f10", F11: "key_f11", F12: "key_f12",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExtractedBody {
  uuid: string;
  name: string;
  bodyPos: Triple;
  meshLocalPos: Triple;
  meshLocalQuat: Quat;
  meshLocalScale: Triple;
  /** AABB half-extents in body-local space. Used for the GlowBox hover outline. */
  half: Triple;
  object: THREE.Object3D;
}

interface InteractiveBody extends ExtractedBody {
  throwable: boolean;
  /** If false, only pointer interaction calls `activateNow` (no neighbour wake). */
  proximityActivate: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function meshWorldAABB(mesh: THREE.Mesh): THREE.Box3 | null {
  if (!mesh.geometry) return null;
  mesh.updateWorldMatrix(true, false);
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  if (!bb || bb.isEmpty()) return null;
  const box = bb.clone();
  box.applyMatrix4(mesh.matrixWorld);
  return box;
}

function aabbFromSubtree(root: THREE.Object3D): THREE.Box3 | null {
  const result = new THREE.Box3();
  let hasAny = false;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const box = meshWorldAABB(mesh);
    if (!box) return;
    if (!hasAny) {
      result.copy(box);
      hasAny = true;
    } else {
      result.union(box);
    }
  });
  return hasAny ? result : null;
}

function replaceMushroomBulbs(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    if (!obj.name.startsWith("mushroom_bulb")) return;
    const mesh = obj as THREE.Mesh;
    // Was MeshPhysicalMaterial w/ transmission — each transmission material
    // costs a full extra scene render pass. Standard + transparent fakes the
    // same look at a fraction of the cost.
    mesh.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(1.0, 0.85, 0.5),
      transparent: true,
      opacity: 0.35,
      roughness: 0.05,
      metalness: 0.1,
      emissive: new THREE.Color(1.0, 0.6, 0.2),
      emissiveIntensity: 0.4,
    });
  });
}

function replaceClearGlass(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    let changed = false;
    const newMats = mats.map((m) => {
      if (!m || m.name !== "mat_glass_clear") return m;
      changed = true;
      // Same swap as mushroom bulbs — drop the transmission render pass.
      return new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.95, 0.95, 0.95),
        transparent: true,
        opacity: 0.2,
        roughness: 0.05,
        metalness: 0.0,
        side: THREE.DoubleSide,
      });
    });
    if (changed) {
      mesh.material = newMats.length === 1 ? newMats[0]! : (newMats as THREE.Material[]);
    }
  });
}

function applyEmissive(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (!(obj as THREE.Mesh).isMesh) return;
    const mesh = obj as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (!(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) continue;
      const mat = m as THREE.MeshStandardMaterial;
      const lower = mat.name.toLowerCase();
      const boost = EMISSIVE_PATTERNS.find((b) => lower.includes(b.match));
      if (!boost) continue;
      mat.emissive.copy(boost.color);
      mat.emissiveIntensity = boost.intensity;
      mat.needsUpdate = true;
    }
  });
}

const noRaycast: THREE.Object3D["raycast"] = () => {};
function disableRaycasts(root: THREE.Object3D) {
  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) obj.raycast = noRaycast;
  });
}

/** Narrow desk hits to peripherals; other desk wood passes rays (e.g. to orbit). */
function applyDeskFocusMeshRaycasts(root: THREE.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (matchesDeskFocusPickMesh(mesh.name)) {
      mesh.raycast = THREE.Mesh.prototype.raycast.bind(mesh);
    } else {
      mesh.raycast = noRaycast;
    }
  });
}

/**
 * Hover-glow wrapper for the static keyboard. Wraps `object` in a group that
 * tracks hover + click and renders a `GlowBox` sized to the keyboard's AABB
 * (so there are no gaps between keys and frame). Always-on at low intensity
 * once the scene is ready, brighter + pulsing on hover, with a shockwave
 * burst on click. All disabled while seated at the desk.
 */
function KeyboardStaticHoverEdges({
  sceneReadyRef,
  onPointerDown,
  object,
  half,
}: {
  sceneReadyRef: RefObject<boolean> | undefined;
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void;
  object: THREE.Object3D;
  half: Triple;
}) {
  const [hover, setHover] = useState(false);
  const deskViewActiveRef = useDeskViewActiveRef();
  const shockwaveRef = useRef(0);

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!sceneReadyRef?.current) return;
    if (deskViewActiveRef?.current) return;
    if (e.button !== 0) return;
    shockwaveRef.current = 1;
    onPointerDown(e);
  };

  // Hover state + shockwave are kept so the click flow (and the
  // possibility of re-introducing a per-mesh effect later) still works,
  // but the GlowBox has moved to the monitor instead — the keyboard
  // sits flush with the desk and the white outline read as "selected"
  // even when the user wasn't trying to focus it.
  void hover;
  void setHover;
  void shockwaveRef;
  void half;
  return (
    <group
      onPointerDown={handlePointerDown}
      onPointerOver={() => {
        if (!sceneReadyRef?.current) return;
        if (deskViewActiveRef?.current) return;
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
    >
      <primitive object={object} />
    </group>
  );
}

interface MonitorPose {
  center: [number, number, number];
  half: [number, number, number];
}

/**
 * Glow halo around the monitor — telegraphs the monitor as the
 * clickable focus surface. AABB read from `clk_monitor_frame`.
 *
 * Behaviour:
 *   - Always breathing (idle pulse) when not seated.
 *   - Hover brightens it (HOVER_BONUS in GlowBox.tsx).
 *   - Click triggers a shockwave + enters desk view.
 *
 * The glow mesh keeps raycast ON so the group catches pointer events.
 * Calling `startDeskView` directly means we don't rely on the
 * underlying desk-static's monitor-sub-mesh allowlist for this click.
 */
function MonitorGlow({ pose }: { pose: MonitorPose | null }) {
  const [hover, setHover] = useState(false);
  const shockwaveRef = useRef(0);
  const deskActive = useDeskViewActiveRef();
  const sceneReady = useSceneReadyRef();
  const startDeskView = useStartDeskView();

  // Stay mounted across the desk-view transition so GlowBox can lerp
  // base/hover intensities to zero over ~1 s instead of being yanked
  // off-screen in a single frame. Pointer handlers below are gated on
  // `!deskActive?.current` so the (now invisible) glow can't intercept
  // clicks while seated.
  if (!pose) return null;
  return (
    <group
      position={pose.center}
      onPointerOver={(e) => {
        if (!sceneReady?.current) return;
        if (deskActive?.current) return;
        e.stopPropagation();
        setHover(true);
      }}
      onPointerOut={() => setHover(false)}
      onPointerDown={(e) => {
        if (!sceneReady?.current) return;
        if (deskActive?.current) return;
        if (e.button !== 0) return;
        e.stopPropagation();
        shockwaveRef.current = 1;
        startDeskView();
      }}
    >
      {/* ----- MONITOR GLOW TUNING -----------------------------------
          padding         outline thickness from the monitor's AABB
          radius          corner rounding of the glow box
          idlePulseDepth  breath amplitude (0 = no pulse). Pulses
                          INTENSITY now, so the outline visibly fades
                          rather than blinking on/off.
          idlePulseRate   pulse speed (radians/sec, ~2π/rate per cycle).
          Hover bonus + shockwave decay live in GlowBox.tsx
          (HOVER_BONUS, SHOCKWAVE_DECAY).
          ----------------------------------------------------------- */}
      <GlowBox
        half={pose.half}
        hover={hover}
        shockwaveRef={shockwaveRef}
        alwaysOn
        padding={0.04}
        radius={0.025}
        idlePulseDepth={0.4}
        idlePulseRate={2.4}
      />
    </group>
  );
}

/**
 * Thin white chevron that drifts down + fades on a loop, floating just
 * above the monitor. Read as "click here" without needing copy. Drei's
 * `<Html>` anchors it to the monitor's world position, so it tracks the
 * monitor through every orbit / pan / zoom. Hidden once the user is
 * seated at the desk — at that point the cue has served its purpose
 * and any in-frame HUD just clutters the OS view.
 */
function MonitorClickHint({ pose }: { pose: MonitorPose | null }) {
  const deskActive = useDeskViewActiveRef();
  const sceneReady = useSceneReadyRef();
  // Refs don't trigger re-renders, so poll inside useFrame and mirror
  // their combined truth-value into a local state that DOES.
  const [show, setShow] = useState(false);
  useFrame(() => {
    const next = !!(sceneReady?.current && !deskActive?.current);
    if (next !== show) setShow(next);
  });

  if (!pose) return null;

  // Sit just above the monitor frame's top edge.
  const HINT_LIFT = 0.09;
  const hintPos: [number, number, number] = [
    pose.center[0],
    pose.center[1] + pose.half[1] + HINT_LIFT,
    pose.center[2],
  ];

  return (
    <Html
      position={hintPos}
      center
      pointerEvents="none"
      style={{ pointerEvents: "none" }}
      zIndexRange={[10, 0]}
    >
      <div
        style={{
          opacity: show ? 1 : 0,
          transition: "opacity 0.35s ease",
          pointerEvents: "none",
        }}
      >
        <div className="monitor-click-hint">
          <svg
            width="50"
            height="16"
            viewBox="0 0 50 16"
            fill="none"
            stroke="white"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <polyline points="3 4 25 13 47 4" />
          </svg>
        </div>
      </div>
    </Html>
  );
}

interface RoomProps {
  roomGroupRef: RefObject<THREE.Group | null>;
}

export function Room({ roomGroupRef }: RoomProps) {
  const { scene } = useGLTF(ROOM_URL);
  const sceneReadyRef = useSceneReadyRef();
  const startDeskView = useStartDeskView();

  const onDeskAreaPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!sceneReadyRef?.current) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      startDeskView();
    },
    [sceneReadyRef, startDeskView],
  );

  const mouseMeshRef = useRef<THREE.Object3D | null>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  // Independent viewport-pointer tracker. R3F's `state.pointer` stops
  // updating once drei's `<Html>` (the OS) intercepts events, which
  // would freeze the desk mouse-mesh at whatever stale value pointer
  // had when it left the canvas. A window-level listener keeps it
  // current no matter what overlay is on top.
  const viewportPointerRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      viewportPointerRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      viewportPointerRef.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  const {
    visualScene,
    interactive,
    statics,
    drawers,
    keyMeshes,
    keyRestY,
    monitorPoseExtracted,
  } = useMemo(() => {
      const cloned = scene.clone(true);
      cloned.updateMatrixWorld(true);

      // Snapshot monitor world AABB before processNode reparents
      // anything. Once statics are extracted from the cloned tree this
      // lookup would return null — and even if it didn't, the bodyPos
      // offset would no longer match the unmodified world transform.
      let monitorPoseExtracted: MonitorPose | null = null;
      {
        const m = cloned.getObjectByName("clk_monitor_frame");
        if (m) {
          const box = new THREE.Box3().setFromObject(m);
          if (isFinite(box.min.x)) {
            const c = box.getCenter(new THREE.Vector3());
            const s = box.getSize(new THREE.Vector3());
            monitorPoseExtracted = {
              center: [c.x, c.y, c.z],
              half: [s.x / 2, s.y / 2, s.z / 2],
            };
          }
        }
      }

      // Pull every key_* mesh up to the cloned root using .attach() (which
      // preserves world transform). This guarantees the keys are NOT
      // descendants of keyboard_frame, so keyboard_frame's trimesh collider
      // doesn't pick them up (avoiding the 70-collider lag spike). They're
      // also matched by SKIP_PREFIXES below, so processNode ignores them
      // and they end up as purely visual top-level meshes.
      const keyMeshes = new Map<string, THREE.Object3D>();
      const keyRestY = new Map<string, number>();
      const keys: THREE.Object3D[] = [];
      cloned.traverse((obj) => {
        if (obj.name.startsWith("key_")) keys.push(obj);
      });
      for (const k of keys) {
        if (k.parent !== cloned) cloned.attach(k);
      }
      for (const k of keys) {
        keyMeshes.set(k.name, k);
        keyRestY.set(k.name, k.position.y);
      }

      for (const name of EXTRA_THROWABLE_NAMES) {
        const o = cloned.getObjectByName(name);
        if (o && o.parent !== cloned) cloned.attach(o);
      }

      const interactive: InteractiveBody[] = [];
      const statics: ExtractedBody[] = [];
      const drawers: DrawerData[] = [];

      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      const worldScale = new THREE.Vector3();
      const boxCenter = new THREE.Vector3();
      const boxSize = new THREE.Vector3();

      const buildEntry = (
        obj: THREE.Object3D,
        box: THREE.Box3,
      ): ExtractedBody => {
        box.getCenter(boxCenter);
        box.getSize(boxSize);
        obj.matrixWorld.decompose(worldPos, worldQuat, worldScale);
        return {
          uuid: obj.uuid,
          name: obj.name,
          bodyPos: [boxCenter.x, boxCenter.y, boxCenter.z],
          meshLocalPos: [
            worldPos.x - boxCenter.x,
            worldPos.y - boxCenter.y,
            worldPos.z - boxCenter.z,
          ],
          meshLocalQuat: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w],
          meshLocalScale: [worldScale.x, worldScale.y, worldScale.z],
          half: [boxSize.x / 2, boxSize.y / 2, boxSize.z / 2],
          object: obj,
        };
      };

      const processNode = (obj: THREE.Object3D) => {
        if (shouldSkip(obj.name)) return;
        if (HARDCODED_NAMES.has(obj.name)) return;

        if (isExplicitStatic(obj.name)) {
          const box = aabbFromSubtree(obj);
          if (!box) return;
          statics.push(buildEntry(obj, box));
          return;
        }

        if (DRAWER_NAMES.has(obj.name)) {
          const box = aabbFromSubtree(obj);
          if (!box) return;
          drawers.push(buildEntry(obj, box));
          return;
        }

        if (TH_STATIC_NAMES.has(obj.name)) {
          const box = aabbFromSubtree(obj);
          if (!box) return;
          statics.push(buildEntry(obj, box));
          return;
        }

        if (obj.name.startsWith("th_") || EXTRA_THROWABLE_NAMES.has(obj.name)) {
          const box = aabbFromSubtree(obj);
          if (!box) return;
          box.getSize(boxSize);
          const volume = boxSize.x * boxSize.y * boxSize.z;
          if (volume < MIN_VOLUME) return;
          const base = buildEntry(obj, box);
          interactive.push({
            ...base,
            // Clamp to MIN_HALF so Rapier never gets a degenerate collider.
            half: [
              Math.max(base.half[0], MIN_HALF),
              Math.max(base.half[1], MIN_HALF),
              Math.max(base.half[2], MIN_HALF),
            ],
            throwable: true,
            proximityActivate: !TH_NO_PROXIMITY_WAKE.has(obj.name),
          });
          return;
        }

        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          const box = meshWorldAABB(mesh);
          if (!box) return;
          statics.push(buildEntry(obj, box));
          return;
        }

        for (const child of obj.children) processNode(child);
      };

      for (const child of cloned.children) processNode(child);

      for (const item of [...interactive, ...statics, ...drawers]) {
        item.object.parent?.remove(item.object);
        item.object.position.set(...item.meshLocalPos);
        item.object.quaternion.set(...item.meshLocalQuat);
        item.object.scale.set(...item.meshLocalScale);
        item.object.updateMatrix();
      }

      return {
        visualScene: cloned,
        interactive,
        statics,
        drawers,
        keyMeshes,
        keyRestY,
        monitorPoseExtracted,
      };
    }, [scene]);

  useEffect(() => {
    applyEmissive(visualScene);
    replaceMushroomBulbs(visualScene);
    replaceClearGlass(visualScene);
    disableRaycasts(visualScene);
    for (const it of interactive) {
      applyEmissive(it.object);
      replaceClearGlass(it.object);
    }
    for (const d of drawers) applyEmissive(d.object);
    for (const s of statics) {
      applyEmissive(s.object);
      if (s.name === "desk") {
        applyDeskFocusMeshRaycasts(s.object);
      } else if (!DESK_FOCUS_STATIC_NAMES.has(s.name)) {
        disableRaycasts(s.object);
      }
    }
  }, [visualScene, interactive, statics, drawers]);

  useEffect(() => {
    const m = visualScene.getObjectByName("mouse");
    if (m) {
      mouseMeshRef.current = m;
      m.userData.restX = m.position.x;
      m.userData.restZ = m.position.z;
      m.userData.restY = m.position.y;
    }

  }, [visualScene]);

  // Window-level keyboard listeners — only register press state after the
  // iso transition completes. preventDefault is scoped to keys that have a
  // matching mesh so OrbitControls and dev shortcuts still work.
  useEffect(() => {
    // The keydown.mp3 / keyup.mp3 assets are inverted from their filenames
    // (keydown.mp3 contains the release click, keyup.mp3 contains the press
    // click), so we swap them here. Spacebar gets a deeper pitch on both.
    const SPACE_RATE = 0.82;
    // The modifier keys themselves set e.ctrlKey / e.metaKey true on their
    // OWN press event — so a blind `e.ctrlKey || e.metaKey` filter would
    // reject pressing left-ctrl / left-meta / etc. Allow modifier-code
    // events through; only reject when a *different* key is being chorded.
    const MODIFIER_CODES = new Set<string>([
      "ControlLeft",
      "ControlRight",
      "MetaLeft",
      "MetaRight",
      "AltLeft",
      "AltRight",
    ]);
    const isCombo = (e: KeyboardEvent) =>
      (e.ctrlKey || e.metaKey) && !MODIFIER_CODES.has(e.code);
    // Skip the room keyboard animation when the user is typing into
    // an OS input — otherwise preventDefault() below swallows the
    // keystroke and the input never gets the character.
    const isTypingTarget = (e: KeyboardEvent): boolean => {
      const el = e.target;
      return (
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.closest("input, textarea, select, [contenteditable='true']") !==
            null)
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!sceneReadyRef?.current) return;
      if (isCombo(e)) return;
      if (isTypingTarget(e)) return;
      if (e.code === "KeyR" && e.defaultPrevented) return;
      const meshName = KEY_MAP[e.code];
      if (!meshName) return;
      e.preventDefault();
      if (!pressedKeysRef.current.has(meshName)) {
        const isSpace = meshName === "key_space";
        const rate = isSpace ? SPACE_RATE : 1;
        const vol = isSpace ? Math.min(1, 0.45 * 2) : 0.45;
        playOneShot("keyup", vol, rate);
      }
      pressedKeysRef.current.add(meshName);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!sceneReadyRef?.current) return;
      if (isCombo(e)) return;
      if (isTypingTarget(e)) return;
      if (e.code === "KeyR" && e.defaultPrevented) return;
      const meshName = KEY_MAP[e.code];
      if (!meshName) return;
      e.preventDefault();
      pressedKeysRef.current.delete(meshName);
      const isSpace = meshName === "key_space";
      const rate = isSpace ? SPACE_RATE : 1;
      const vol = isSpace ? Math.min(1, 0.4 * 2) : 0.4;
      playOneShot("keydown", vol, rate);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [sceneReadyRef]);

  // Drive mouse mesh + key press animations every frame. Both gated on
  // sceneReady so nothing moves during the intro idle/transition.
  useFrame(() => {
    if (!sceneReadyRef?.current) return;

    const mouse = mouseMeshRef.current;
    if (mouse) {
      const rest = mouse.userData;
      const range = 0.18;

      // Read from the window-level pointer ref, not state.pointer, so
      // the mesh keeps tracking even when the OS portal is on top.
      const p = viewportPointerRef.current;
      const targetX = rest.restX + p.x * range;
      const targetZ = rest.restZ - p.y * range;

      mouse.position.x = THREE.MathUtils.lerp(
        mouse.position.x,
        targetX,
        0.12,
      );
      mouse.position.z = THREE.MathUtils.lerp(
        mouse.position.z,
        targetZ,
        0.12,
      );
    }

    // Key meshes — lerp toward rest or rest - PRESS_DEPTH. Since keys live
    // at the cloned root, position.y is in world space and "down" is fixed.
    for (const [name, mesh] of keyMeshes) {
      const restY = keyRestY.get(name);
      if (restY === undefined) continue;
      const targetY = pressedKeysRef.current.has(name)
        ? restY - PRESS_DEPTH
        : restY;
      mesh.position.y = THREE.MathUtils.lerp(
        mesh.position.y,
        targetY,
        PRESS_LERP,
      );
    }
  });

  return (
    <group ref={roomGroupRef}>
      <primitive object={visualScene} />

      {BOUNDARIES.map((b, i) => (
        <RigidBody
          key={`boundary-${i}`}
          type="fixed"
          position={b.pos}
          colliders={false}
        >
          <CuboidCollider args={b.half} />
        </RigidBody>
      ))}

      {HARDCODED_STATICS.map((s) => (
        <RigidBody
          key={`hardcoded-${s.name}`}
          type="fixed"
          position={s.pos}
          colliders={false}
        >
          <CuboidCollider args={s.half} />
        </RigidBody>
      ))}

      {statics.map((s) => (
        <RigidBody
          key={`static-${s.uuid}`}
          name={s.name}
          type="fixed"
          position={s.bodyPos}
          colliders="trimesh"
        >
          {DESK_FOCUS_STATIC_NAMES.has(s.name) ? (
            s.name === "desk" ? (
              <primitive
                object={s.object}
                onPointerDown={onDeskAreaPointerDown}
              />
            ) : (
              <KeyboardStaticHoverEdges
                sceneReadyRef={sceneReadyRef}
                onPointerDown={onDeskAreaPointerDown}
                object={s.object}
                half={s.half}
              />
            )
          ) : (
            <primitive object={s.object} />
          )}
        </RigidBody>
      ))}

      {interactive.map((t) => (
        <DraggableRigidBody
          key={t.uuid}
          name={t.name}
          position={t.bodyPos}
          half={t.half}
          throwable={t.throwable}
          proximityActivate={t.proximityActivate}
        >
          <primitive object={t.object} />
        </DraggableRigidBody>
      ))}

      {drawers.map((d) => (
        <Drawer key={d.uuid} drawer={d} />
      ))}

      <MonitorGlow pose={monitorPoseExtracted} />
      <MonitorClickHint pose={monitorPoseExtracted} />
    </group>
  );
}

useGLTF.preload(ROOM_URL);
