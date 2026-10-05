/**
 * Real numbers for the loader's speed readouts. The 0→100 count is a paced
 * timeline (TIMELINE_FLOOR_MS), so the variants pair it with what the browser
 * actually did: wall-clock since navigation start, bytes and files fetched.
 *
 * Cached and cross-origin (no Timing-Allow-Origin, e.g. Google Fonts) entries
 * report transferSize 0; we fall back to encodedBodySize and count them as
 * cached so nothing claims a network speed it didn't see.
 */
export interface LoadStats {
  /** ms since navigation start (performance.now() origin). */
  elapsedMs: number;
  /** bytes fetched (transferSize, else encodedBodySize). */
  bytes: number;
  /** resources seen, document included. */
  files: number;
  /** of `files`, how many came from cache (or reported no size). */
  cached: number;
  /** average network rate in bytes/s over the time spent fetching; 0 if
   *  everything came from cache. */
  bytesPerSec: number;
  /** most recent resource's file name, for tickers. */
  last: string;
  /** every resource seen, in arrival order (shared array, do not mutate). */
  entries: LoadEntry[];
}

export interface LoadEntry {
  bytes: number;
  kind: "doc" | "script" | "style" | "font" | "image" | "data";
  cached: boolean;
}

function kindOf(e: PerformanceResourceTiming): LoadEntry["kind"] {
  if (e.entryType === "navigation") return "doc";
  const n = e.name.split("?")[0];
  if (/\.(woff2?|ttf|otf)$/.test(n) || /fonts\.gstatic/.test(n)) return "font";
  if (/\.(png|jpe?g|webp|avif|gif|svg)$/.test(n)) return "image";
  if (/\.css$/.test(n) || /fonts\.googleapis/.test(n)) return "style";
  if (/\.(m?js|tsx?|jsx)$/.test(n) || e.initiatorType === "script") return "script";
  return "data";
}

let started = false;
let bytes = 0;
let netBytes = 0;
let files = 0;
let cached = 0;
let netSpanEnd = 0;
let last = "";
const entries: LoadEntry[] = [];

function add(e: PerformanceResourceTiming) {
  const t = e.transferSize || 0;
  const size = t || e.encodedBodySize || 0;
  files++;
  bytes += size;
  entries.push({ bytes: size, kind: kindOf(e), cached: !t });
  if (t > 0) {
    netBytes += t;
    netSpanEnd = Math.max(netSpanEnd, e.responseEnd);
  } else cached++;
  try {
    last = new URL(e.name).pathname.split("/").pop() || e.name;
  } catch {
    last = e.name;
  }
}

/** Idempotent: starts the buffered observer once per page. */
export function startLoadStats() {
  if (started || typeof performance === "undefined") return;
  started = true;
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (nav) add(nav);
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) add(e as PerformanceResourceTiming);
    });
    po.observe({ type: "resource", buffered: true });
  } catch {
    for (const e of performance.getEntriesByType("resource"))
      add(e as PerformanceResourceTiming);
  }
}

export function readLoadStats(): LoadStats {
  const span = netSpanEnd / 1000;
  return {
    elapsedMs: performance.now(),
    bytes,
    files,
    cached,
    bytesPerSec: span > 0 ? netBytes / span : 0,
    last,
    entries,
  };
}

export const fmtKB = (b: number) =>
  b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;
export const fmtSec = (ms: number) => `${(ms / 1000).toFixed(2)}s`;
export const fmtRate = (bps: number) =>
  bps <= 0 ? "cached" : bps >= 1e6 ? `${(bps / 1e6).toFixed(1)} MB/s` : `${Math.round(bps / 1e3)} KB/s`;
