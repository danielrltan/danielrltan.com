#!/usr/bin/env node
/**
 * optimize-assets.mjs
 *
 * Repeatable, idempotent GLB optimizer for this project's three.js assets.
 *
 * For each target GLB it:
 *   1. Keeps a pristine backup (public/<name>.original.glb) the FIRST time it runs.
 *      Subsequent runs ALWAYS read from that backup, so re-running never compounds
 *      (lossy textures / quantization are not stacked).
 *   2. Cleans geometry: dedup() -> weld() -> prune().
 *   3. Resizes + re-encodes every texture to WebP via sharp:
 *        - color/photographic maps  -> lossy  WebP (quality ~80)
 *        - data maps (metalRough/normal/occlusion) -> lossless WebP
 *        - longest edge clamped to 1024px (512px for small props/vinyl covers)
 *   4. Applies meshopt compression: reorder() + quantize() + EXT_meshopt_compression.
 *      Position quantization is conservative (14-bit) to preserve visual fidelity.
 *
 * Decoder requirements (EXT_meshopt_compression is set REQUIRED):
 *   - drei v10 useGLTF auto-registers MeshoptDecoder (mac/keypad — not touched here)
 *   - the Hobbies cluster uses a RAW GLTFLoader, so HobbiesScene.tsx calls
 *     loader.setMeshoptDecoder(MeshoptDecoder) explicitly. Keep them in sync.
 *   - three's GLTFLoader natively decodes EXT_texture_webp
 *
 * Backups: public/<name>.original.glb is gitignored (local-only, for idempotent
 * re-runs). The pristine pre-compression GLBs also live in git history.
 *
 * Usage: npm run optimize:assets   (or: node scripts/optimize-assets.mjs)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, copyFileSync, statSync } from 'node:fs';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import {
  dedup,
  weld,
  prune,
  reorder,
  quantize,
  textureCompress,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

// --- Per-asset config -------------------------------------------------------

// The Hobbies cluster GLBs (~2.3 MB total, luggage + gpu are the heavy ones).
// They're viewed at cluster DISTANCE (the Play reel), so position+normal
// quantization is invisible — exactly the case meshopt is for. The old room.glb
// target is gone (the 3D room was retired). keypad.glb / mac.glb stay EXCLUDED:
// they're close-up hero models whose smooth shading matters — normal
// quantization made the keypad caps read harsh up close, a saving not worth it.
const TARGETS = [
  { name: 'hobbies/boot.glb' },
  { name: 'hobbies/car.glb' },
  { name: 'hobbies/cursor.glb' },
  { name: 'hobbies/donut.glb' },
  { name: 'hobbies/glove.glb' },
  { name: 'hobbies/gpu.glb' },
  { name: 'hobbies/keyboard.glb' },
  { name: 'hobbies/luggage.glb' },
  { name: 'hobbies/piano.glb' },
  { name: 'hobbies/ski.glb' },
];

// Textures whose longest edge should be clamped to 512px (small props / covers).
// Matched case-insensitively against the texture name.
const SMALL_TEXTURE_PATTERNS = [/vinyl/i, /vinylcover/i, /display/i];

// Texture names that are data maps and must stay lossless (no lossy artifacts).
// We also detect data maps structurally (normal / metalRough / occlusion slots),
// but this is a name-based safety net.
const DATA_TEXTURE_PATTERNS = [/normal/i, /_nrm/i, /rough/i, /metal/i, /_orm/i, /_arm/i];

const MAX_EDGE_DEFAULT = 1024;
const MAX_EDGE_SMALL = 512;
const WEBP_QUALITY = 80;

// --- Helpers ----------------------------------------------------------------

function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function isSmall(name) {
  return SMALL_TEXTURE_PATTERNS.some((re) => re.test(name || ''));
}

/**
 * Build the set of textures that are used in a data slot (normal / metalRough /
 * occlusion) anywhere in the document. Those must be encoded losslessly.
 */
function collectDataTextures(doc) {
  const dataTextures = new Set();
  for (const mat of doc.getRoot().listMaterials()) {
    for (const tex of [
      mat.getNormalTexture(),
      mat.getMetallicRoughnessTexture(),
      mat.getOcclusionTexture(),
    ]) {
      if (tex) dataTextures.add(tex);
    }
  }
  // Name-based safety net.
  for (const tex of doc.getRoot().listTextures()) {
    if (DATA_TEXTURE_PATTERNS.some((re) => re.test(tex.getName() || ''))) {
      dataTextures.add(tex);
    }
  }
  return dataTextures;
}

function textureStats(doc) {
  const out = [];
  for (const tex of doc.getRoot().listTextures()) {
    let dim = '?';
    try {
      const s = tex.getSize();
      if (s) dim = `${s[0]}x${s[1]}`;
    } catch { /* ignore */ }
    const img = tex.getImage();
    out.push({
      name: tex.getName(),
      mime: tex.getMimeType(),
      dim,
      bytes: img ? img.byteLength : 0,
    });
  }
  return out;
}

async function optimizeOne(io, name) {
  const dest = join(PUBLIC_DIR, name);
  const backup = join(PUBLIC_DIR, name.replace(/\.glb$/, '.original.glb'));

  if (!existsSync(dest) && !existsSync(backup)) {
    console.log(`  [skip] ${name} not found.`);
    return null;
  }

  // First run: snapshot the pristine asset. Always read from the backup after.
  if (!existsSync(backup)) {
    copyFileSync(dest, backup);
    console.log(`  [backup] created ${name.replace(/\.glb$/, '.original.glb')}`);
  }

  const beforeBytes = statSync(backup).size;
  const doc = await io.read(backup);

  // --- Pre-optimization stats ---
  const root = doc.getRoot();
  const beforeTex = textureStats(doc);
  const beforeMeshes = root.listMeshes().length;
  const beforeMats = root.listMaterials().length;
  const beforeNodes = root.listNodes().length;

  // --- Geometry cleanup ---
  await doc.transform(
    dedup(),
    weld(),
    prune({ keepLeaves: false }),
  );

  // --- Texture pipeline ---
  // Data maps stay lossless; clamp size based on the texture name.
  const dataTextures = collectDataTextures(doc);

  // Decide per-texture target edge by inspecting names. textureCompress takes a
  // single resize for the whole pass, so we run two passes: one for "small"
  // textures (512) and one for the rest (1024). We separate by temporarily
  // tagging which textures each pass should touch via the `pattern` option is
  // not flexible enough, so we resize manually per texture instead.
  for (const tex of root.listTextures()) {
    const image = tex.getImage();
    if (!image) continue;

    const lossless = dataTextures.has(tex);
    const maxEdge = isSmall(tex.getName()) ? MAX_EDGE_SMALL : MAX_EDGE_DEFAULT;

    let pipeline = sharp(Buffer.from(image), { failOn: 'none' });
    const meta = await pipeline.metadata();
    const longest = Math.max(meta.width || 0, meta.height || 0);
    if (longest > maxEdge) {
      pipeline = pipeline.resize({
        width: meta.width >= meta.height ? maxEdge : undefined,
        height: meta.height > meta.width ? maxEdge : undefined,
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    const encoded = await pipeline
      .webp(lossless ? { lossless: true, effort: 6 } : { quality: WEBP_QUALITY, effort: 6 })
      .toBuffer();

    tex.setImage(new Uint8Array(encoded));
    tex.setMimeType('image/webp');
  }

  // --- Meshopt compression ---
  await MeshoptEncoder.ready;
  try {
    await doc.transform(
      reorder({ encoder: MeshoptEncoder, target: 'size' }),
      quantize({
        quantizePosition: 14,
        quantizeNormal: 10,
        quantizeTexcoord: 12,
        quantizeColor: 8,
        quantizeWeight: 8,
        quantizeGeneric: 12,
      }),
    );
  } catch (err) {
    console.warn(`  [warn] quantize failed (${err.message}); retrying without quantization.`);
    // Reload from backup-derived state would be heavy; instead just skip quantize.
    await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
  }

  doc.createExtension(EXTMeshoptCompression)
    .setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });

  await io.write(dest, doc);

  const afterBytes = statSync(dest).size;

  // Re-read the written file for honest "after" texture stats.
  const afterDoc = await io.read(dest);
  const afterTex = textureStats(afterDoc);
  const afterRoot = afterDoc.getRoot();

  return {
    name,
    beforeBytes,
    afterBytes,
    beforeTex,
    afterTex,
    beforeMeshes,
    afterMeshes: afterRoot.listMeshes().length,
    beforeMats,
    afterMats: afterRoot.listMaterials().length,
    beforeNodes,
    afterNodes: afterRoot.listNodes().length,
  };
}

async function main() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  // EXT_meshopt_compression needs the encoder/decoder dependencies registered.
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  io.registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });

  const results = [];
  for (const t of TARGETS) {
    console.log(`\nOptimizing ${t.name} ...`);
    const r = await optimizeOne(io, t.name);
    if (r) {
      results.push(r);
      console.log(
        `  done: ${fmtBytes(r.beforeBytes)} -> ${fmtBytes(r.afterBytes)} ` +
        `(${((1 - r.afterBytes / r.beforeBytes) * 100).toFixed(1)}% smaller)`,
      );
    }
  }

  console.log('\n================ SUMMARY ================');
  for (const r of results) {
    console.log(`\n${r.name}`);
    console.log(`  size:      ${fmtBytes(r.beforeBytes)} -> ${fmtBytes(r.afterBytes)}`);
    console.log(`  meshes:    ${r.beforeMeshes} -> ${r.afterMeshes}`);
    console.log(`  materials: ${r.beforeMats} -> ${r.afterMats}`);
    console.log(`  nodes:     ${r.beforeNodes} -> ${r.afterNodes}`);
    console.log(`  textures:  ${r.beforeTex.length} -> ${r.afterTex.length}`);
    for (let i = 0; i < r.afterTex.length; i++) {
      const b = r.beforeTex[i];
      const a = r.afterTex[i];
      console.log(
        `    ${(a.name || '(unnamed)').padEnd(22)} ` +
        `${(b ? `${b.dim} ${b.mime} ${fmtBytes(b.bytes)}` : '-').padEnd(34)} -> ` +
        `${a.dim} ${a.mime} ${fmtBytes(a.bytes)}`,
      );
    }
  }
  console.log('\n=========================================');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
