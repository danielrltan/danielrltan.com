#!/usr/bin/env node
/**
 * process-photos.mjs  —  `npm run photos`
 *
 * Drag-and-drop photo pipeline for the "Off the clock / Photos" reel.
 *
 * WORKFLOW:
 *   1. Drop photos (or a whole exported iOS album) into  photos-inbox/
 *      — that folder is the SOURCE SET and is gitignored (raw originals
 *        never get committed).
 *   2. Run `npm run photos`.
 *   3. It resizes + converts everything to web-optimised WebP into
 *      public/photos/ and regenerates public/photos/manifest.json.
 *   4. Commit public/photos/ and push. The reel reads the manifest at
 *      runtime, so no code changes per upload.
 *
 * Handles iPhone albums: HEIC/HEIF, JPEG, PNG, WebP, TIFF. EXIF orientation
 * is auto-applied so portrait shots aren't sideways. Live-Photo videos
 * (.mov/.mp4), edit sidecars (.aae), and hidden/system files are skipped.
 *
 * Re-running rebuilds public/photos/ from whatever is currently in
 * photos-inbox/ (inbox = the full set), so removing a photo from the inbox
 * and re-running removes it from the site.
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const INBOX = path.join(ROOT, "photos-inbox");
const OUT = path.join(ROOT, "public", "photos");
const MANIFEST = path.join(OUT, "manifest.json");

// Longest edge in px. The reel cards are small squares (height clamp ≤220px,
// object-fit:cover), so 1400px was ~6× oversized — 36 shots = ~4.9MB that
// decoded slowly and left blank cards on weak machines. 600px is crisp even at
// ~2.7× DPR for a 220px card, for ~1/5 the bytes.
const MAX_EDGE = 600;
const QUALITY = 74; // WebP quality (plenty for a thumbnail-sized reel card)
const IMAGE_EXT = new Set([".heic", ".heif", ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
const SKIP_EXT = new Set([".mov", ".mp4", ".aae", ".gif", ".pdf"]); // explicitly ignored

function sanitize(base) {
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "photo";
}

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // .DS_Store, ._AppleDouble, etc.
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

/** Resize + WebP-encode a sharp instance. rotate() applies EXIF orientation. */
function toWebp(s) {
  return s
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: QUALITY, effort: 5 })
    .toBuffer({ resolveWithObject: true });
}

/** Convert one file → optimized WebP buffer.
 *  Reads from the FILE PATH (not a buffer): libheif needs a seekable source,
 *  and a buffer throws "bad seek" on HEIC. If sharp still can't decode a
 *  HEIC/HEIF (older libheif builds), fall back to macOS `sips` → PNG. */
async function convert(file, ext) {
  try {
    return await toWebp(sharp(file, { failOn: "none" }));
  } catch (err) {
    if ((ext === ".heic" || ext === ".heif") && process.platform === "darwin") {
      const tmp = path.join(os.tmpdir(), `photo-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
      await execFileP("sips", ["-s", "format", "png", file, "--out", tmp]);
      try {
        return await toWebp(sharp(tmp, { failOn: "none" }));
      } finally {
        await fs.unlink(tmp).catch(() => {});
      }
    }
    throw err;
  }
}

async function main() {
  if (!existsSync(INBOX)) {
    console.error(`✘ ${path.relative(ROOT, INBOX)}/ doesn't exist. Create it and drop photos in.`);
    process.exit(1);
  }
  await fs.mkdir(OUT, { recursive: true });

  // Clear previously-generated webp + manifest so the build mirrors the inbox.
  for (const f of await fs.readdir(OUT)) {
    if (f.endsWith(".webp") || f === "manifest.json") await fs.unlink(path.join(OUT, f));
  }

  const files = (await walk(INBOX)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const manifest = [];
  const usedNames = new Set();
  let skipped = 0, failed = 0, totalBytes = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXT.has(ext)) {
      if (SKIP_EXT.has(ext)) skipped++;
      continue;
    }
    try {
      let name = sanitize(path.basename(file, ext));
      let unique = name, n = 2;
      while (usedNames.has(unique)) unique = `${name}-${n++}`;
      usedNames.add(unique);

      const { data, info } = await convert(file, ext);

      const outName = `${unique}.webp`;
      await fs.writeFile(path.join(OUT, outName), data);
      totalBytes += data.byteLength;
      manifest.push({ src: `/photos/${outName}`, w: info.width, h: info.height });
      process.stdout.write(`  ✓ ${path.basename(file)} → ${outName}  ${info.width}×${info.height}  ${(data.byteLength / 1024).toFixed(0)}KB\n`);
    } catch (err) {
      failed++;
      console.warn(`  ✘ ${path.basename(file)} — ${err.message.split("\n")[0]}`);
    }
  }

  await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`\n${manifest.length} photo(s) → public/photos/  (${(totalBytes / 1024 / 1024).toFixed(2)} MB total)` +
    (skipped ? `, ${skipped} non-image skipped` : "") + (failed ? `, ${failed} failed` : ""));
  if (manifest.length > 40) {
    console.log(`  ⚠ ${manifest.length} is a lot for the reel — ~24–30 strong shots reads best. Trim the inbox + re-run.`);
  }
  console.log(`  Manifest: public/photos/manifest.json — commit public/photos/ and push.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
