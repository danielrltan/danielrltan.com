// scripts/bake-wireframes.mjs
//
// Reads the Blender scene manifest, converts each entry into a
// three.js-coordinates wireframe descriptor, classifies it into one of
// 5 spatial assembly phases by name, and writes public/wireframes.json.
//
// Runs at `predev` and `prebuild`. Output is committed to git so dev
// servers don't need to re-bake on every clone.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const SRC = resolve(REPO_ROOT, "data/scene_manifest.json");
const DST = resolve(REPO_ROOT, "public/wireframes.json");

// Phase 1: floor + walls + room shell
// Phase 2: large furniture (bed, desk, shelf, dresser, lamp poles)
// Phase 3: electronics + on-desk hardware (monitor, keyboard, PC)
// Phase 4: interactive / mid-size props (clk_*, dr_*, th_*)
// Phase 5: decor + detail (posters, vinyl, mushroom bulbs, plushies)
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
      n.startsWith("bed_") ||
      n.startsWith("desk_") ||
      n.startsWith("dresser_") ||
      n === "floor_lamp" ||
      n === "chair",
  },
  {
    phase: 3,
    test: (n) =>
      n.startsWith("monitor_") ||
      n.startsWith("keyboard_") ||
      n.startsWith("pc_") ||
      n.startsWith("clk_monitor") ||
      n === "screen" ||
      n === "mousepad_static",
  },
  {
    phase: 4,
    test: (n) =>
      n.startsWith("clk_") ||
      n.startsWith("dr_") ||
      n.startsWith("th_") ||
      n.startsWith("board_"),
  },
  { phase: 5, test: () => true }, // catch-all (posters, vinyl, decor)
];

function phaseFor(name) {
  for (const r of PHASE_RULES) if (r.test(name)) return r.phase;
  return 5;
}

// Blender (Z-up, right-handed) → three.js (Y-up, right-handed):
//   blender (x, y, z) → three (x, z, -y)
// Sizes (dimensions) are positive in all axes; they swap the same way:
//   blender (dx, dy, dz) → three (dx, dz, dy)
function blenderPosToThree([x, y, z]) {
  return [x, z, -y];
}
function blenderSizeToThree([dx, dy, dz]) {
  return [dx, dz, dy];
}

// Names we never want as wireframes. These are NOT in the loaded scene
// from Blender's perspective (key_*), or are scaffolding-only objects
// (sun_target), or render as a single tiny box that adds clutter.
const SKIP_EXACT = new Set([
  "sun_target",
  "mushroom_bulb_1",
  "mushroom_bulb_2",
  "mushroom_bulb_3",
  "mushroom_bulb_4",
]);
const SKIP_PREFIXES = ["key_", "light_"];

function shouldSkip(name) {
  if (SKIP_EXACT.has(name)) return true;
  return SKIP_PREFIXES.some((p) => name.startsWith(p));
}

function main() {
  const manifest = JSON.parse(readFileSync(SRC, "utf8"));
  const collection = manifest.collections?.["Scene Collection"];
  if (!Array.isArray(collection)) {
    throw new Error(
      `Expected manifest.collections["Scene Collection"] array, got ${typeof collection}`,
    );
  }

  const meshes = [];
  for (const entry of collection) {
    if (!entry?.name || !entry.world_loc || !entry.dimensions) continue;
    if (shouldSkip(entry.name)) continue;
    const center = blenderPosToThree(entry.world_loc).map((v) =>
      Number(v.toFixed(4)),
    );
    const dims = blenderSizeToThree(entry.dimensions);
    const half = dims.map((d) => Number((d / 2).toFixed(4)));
    if (half.some((h) => h <= 0)) continue;
    meshes.push({
      name: entry.name,
      center,
      half,
      phase: phaseFor(entry.name),
    });
  }

  // Stable sort: phase ascending, name alphabetical within phase.
  // Determinism keeps the committed JSON diff-minimal across re-runs.
  meshes.sort((a, b) => a.phase - b.phase || a.name.localeCompare(b.name));

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceSha: manifest.export_hash ?? null,
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
