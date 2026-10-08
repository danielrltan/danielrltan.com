// Page-load diagnostics for the stats panel: what public/rum.js (and Poddle's web/rum.js) sent to Poddle's
// collector (poddle NOTES 232), read back with the same Poddle key as the traffic card.
//  - GET /api/perf?site=&days=          the loads, newest first, with their headline timings
//  - GET /api/perf/view?id=             one load: waterfall data (load part) + interactions (fin part)
//  - GET /api/perf/profile?id=          its JS Self-Profiling trace, if it was sampled
//  - GET /api/perf/profiles?site=&page= the newest profiled loads of a page, for the merged flame graph
//  - GET /api/perf/clicks?site=&days=   click targets and interaction latency over the range
//  - GET /api/perf/sourcemap?file=      a danielrltan.com chunk's source map, uploaded privately by the build (poddle NOTES 234):
//                                       symbolicate() turns minified frames back into real names and files
import { KeyError } from "./data";

const API = "https://poddleball.com/api/perf";
export const PERF_SITES = ["danielrltan.com", "poddleball.com"] as const;
export type PerfSite = (typeof PERF_SITES)[number];

export type LoadRow = {
  id: string;
  page: string;
  at: number;
  ua: string;
  ttfb: number | null;
  fcp: number | null;
  lcp: number | null;
  dcl: number | null;
  onload: number | null;
  inp: number | null;
  cls: number | null;
  block: number | null;
  prof: number;
};
// [url, initiator, start, duration, transfer, encoded, responseStart, renderBlocking, status]
export type Res = [string, string, number, number, number | null, number | null, number | null, string, number | null];
// [url, function, invoker, invokerType, start, duration, forcedLayout, charPos]
export type LoafScript = [string, string, string, string, number, number, number | null, number | null];
// [start, duration, blocking, renderStart, styleLayoutStart, scripts]
export type Loaf = [number, number, number | null, number | null, number | null, LoafScript[]];
export type Nav = Record<"rs" | "ws" | "fs" | "ds" | "de" | "cs" | "ss" | "ce" | "qs" | "ps" | "pe" | "di" | "dc" | "dl" | "ls" | "le", number | null> & {
  ty: string;
  pr: string;
  z: number | null;
};
export type View = LoadRow & {
  site: string;
  load: null | {
    nav: Nav;
    fp: number | null;
    fcp: number | null;
    lcp: { t: number | null; el: string; u: string; z: number | null };
    res: Res[];
    loaf: Loaf[];
    marks: [string, number, number][];
    env: { w: number; h: number; dpr: number; mem: number | null; cpu: number | null; net: string };
    prof: boolean;
    profErr: string;
  };
  fin: null | {
    cls: number | null;
    inp: number | null;
    dur: number | null;
    ev: [string, string, number, number, number, number, number][]; // [event, target, start, duration, inputDelay, processing, presentation]
    loaf: Loaf[];
    clicks: [string, number][];
  };
};
export type Trace = {
  resources: string[];
  frames: { name: string; resourceId?: number; line?: number; column?: number }[];
  stacks: { frameId: number; parentId?: number }[];
  samples: { timestamp: number; stackId?: number }[];
};
export type ClickStats = { targets: { target: string; n: number }[]; slow: { target: string; n: number; p75: number; max: number }[] };

async function get(path: string, key: string) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${key}` } });
  if (res.status === 401 || res.status === 403) throw new KeyError("key rejected");
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}
export const listLoads = async (key: string, site: PerfSite, days: number): Promise<LoadRow[]> =>
  (await get(`?site=${site}&days=${Math.min(30, days)}`, key)).views ?? [];
export const getView = (key: string, id: string): Promise<View> => get(`/view?id=${id}`, key);
export const getTrace = (key: string, id: string): Promise<Trace> => get(`/profile?id=${id}`, key);
export const profiledIds = async (key: string, site: PerfSite, page: string, days: number): Promise<string[]> =>
  (await get(`/profiles?site=${site}&page=${encodeURIComponent(page)}&days=${Math.min(30, days)}`, key)).ids ?? [];
export const getClicks = (key: string, site: PerfSite, days: number): Promise<ClickStats> => get(`/clicks?site=${site}&days=${Math.min(30, days)}`, key);

export function pct(values: (number | null)[], p: number): number | null {
  const v = values.filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.floor(p * v.length))];
}

// ---- profiles -> flame trees ----------------------------------------------------

export type Frame = { name: string; file: string; line: number | null; col: number | null };
export type FlameNode = { key: string; frame: Frame; total: number; self: number; children: Map<string, FlameNode> };
export const ROOT_FRAME: Frame = { name: "all", file: "", line: null, col: null };
const newNode = (key: string, frame: Frame): FlameNode => ({ key, frame, total: 0, self: 0, children: new Map() });

const frameOf = (t: Trace, id: number): Frame => {
  const f = t.frames[id] ?? { name: "?" };
  return { name: f.name || "(anonymous)", file: f.resourceId != null ? t.resources[f.resourceId] ?? "" : "", line: f.line ?? null, col: f.column ?? null };
};
const frameKey = (f: Frame) => `${f.name}|${f.file}|${f.line ?? ""}|${f.col ?? ""}`;

/** Each sample's stack, root first, and how long it stood for (ms): the gap to the next sample, capped. */
export function sampleStacks(t: Trace): { at: number; ms: number; stack: Frame[] }[] {
  const memo = new Map<number, Frame[]>();
  const stackOf = (sid: number | undefined): Frame[] => {
    if (sid == null || !t.stacks[sid]) return [];
    const m = memo.get(sid);
    if (m) return m;
    const out: Frame[] = [];
    for (let s: number | undefined = sid, guard = 0; s != null && t.stacks[s] && guard < 512; s = t.stacks[s].parentId, guard++) out.push(frameOf(t, t.stacks[s].frameId));
    out.reverse();
    memo.set(sid, out);
    return out;
  };
  const xs = t.samples;
  return xs.map((s, i) => ({ at: s.timestamp, ms: i + 1 < xs.length ? Math.min(50, Math.max(0, xs[i + 1].timestamp - s.timestamp)) : 10, stack: stackOf(s.stackId) }));
}

/** A flame graph (icicle) tree: identical stacks merged, widths in ms. Idle samples are left out. */
export function mergeTraces(traces: Trace[]): FlameNode {
  const root = newNode("root", ROOT_FRAME);
  for (const t of traces)
    for (const s of sampleStacks(t)) {
      if (!s.stack.length) continue;
      root.total += s.ms;
      let n = root;
      for (const f of s.stack) {
        const k = frameKey(f);
        let c = n.children.get(k);
        if (!c) n.children.set(k, (c = newNode(k, f)));
        c.total += s.ms;
        n = c;
      }
      n.self += s.ms;
    }
  return root;
}

/** A flame chart for one load: per depth, runs of the same frame over time. */
export type ChartBlock = { depth: number; start: number; end: number; frame: Frame };
export function flameChart(t: Trace): { blocks: ChartBlock[]; start: number; end: number; depth: number } {
  const ss = sampleStacks(t);
  const blocks: ChartBlock[] = [];
  const open: (ChartBlock & { key: string })[] = [];
  let depth = 0;
  for (const s of ss) {
    let d = 0;
    for (; d < s.stack.length; d++) {
      const k = frameKey(s.stack[d]);
      const o = open[d];
      if (o && o.key === k && o.end >= s.at - 0.5) o.end = s.at + s.ms;
      else break;
    }
    for (let j = d; j < open.length; j++) blocks.push(open[j]);
    open.length = d;
    for (; d < s.stack.length; d++) open.push({ key: frameKey(s.stack[d]), depth: d, start: s.at, end: s.at + s.ms, frame: s.stack[d] });
    depth = Math.max(depth, s.stack.length);
  }
  blocks.push(...open);
  return { blocks, start: ss.length ? ss[0].at : 0, end: ss.length ? ss[ss.length - 1].at + ss[ss.length - 1].ms : 0, depth };
}

/** Chrome DevTools' .cpuprofile, so a load can be opened in the Performance panel. */
export function toCpuProfile(t: Trace) {
  type N = { id: number; callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number; scriptId: string }; children: number[] };
  const nodes: N[] = [{ id: 1, callFrame: { functionName: "(root)", url: "", lineNumber: -1, columnNumber: -1, scriptId: "0" }, children: [] }];
  const idle: N = { id: 2, callFrame: { functionName: "(idle)", url: "", lineNumber: -1, columnNumber: -1, scriptId: "0" }, children: [] };
  nodes.push(idle);
  nodes[0].children.push(2);
  const byPath = new Map<string, number>();
  const nodeFor = (sid: number | undefined): number => {
    if (sid == null || !t.stacks[sid]) return 2;
    const path = `s${sid}`;
    const hit = byPath.get(path);
    if (hit) return hit;
    const st = t.stacks[sid];
    const parent = st.parentId != null ? nodeFor(st.parentId) : 1;
    const f = frameOf(t, st.frameId);
    const n: N = { id: nodes.length + 1, callFrame: { functionName: f.name, url: f.file, lineNumber: (f.line ?? 0) - 1, columnNumber: (f.col ?? 0) - 1, scriptId: "0" }, children: [] };
    nodes.push(n);
    nodes[parent - 1].children.push(n.id);
    byPath.set(path, n.id);
    return n.id;
  };
  const samples = t.samples.map((s) => nodeFor(s.stackId));
  const us = t.samples.map((s) => Math.round(s.timestamp * 1000));
  const timeDeltas = us.map((u, i) => (i ? u - us[i - 1] : 0));
  return { nodes, startTime: us[0] ?? 0, endTime: us[us.length - 1] ?? 0, samples, timeDeltas };
}

/** A short label for a script URL: the file name, or the host for another site's. */
export function fileLabel(u: string) {
  if (!u) return "";
  if (u.startsWith("/")) return u.split("/").pop() || u;
  try {
    const x = new URL(u);
    return x.host + "/" + (x.pathname.split("/").pop() ?? "");
  } catch {
    return u;
  }
}

// ---- source maps: minified frames -> real names and files -----------------------

// A decoded map: per generated line, segments flattened as [genCol, src, srcLine, srcCol, name (-1 = none)] * n, sorted by genCol.
type Decoded = { sources: string[]; names: string[]; lines: Int32Array[] };
const B64 = new Int8Array(128).fill(-1);
"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".split("").forEach((c, i) => (B64[c.charCodeAt(0)] = i));
function decode(map: { sources: string[]; names?: string[]; mappings: string; sourceRoot?: string }): Decoded {
  const lines: Int32Array[] = [];
  const m = map.mappings;
  let i = 0, src = 0, sl = 0, sc = 0, nm = 0;
  let cur: number[] = [];
  let gc = 0;
  const vlq = () => {
    let v = 0, shift = 0, d: number;
    do {
      d = B64[m.charCodeAt(i++)];
      v += (d & 31) << shift;
      shift += 5;
    } while (d & 32);
    return v & 1 ? -(v >>> 1) : v >>> 1;
  };
  while (i <= m.length) {
    const c = m.charCodeAt(i);
    if (i === m.length || c === 59 /* ; */) {
      lines.push(Int32Array.from(cur));
      cur = [];
      gc = 0;
      i++;
      continue;
    }
    if (c === 44 /* , */) {
      i++;
      continue;
    }
    gc += vlq();
    let name = -1, s0 = -1, l0 = 0, c0 = 0;
    if (i < m.length && m.charCodeAt(i) !== 44 && m.charCodeAt(i) !== 59) {
      src += vlq(); sl += vlq(); sc += vlq();
      s0 = src; l0 = sl; c0 = sc;
      if (i < m.length && m.charCodeAt(i) !== 44 && m.charCodeAt(i) !== 59) name = nm += vlq();
    }
    cur.push(gc, s0, l0, c0, name);
  }
  return { sources: map.sources.map(cleanSource), names: map.names ?? [], lines };
}
/** "../../src/hero/heroWipe.ts" -> "src/hero/heroWipe.ts"; "../../node_modules/three/build/x.js" -> "three/build/x.js" */
function cleanSource(s: string) {
  const nm = s.lastIndexOf("node_modules/");
  if (nm >= 0) return s.slice(nm + 13);
  return s.replace(/^(\.\.\/|\.\/|\/)+/, "");
}
/** The segment covering (line0, col0), or the one exactly there when `exact`. */
function seg(d: Decoded, line0: number, col0: number, exact = false) {
  const L = d.lines[line0];
  if (!L || !L.length) return null;
  let lo = 0, hi = L.length / 5 - 1, at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (L[mid * 5] <= col0) (at = mid), (lo = mid + 1);
    else hi = mid - 1;
  }
  if (at < 0 || L[at * 5 + 1] < 0 || (exact && L[at * 5] !== col0)) return null;
  return { src: d.sources[L[at * 5 + 1]], line: L[at * 5 + 2] + 1, col: L[at * 5 + 3] + 1, name: L[at * 5 + 4] >= 0 ? d.names[L[at * 5 + 4]] : null };
}

const mapCache = new Map<string, Promise<Decoded | null>>();
function mapFor(key: string, file: string) {
  let p = mapCache.get(file);
  if (!p) {
    p = fetch(`${API}/sourcemap?file=${encodeURIComponent(file)}`, { headers: { Authorization: `Bearer ${key}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => (m && typeof m.mappings === "string" ? decode(m) : null))
      .catch(() => null);
    mapCache.set(file, p);
  }
  return p;
}

/**
 * A trace with its minified frames replaced by what the source maps say: the real name (a renamed `function x(` carries it at the
 * frame's position; for `x=(...)=>` it sits on the identifier before the `=`), and the original file, line and column. The profiler's
 * line/column are 1-based and point at the function's `(` (measured, poddle NOTES 234). Frames with no map (another site's files,
 * an unminified file, a map that was never uploaded) are left as they were.
 */
export async function symbolicate(key: string, t: Trace): Promise<Trace> {
  const files = [...new Set(t.resources.filter((u) => /^\/assets\/[A-Za-z0-9_-]+\.js$/.test(u)))];
  const maps = new Map<string, Decoded>();
  await Promise.all(files.map(async (u) => { const d = await mapFor(key, u.slice(8) + ".map"); if (d) maps.set(u, d); }));
  if (!maps.size) return t;
  const resources = [...t.resources];
  const rid = (u: string) => { let i = resources.indexOf(u); if (i < 0) i = resources.push(u) - 1; return i; };
  const frames = t.frames.map((f) => {
    const d = f.resourceId != null ? maps.get(t.resources[f.resourceId]) : undefined;
    if (!d || f.line == null || f.column == null) return f;
    const at = seg(d, f.line - 1, f.column - 1);
    if (!at) return f;
    const named = at.name ?? (f.name ? seg(d, f.line - 1, f.column - 2 - f.name.length, true)?.name : null);
    return { name: named || f.name, resourceId: rid(at.src), line: at.line, column: at.col };
  });
  return { resources, frames, stacks: t.stacks, samples: t.samples };
}

/** What a frame belongs to, for colour and the legend: "src" for the site's own code, else its npm package; "" = the browser. */
export function packageOf(file: string) {
  if (!file) return "";
  if (file.startsWith("src/")) return "src";
  if (file.startsWith("/") || /^https?:/.test(file)) return fileLabel(file);
  const p = file.split("/");
  return p[0].startsWith("@") ? `${p[0]}/${p[1]}` : p[0];
}

