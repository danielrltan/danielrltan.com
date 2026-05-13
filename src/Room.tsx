import { useEffect, useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { DraggableRigidBody } from "./DraggableRigidBody";
import { Drawer, type DrawerData } from "./Drawer";

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

// Minimum half-extent — clamp anything we derive from a Box3 to this so we
// never feed Rapier a degenerate collider. The dangle/raycast math also
// divides by halfHeight, so floor it generously.
const MIN_HALF = 0.02;

// Bodies whose AABB volume falls below this are skipped entirely (degenerate
// geometry that would teleport out of the scene if turned into a body).
const MIN_VOLUME = 1e-6;

const BOUNDARIES: ReadonlyArray<CuboidSpec> = [
  { pos: [ROOM.cx, ROOM.floorY - 0.1, ROOM.cz], half: [ROOM.hw, 0.1, ROOM.hd] },
  { pos: [ROOM.cx, ROOM.ceilY + 0.1, ROOM.cz], half: [ROOM.hw, 0.1, ROOM.hd] },
  { pos: [ROOM.cx, ROOM.wallH, -2.303], half: [ROOM.hw, ROOM.wallH, 0.15] },
  { pos: [-2.324, ROOM.wallH, ROOM.cz], half: [0.15, ROOM.wallH, ROOM.hd] },
  { pos: [2.476, ROOM.wallH, ROOM.cz], half: [0.15, ROOM.wallH, ROOM.hd] },
  { pos: [ROOM.cx, ROOM.wallH, 2.498], half: [ROOM.hw, ROOM.wallH, 0.15] },
];

// ONLY artificial colliders that have no corresponding mesh in the GLB —
// thin slabs and the dresser shell. Real-mesh statics (bed/mattress/desk/
// shelf/mousepad/rug) get trimesh colliders via EXPLICIT_STATIC_NAMES or the
// `_static` suffix rule below.
const HARDCODED_STATICS: ReadonlyArray<{ name: string } & CuboidSpec> = [
  // Desk surface — thin slab so objects rest cleanly on top of the desk mesh.
  { name: "desk_surface",     pos: [2.1863, 1.2249, -1.0111],  half: [0.3618, 0.012, 0.8502] },

  // Dresser shell — 6 panels forming the box the drawers slide into.
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
  "dresser",       // visual only — shell colliders are hardcoded above
  "vinyl_disc",    // visual only — follows record player in render loop
]);

const EXPLICIT_STATIC_NAMES = new Set<string>([
  "wallpanel",
  "windowsill",
  "curtains",
  "headboard",
  "mic_clamp",
  "clk_pegboard",
  "floor_lamp",
  // Real-mesh statics — the collision shape is the mesh geometry itself
  // (trimesh), no position/extent estimation needed.
  "desk",
  "shelf",
  "bed_blanket",
]);

const EXPLICIT_STATIC_PREFIXES: ReadonlyArray<string> = [
  "poster_",
  "keyboard_",
  "key_",
  "monitor_",
  "board_",
];

const EXPLICIT_STATIC_SUFFIXES: ReadonlyArray<string> = ["_static"];

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

export function Room() {
  const { scene } = useGLTF(ROOM_URL);

  const { visualScene, interactive, statics, drawers } = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.updateMatrixWorld(true);

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
      if (SKIP_NAMES.has(obj.name)) return;
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

    return { visualScene: cloned, interactive, statics, drawers };
  }, [scene]);

  useEffect(() => {
    applyEmissive(visualScene);
    replaceMushroomBulbs(visualScene);
    disableRaycasts(visualScene);
    for (const it of interactive) applyEmissive(it.object);
    for (const d of drawers) applyEmissive(d.object);
    for (const s of statics) {
      applyEmissive(s.object);
      disableRaycasts(s.object);
    }
  }, [visualScene, interactive, statics, drawers]);

  return (
    <>
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
        >
          <primitive object={t.object} />
        </DraggableRigidBody>
      ))}

      {drawers.map((d) => (
        <Drawer key={d.uuid} drawer={d} />
      ))}
    </>
  );
}

useGLTF.preload(ROOM_URL);