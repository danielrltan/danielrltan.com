// scripts/bake-wireframes.mjs
//
// Reads public/room.glb directly (NOT the Blender scene manifest —
// that file stores Blender pivot positions, which aren't always the
// AABB centers of the resulting meshes, so wireframes computed from it
// drift by up to half a mesh's dimension). Walks the glTF node tree,
// composes world transforms, and unions each mesh primitive's POSITION
// accessor bounding-box (which the glTF schema bundles for free as
// accessor.min / accessor.max) into a world-space AABB.
//
// Output: public/wireframes.json with per-mesh {name, center, half,
// phase}. Already in three.js Y-up coordinates (the GLB was exported
// that way), so no axis conversion is needed.
//
// Runs at `predev` and `prebuild`. The committed JSON file is the
// source of truth at runtime — no GLB parsing happens in the browser.
//
// Implementation note: uses three.js's Matrix4 / Vector3 / Quaternion /
// Box3 as math primitives. Those modules don't touch the DOM and work
// in pure Node ESM, so this stays a zero-new-dependency script.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Box3, Matrix4, Quaternion, Vector3 } from "three";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const SRC = resolve(REPO_ROOT, "public/room.glb");
const DST = resolve(REPO_ROOT, "public/wireframes.json");

// ----- Phase classification -------------------------------------------------

const PHASE_RULES = [
  {
    phase: 1,
    test: (n) =>
      n === "floor" ||
      n === "wallpanel" ||
      n.startsWith("wall_") ||
      n === "windowsill" ||
      n === "curtains" ||
      n === "rug_main",
  },
  {
    phase: 2,
    test: (n) =>
      n === "desk" ||
      n === "shelf" ||
      n === "dresser" ||
      n === "headboard" ||
      n === "bed_blanket" ||
      n === "mattress_static" ||
      n === "bed_frame_static" ||
      n.startsWith("bed_") ||
      n.startsWith("desk_") ||
      n.startsWith("dresser_") ||
      n === "floor_lamp" ||
      n === "dr_floor_lamp" ||
      n === "dr_nightstand" ||
      n === "dr_shelf" ||
      n === "dr_chair" ||
      n === "chair",
  },
  {
    phase: 3,
    test: (n) =>
      n.startsWith("monitor_") ||
      n.startsWith("keyboard_") ||
      n.startsWith("pc_") ||
      n.startsWith("clk_monitor") ||
      n === "dr_computer" ||
      n === "screen" ||
      n === "mousepad_static",
  },
  {
    phase: 4,
    test: (n) =>
      n.startsWith("clk_") ||
      n.startsWith("dr_") ||
      n.startsWith("board_"),
  },
  { phase: 5, test: () => true },
];

function phaseFor(name) {
  for (const r of PHASE_RULES) if (r.test(name)) return r.phase;
  return 5;
}

// Skip lists. Drawer slabs are nested inside the dresser visually and
// individually they read as a cluttered stack of tiny rectangles; the
// dresser wireframe already represents them. Bulbs are tiny dots
// that read as noise. Individual keyboard keys are part of the
// keyboard frame already.
const SKIP_EXACT = new Set([
  "sun_target",
  "mushroom_bulb_1",
  "mushroom_bulb_2",
  "mushroom_bulb_3",
  "mushroom_bulb_4",
  "th_books_shelf.001",
  "th_books_shelf.002",
  "th_books_shelf.003",
  "th_succ_1",
  "th_succ_2",
  "th_succ_3",
]);
const SKIP_PREFIXES = ["key_", "light_", "dr_drawer_"];

function shouldSkip(name) {
  if (!name) return true;
  if (SKIP_EXACT.has(name)) return true;
  return SKIP_PREFIXES.some((p) => name.startsWith(p));
}

// ----- GLB reader (header + JSON chunk only — we don't need the binary) -----

const GLTF_MAGIC = 0x46546c67; // "glTF"
const JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON"

function readGLBJson(path) {
  const buf = readFileSync(path);
  if (buf.length < 20) throw new Error(`GLB too short: ${path}`);
  if (buf.readUInt32LE(0) !== GLTF_MAGIC) {
    throw new Error(`Not a GLB file (bad magic): ${path}`);
  }
  const jsonLength = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== JSON_CHUNK_TYPE) {
    throw new Error("First chunk is not a JSON chunk");
  }
  return JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8"));
}

// ----- Node walk + AABB union -----------------------------------------------

function nodeLocalMatrix(node) {
  const m = new Matrix4();
  if (node.matrix) {
    m.fromArray(node.matrix);
    return m;
  }
  const t = new Vector3().fromArray(node.translation ?? [0, 0, 0]);
  const r = new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]);
  const s = new Vector3().fromArray(node.scale ?? [1, 1, 1]);
  return m.compose(t, r, s);
}

/**
 * Returns the world-space AABB of `node` and all its descendants.
 * Uses each mesh primitive's POSITION accessor.min/max as the local
 * AABB and applies the accumulated world transform via Box3.applyMatrix4
 * (which correctly handles rotated/scaled boxes by transforming the 8
 * corners and refitting to an axis-aligned box).
 */
function nodeWorldAABB(node, parentMat, gltf) {
  const local = nodeLocalMatrix(node);
  const world = new Matrix4().multiplyMatrices(parentMat, local);
  const result = new Box3();
  result.makeEmpty();

  if (node.mesh !== undefined) {
    const mesh = gltf.meshes?.[node.mesh];
    if (mesh && Array.isArray(mesh.primitives)) {
      for (const prim of mesh.primitives) {
        const posIdx = prim?.attributes?.POSITION;
        if (posIdx === undefined) continue;
        const acc = gltf.accessors?.[posIdx];
        if (!acc?.min || !acc?.max) continue;
        const localBox = new Box3(
          new Vector3().fromArray(acc.min),
          new Vector3().fromArray(acc.max),
        );
        localBox.applyMatrix4(world);
        result.union(localBox);
      }
    }
  }

  if (Array.isArray(node.children)) {
    for (const childIdx of node.children) {
      const child = gltf.nodes?.[childIdx];
      if (!child) continue;
      const childBox = nodeWorldAABB(child, world, gltf);
      if (!childBox.isEmpty()) result.union(childBox);
    }
  }

  return result;
}

// ----- Main ----------------------------------------------------------------

function round(v) {
  return Number(v.toFixed(4));
}

function main() {
  const gltf = readGLBJson(SRC);
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  if (!scene || !Array.isArray(scene.nodes)) {
    throw new Error("GLB has no default scene with nodes");
  }

  const identity = new Matrix4();
  const meshes = [];

  // Only top-level named nodes contribute a wireframe entry. Children
  // are folded into their parent's AABB (so e.g. the desk's legs are
  // part of the "desk" wireframe rather than each leg getting its own).
  // This keeps the wave choreography reading at the right granularity.
  for (const rootIdx of scene.nodes) {
    const node = gltf.nodes?.[rootIdx];
    if (!node || shouldSkip(node.name)) continue;
    const aabb = nodeWorldAABB(node, identity, gltf);
    if (aabb.isEmpty()) continue;
    const center = new Vector3();
    const size = new Vector3();
    aabb.getCenter(center);
    aabb.getSize(size);
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) continue;
    meshes.push({
      name: node.name,
      center: [round(center.x), round(center.y), round(center.z)],
      half: [round(size.x / 2), round(size.y / 2), round(size.z / 2)],
      phase: phaseFor(node.name),
    });
  }

  meshes.sort((a, b) => a.phase - b.phase || a.name.localeCompare(b.name));

  const out = {
    version: 2,
    generatedAt: new Date().toISOString(),
    source: "public/room.glb",
    meshes,
  };

  mkdirSync(dirname(DST), { recursive: true });
  writeFileSync(DST, JSON.stringify(out, null, 2) + "\n");

  const byPhase = meshes.reduce((acc, m) => {
    acc[m.phase] = (acc[m.phase] || 0) + 1;
    return acc;
  }, {});
  console.log(`Wrote ${meshes.length} meshes to ${DST}`);
  console.log("  by phase:", byPhase);
}

main();
