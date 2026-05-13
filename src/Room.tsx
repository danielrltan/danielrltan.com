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

// Meshes that should be treated as dynamic interactive bodies even though
// their name doesn't carry the `th_` prefix.
const FORCE_DYNAMIC_NAMES = new Set<string>(["dresser"]);

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

const HARDCODED_STATICS: ReadonlyArray<{ name: string } & CuboidSpec> = [
  { name: "bed_frame_static", pos: [-0.978, 0.2, -1.315], half: [0.817, 0.2, 0.985] },
  { name: "mattress_static", pos: [-0.993, 0.55, -1.304], half: [0.794, 0.15, 0.95] },
  // Desk body — full volume of the desk along the +X wall.
  { name: "desk", pos: [2.1863, 0.6238, -1.0111], half: [0.3618, 0.6011, 0.8502] },
  // Desk surface — thin slab at the desk top so objects rest cleanly on top
  // (avoids grazing the cuboid corner edge of the desk body).
  { name: "desk_surface", pos: [2.1863, 1.2249, -1.0111], half: [0.3618, 0.012, 0.8502] },
  { name: "shelf", pos: [-1.332, 1.059, 2.117], half: [0.226, 1.037, 0.274] },
  { name: "mousepad_static", pos: [1.704, 0.742, -1.698], half: [0.25, 0.005, 0.25] },
  { name: "rug_main", pos: [-0.938, 0.035, 0.463], half: [1.144, 0.013, 1.4] },
];

const HARDCODED_NAMES = new Set(HARDCODED_STATICS.map((s) => s.name));

const SKIP_NAMES = new Set<string>([
  "wall_right",
  "floor",
  "jewelery_dish",
  "sun_target",
  "bed_blanket",
  "mushroom_bulb_1",
  "mushroom_bulb_2",
  "mushroom_bulb_3",
  "mushroom_bulb_4",
]);

const EXPLICIT_STATIC_NAMES = new Set<string>([
  "wallpanel",
  "windowsill",
  "curtains",
  "headboard",
  "mic_clamp",
  "clk_pegboard",
  "floor_lamp",
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
  // mushroom_bulb materials get fully replaced by replaceMushroomBulbs() —
  // no emissive boost needed here.
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
  /** [halfWidth, halfHeight, halfDepth] in body-local frame, clamped to MIN_HALF. */
  half: Triple;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** World-AABB of ONLY this mesh's geometry — no descendants. */
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

/** Union of every descendant mesh's own-geometry world AABB. */
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

/**
 * Replace mushroom_bulb_1..4 materials with a glassy transmission material —
 * gives the bulbs a refractive look that catches the nearby mushroom point
 * light. Requires ACES tone mapping (set in App.tsx).
 */
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

      // Explicit static wins over any prefix.
      if (isExplicitStatic(obj.name)) {
        const box = aabbFromSubtree(obj);
        if (!box) return;
        box.getCenter(boxCenter);
        statics.push(buildEntry(obj, boxCenter));
        return;
      }

      // All th_* (including th_drawer_*, th_dresser, th_record_player) become
      // interactive throwables. No special drawer or vinyl handling — they
      // get hull colliders and live in DraggableRigidBody.
      // Drawers go through the dedicated Drawer component (kinematic slide),
      // NOT DraggableRigidBody. Must be checked BEFORE the general th_ branch.
      if (DRAWER_NAMES.has(obj.name)) {
        const box = aabbFromSubtree(obj);
        if (!box) return;
        box.getCenter(boxCenter);
        drawers.push(buildEntry(obj, boxCenter));
        return;
      }

      if (obj.name.startsWith("th_") || FORCE_DYNAMIC_NAMES.has(obj.name)) {
        const box = aabbFromSubtree(obj);
        if (!box) return;
        box.getSize(boxSize);
        // Skip degenerate geometry — feeding tiny AABBs to Rapier produces
        // colliders that teleport out of the scene.
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

      // Unrecognized name. Leaf meshes → static. Groups → recurse so any
      // th_* descendants still get caught.
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

    // Reparent extracted meshes: world transform becomes local inside the
    // body (which sits at the geometry centroid with identity rotation).
    for (const item of [...interactive, ...statics, ...drawers]) {
      item.object.parent?.remove(item.object);
      item.object.position.set(...item.meshLocalPos);
      item.object.quaternion.set(...item.meshLocalQuat);
      item.object.scale.set(...item.meshLocalScale);
      item.object.updateMatrix();
    }

    console.log(
      "[Room] interactive:",
      interactive.map((i) => i.name).sort(),
    );
    console.log("[Room] drawers:", drawers.map((d) => d.name).sort());
    console.log("[Room] statics:", statics.length);

    return { visualScene: cloned, interactive, statics, drawers };
  }, [scene]);

  useEffect(() => {
    applyEmissive(visualScene);
    // Run AFTER applyEmissive so the bulb material replacement wins over any
    // emissive-pattern modification on the original material.
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

      {/* Auto-extracted static meshes — trimesh collider auto-generated from
          the mesh inside, so collision matches the true shape. */}
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

      {/* Dynamic bodies — hull for normal-sized objects, explicit cuboid
          for tiny ones (auto-hull on near-degenerate meshes is unstable). */}
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

      {/* Drawers — kinematic Z-axis slide, never goes through DraggableRigidBody. */}
      {drawers.map((d) => (
        <Drawer key={d.uuid} drawer={d} />
      ))}
    </>
  );
}

useGLTF.preload(ROOM_URL);
