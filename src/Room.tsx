import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { DraggableRigidBody } from "./DraggableRigidBody";
import { Drawer, type DrawerData } from "./Drawer";
import { useSceneReadyRef } from "./SceneState";

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
 * Skip DraggableRigidBody proximity wake-up for these names. They sit against
 * fixed desk geometry (e.g. `th_keyboard_frame`); waking them when another
 * throwable moves nearby turns them dynamic while still overlapping that
 * trimesh → Rapier contact jitter.
 */
const TH_NO_PROXIMITY_WAKE = new Set<string>(["th_wristrest"]);

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
  { name: "desk_surface",     pos: [2.1863, 1.2249, -1.0111],  half: [0.3618, 0.012, 0.8502] },
  { name: "dresser_top",      pos: [-0.1663, 0.8957, 2.1175],  half: [0.8810, 0.0250, 0.2860] },
  { name: "dresser_bottom",   pos: [-0.1663, 0.0173, 2.1175],  half: [0.8810, 0.0250, 0.2860] },
  { name: "dresser_left",     pos: [-1.0473, 0.4565, 2.1175],  half: [0.0250, 0.4392, 0.2860] },
  { name: "dresser_right",    pos: [0.7147, 0.4565, 2.1175],   half: [0.0250, 0.4392, 0.2860] },
  { name: "dresser_back",     pos: [-0.1663, 0.4565, 2.4034],  half: [0.8810, 0.4392, 0.0250] },
  { name: "dresser_divider",  pos: [-0.5788, 0.4565, 2.1175],  half: [0.0250, 0.4392, 0.2860] },
];

const HARDCODED_NAMES = new Set(HARDCODED_STATICS.map((s) => s.name));

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
  object: THREE.Object3D;
}

interface InteractiveBody extends ExtractedBody {
  throwable: boolean;
  half: Triple;
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
    mesh.material = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(1.0, 0.85, 0.5),
      transmission: 0.92,
      thickness: 0.08,
      roughness: 0.0,
      metalness: 0.0,
      ior: 1.5,
      transparent: true,
      opacity: 0.85,
      emissive: new THREE.Color(1.0, 0.6, 0.2),
      emissiveIntensity: 0.4,
      envMapIntensity: 1.2,
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
      return new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0.95, 0.95, 0.95),
        transmission: 0.95,
        thickness: 0.05,
        roughness: 0.05,
        metalness: 0.0,
        ior: 1.45,
        transparent: true,
        opacity: 0.3,
        envMapIntensity: 1.5,
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
    mesh.castShadow = true;
    mesh.receiveShadow = true;
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

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

interface RoomProps {
  roomGroupRef: RefObject<THREE.Group | null>;
}

export function Room({ roomGroupRef }: RoomProps) {
  const { scene } = useGLTF(ROOM_URL);
  const sceneReadyRef = useSceneReadyRef();

  const mouseMeshRef = useRef<THREE.Object3D | null>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());

  const { visualScene, interactive, statics, drawers, keyMeshes, keyRestY } =
    useMemo(() => {
      const cloned = scene.clone(true);
      cloned.updateMatrixWorld(true);

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
        center: THREE.Vector3,
      ): ExtractedBody => {
        obj.matrixWorld.decompose(worldPos, worldQuat, worldScale);
        return {
          uuid: obj.uuid,
          name: obj.name,
          bodyPos: [center.x, center.y, center.z],
          meshLocalPos: [
            worldPos.x - center.x,
            worldPos.y - center.y,
            worldPos.z - center.z,
          ],
          meshLocalQuat: [worldQuat.x, worldQuat.y, worldQuat.z, worldQuat.w],
          meshLocalScale: [worldScale.x, worldScale.y, worldScale.z],
          object: obj,
        };
      };

      const processNode = (obj: THREE.Object3D) => {
        if (shouldSkip(obj.name)) return;
        if (HARDCODED_NAMES.has(obj.name)) return;

        if (isExplicitStatic(obj.name)) {
          const box = aabbFromSubtree(obj);
          if (!box) return;
          box.getCenter(boxCenter);
          statics.push(buildEntry(obj, boxCenter));
          return;
        }

        if (DRAWER_NAMES.has(obj.name)) {
          const box = aabbFromSubtree(obj);
          if (!box) return;
          box.getCenter(boxCenter);
          drawers.push(buildEntry(obj, boxCenter));
          return;
        }

        if (TH_STATIC_NAMES.has(obj.name)) {
          const box = aabbFromSubtree(obj);
          if (!box) return;
          box.getCenter(boxCenter);
          statics.push(buildEntry(obj, boxCenter));
          return;
        }

        if (obj.name.startsWith("th_")) {
          const box = aabbFromSubtree(obj);
          if (!box) return;
          box.getSize(boxSize);
          const volume = boxSize.x * boxSize.y * boxSize.z;
          if (volume < MIN_VOLUME) return;
          box.getCenter(boxCenter);
          interactive.push({
            ...buildEntry(obj, boxCenter),
            throwable: true,
            half: [
              Math.max(boxSize.x / 2, MIN_HALF),
              Math.max(boxSize.y / 2, MIN_HALF),
              Math.max(boxSize.z / 2, MIN_HALF),
            ],
            proximityActivate: !TH_NO_PROXIMITY_WAKE.has(obj.name),
          });
          return;
        }

        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.geometry) {
          const box = meshWorldAABB(mesh);
          if (!box) return;
          box.getCenter(boxCenter);
          statics.push(buildEntry(obj, boxCenter));
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

      console.log("[Room] interactive:", interactive.map((i) => i.name).sort());
      console.log("[Room] drawers:", drawers.map((d) => d.name).sort());
      console.log("[Room] statics:", statics.length);
      console.log("[Room] keys tracked:", keyMeshes.size);

      return {
        visualScene: cloned,
        interactive,
        statics,
        drawers,
        keyMeshes,
        keyRestY,
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
      disableRaycasts(s.object);
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (!sceneReadyRef?.current) return;
      const meshName = KEY_MAP[e.code];
      if (!meshName) return;
      e.preventDefault();
      pressedKeysRef.current.add(meshName);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!sceneReadyRef?.current) return;
      const meshName = KEY_MAP[e.code];
      if (!meshName) return;
      e.preventDefault();
      pressedKeysRef.current.delete(meshName);
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
  useFrame((state) => {
    if (!sceneReadyRef?.current) return;

    const mouse = mouseMeshRef.current;
    if (mouse) {
      const rest = mouse.userData;
      const range = 0.18;

      const targetX = rest.restX + state.pointer.x * range;
      const targetZ = rest.restZ - state.pointer.y * range;

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
          <primitive object={s.object} />
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
    </group>
  );
}

useGLTF.preload(ROOM_URL);
