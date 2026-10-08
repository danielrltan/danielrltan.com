// postbuild: send dist's hidden source maps (vite build.sourcemap "hidden") to the owner's collector on poddleball.com, privately, so the
// stats panel can show real function names in its flame graphs (poddle NOTES 234); then delete every .map from dist so none is published.
// Uploads only when PODDLE_STATS_KEY is set (the Vercel project's env; local builds skip it) and only the chunk names Poddle lacks: a
// content-hashed name never changes content. An upload failure never fails the build; the deletion always runs.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DIST = path.resolve("dist");
const API = process.env.PODDLE_API || "https://poddleball.com/api/perf"; // PODDLE_API: a local collector, for tests
const KEY = (process.env.PODDLE_STATS_KEY || "").trim();

const maps = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".map")) maps.push(p);
  }
})(DIST);

async function upload() {
  if (!KEY) return console.log(`sourcemaps: ${maps.length} made, not uploaded (no PODDLE_STATS_KEY)`);
  const auth = { Authorization: `Bearer ${KEY}` };
  const res = await fetch(`${API}/sourcemaps`, { headers: auth });
  if (!res.ok) throw new Error(`list ${res.status}`);
  const have = new Set((await res.json()).files ?? []);
  let sent = 0;
  for (const p of maps) {
    const name = path.basename(p);
    if (!/^[A-Za-z0-9_-]{1,100}\.js\.map$/.test(name) || have.has(name)) continue;
    const r = await fetch(`${API}/sourcemap?file=${name}`, { method: "PUT", headers: auth, body: zlib.gzipSync(fs.readFileSync(p)) });
    if (!r.ok) throw new Error(`${name} ${r.status}`);
    sent++;
  }
  console.log(`sourcemaps: ${sent} uploaded, ${maps.length - sent} already there`);
}

try {
  await upload();
} catch (e) {
  console.warn(`sourcemaps: upload failed (${e.message}); the flame graph shows minified names for this build`);
} finally {
  for (const p of maps) fs.rmSync(p, { force: true });
  console.log(`sourcemaps: ${maps.length} removed from dist`);
}
