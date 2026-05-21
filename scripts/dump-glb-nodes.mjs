import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node dump-glb-nodes.mjs <path-to-glb>");
  process.exit(1);
}

const buf = readFileSync(path);
const magic = buf.toString("utf8", 0, 4);
if (magic !== "glTF") {
  console.error("not a glb file (no glTF magic)");
  process.exit(1);
}

const jsonLength = buf.readUInt32LE(12);
const jsonStr = buf.toString("utf8", 20, 20 + jsonLength);
const gltf = JSON.parse(jsonStr);

console.log("nodes:");
for (const node of gltf.nodes || []) {
  console.log(`  ${node.name ?? "(unnamed)"}`);
}
console.log("\nmeshes:");
for (const mesh of gltf.meshes || []) {
  console.log(`  ${mesh.name ?? "(unnamed)"}`);
}
