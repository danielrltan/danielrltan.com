// scripts/motion-trace.mjs
//
// Frame-timing harness for the scroll choreography. Drives a REAL wheel scroll
// (page.mouse.wheel, small steps, human-ish pacing, deterministic pauses) from
// the top of the page to the bottom, so Lenis smoothing, GSAP scrub, sticky holds, seams,
// snaps and the hero->About settle are all exercised exactly as a visitor
// triggers them, and records per-frame timing bucketed by section.
//
//   npm run build && npm run test:motion                       # vite preview on :4191 (auto-started)
//   URL=http://localhost:5173/ npm run test:motion             # against a running dev server
//   DPR=2 RUNS=3 OUT=.scratch/motion-dpr2.json npm run test:motion
//   GPU=1 npm run test:motion                                  # real GPU (ANGLE/Metal on macOS), still headless
//
// Env: URL, W (1440), H (900), DPR (1), TIER (standard; "" = auto probe),
//      GPU (0|1), RUNS (1), STEP (wheel deltaY, 100), SEED (1), PAUSE_MS (700),
//      OUT (.scratch/motion-trace.json), PORT (4191), MAX_S (480, drive time cap),
//      TRACE (0|1: also record a Chromium trace and count COMPOSITOR frames
//      presented vs dropped per bucket from PipelineReporter events; this is
//      what catches raster/GPU-side jank such as SVG filter rasterization that
//      never blocks the main thread, so rAF alone cannot see it).
//
// What it measures, per bucket (section at viewport centre + an overlapping
// "hero-to-about" window, scrollY 0..1.2*innerHeight) and overall:
//   - rAF frame intervals: p50/p95/p99/max ms, % > 20ms, % > 33ms, and an
//     estimated dropped-frame count (sum of round(dt/idle)-1, where idle is the
//     rAF cadence measured before the drive; headless Chromium runs at ~8.3ms).
//   - long-animation-frame entries (fallback: longtask): count, total/blocking
//     ms, and the top script sources so one-off canvas mounts can be told apart
//     from per-frame cost.
//   - scroll response lag (first wheel after >=200ms idle -> first rAF where
//     scrollY changed), tracking lag (input target px - scrollY px, per frame
//     while wheeling), and settle tail per pause (last wheel -> scrollY stable,
//     plus where it settled vs where the input pointed: a large drift means a
//     snap or the hero settle intervened).
//   - hero path: whether data-hero-lite (the cheap no-SVG-filter path) was on at
//     start or latched mid-run (adaptive degrade in App.tsx), plus the
//     data-hero-px / data-hero-diving timeline. A before/after comparison is
//     ONLY valid if both sides ran the same hero path.
//
// CAVEATS. rAF deltas measure main-thread cadence; raster / GPU filter cost only
// shows up through pipeline back-pressure. The default mode renders with
// SwiftShader (CPU), which is CPU-bound much like the software-rasterized SVG
// filters, so timings are NOT absolute truth but RELATIVE before/after
// comparisons on the same machine and mode are meaningful. GPU=1 uses the real
// GPU (new headless, ANGLE Metal) and is closer to a visitor's laptop. Note that
// at DPR > 1.4 the site pre-selects data-hero-lite, so a DPR2 run never
// exercises the hero's feMorphology filters.

import { chromium } from "playwright";
import { spawn, execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const PORT = Number(process.env.PORT || 4191); // NOT 4190: it is on the fetch/Chromium unsafe-port list (sieve);
const URL = process.env.URL || `http://localhost:${PORT}/`;
const W = Number(process.env.W || 1440);
const H = Number(process.env.H || 900);
const DPR = Number(process.env.DPR || 1);
const TIER = process.env.TIER ?? "standard";
const GPU = process.env.GPU === "1";
const RUNS = Math.max(1, Number(process.env.RUNS || 1));
const STEP = Number(process.env.STEP || 100);
const SEED = Number(process.env.SEED || 1);
const PAUSE_MS = Number(process.env.PAUSE_MS || 700);
const OUT = process.env.OUT || ".scratch/motion-trace.json";
const LOADER_TIMEOUT_MS = 45_000;
const TRACE = process.env.TRACE === "1";
const MAX_S = Number(process.env.MAX_S || 480); // drive time cap (SwiftShader runs are slow)

// Same selectors as scripts/smoke-test.mjs (mirrors sectionRegistry).
const SECTIONS = [
  ["Hero", ".portfolio-section--hero"],
  ["About", ".portfolio-about"],
  ["Projects", ".portfolio-mac"],
  ["Work", ".portfolio-work"],
  ["Play", ".other-pin-wrap"],
  ["Honours", ".portfolio-bp"],
  ["Recents", ".portfolio-photos"],
  ["Contact", ".keypad-section"],
];
const HERO_WINDOW = "hero-to-about";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deterministic jitter so runs are comparable.
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── In-page instrumentation (installed before any app code runs) ────────────
function initScript(sections) {
  const mt = (window.__mt = {
    sections,
    ranges: [], // [{name, top, bottom}] section doc ranges, sorted by top; refreshed by ResizeObserver
    y: 0,
    attrEvents: [],
    wheels: [], // [t]
    responses: [], // ms
    samples: { t: [], y: [], sec: [], lag: [] },
    loaf: [],
    loafType: null,
    sampling: false,
    target: 0,
    lastWheelT: -1e9,
    pending: null,
  });

  // documentElement is null when init scripts run; attach once <html> exists.
  let html = document.documentElement;
  const watched = ["data-hero-lite", "data-hero-px", "data-hero-diving", "data-tier", "class", "style"];
  mt.heroCurve = []; // [{t, y, v}] each change of --hero-to-about (the dive progress var)
  const attach = () => new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.attributeName === "style") {
        if (mt.heroFromMirror) continue;
        const hv = html.style.getPropertyValue("--hero-to-about");
        const last = mt.heroCurve[mt.heroCurve.length - 1];
        if (hv && (!last || last.v !== hv) && mt.heroCurve.length < 4000)
          mt.heroCurve.push({ t: performance.now(), y: window.scrollY, v: hv });
        continue;
      }
      const v = html.getAttribute(r.attributeName);
      if (r.attributeName === "class") {
        // only log loader lift / lenis presence transitions
        const s = `${html.classList.contains("loading-active") ? "loading " : ""}${html.classList.contains("lenis") ? "lenis" : ""}`;
        if (mt._cls === s) continue;
        mt._cls = s;
        mt.attrEvents.push({ t: performance.now(), y: window.scrollY, attr: "class", v: s });
        continue;
      }
      mt.attrEvents.push({ t: performance.now(), y: window.scrollY, attr: r.attributeName, v });
    }
  }).observe(html, { attributes: true, attributeFilter: watched });
  if (html) attach();
  else {
    const mo = new MutationObserver(() => {
      if (!document.documentElement) return;
      html = document.documentElement;
      mo.disconnect();
      attach();
    });
    mo.observe(document, { childList: true });
  }
  // Hero dive curve from the hero's debug mirror (spec §5 O8). The observer
  // above only sees --hero-to-about while the hero writes it on <html style>;
  // a hero that scopes its vars never fires it, so poll window.__heroMotion
  // every frame and push on change. The observer stays as the fallback for
  // baseline builds without the mirror (once the mirror exists the poll owns
  // heroCurve, so the two never both push).
  const pollHero = () => {
    const hm = window.__heroMotion;
    if (hm && typeof hm.dive === "number") {
      mt.heroFromMirror = true;
      const v = String(hm.dive);
      const last = mt.heroCurve[mt.heroCurve.length - 1];
      if ((!last || last.v !== v) && mt.heroCurve.length < 4000)
        mt.heroCurve.push({ t: performance.now(), y: window.scrollY, v });
    }
    requestAnimationFrame(pollHero);
  };
  requestAnimationFrame(pollHero);

  addEventListener("scroll", () => (mt.y = window.scrollY), { passive: true, capture: true });
  addEventListener(
    "wheel",
    (e) => {
      const t = e.timeStamp;
      const maxY = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      if (t - mt.lastWheelT > 300) mt.target = window.scrollY; // resync after idle (settle/snap moved us)
      mt.target = Math.min(maxY, Math.max(0, mt.target + e.deltaY));
      if (mt.sampling) {
        mt.wheels.push(t);
        mt.deltaSum = (mt.deltaSum || 0) + e.deltaY;
        if (t - mt.lastWheelT >= 200 && !mt.pending) mt.pending = { t, y0: window.scrollY };
      }
      mt.lastWheelT = t;
    },
    { passive: true, capture: true },
  );

  // Section doc ranges from the registry selectors. Since the seam overhaul
  // (2026-10-06) every section root is in flow and carries its own hold
  // (sticky stage inside a tall root, src/seams/stack.css), so the root's doc
  // top/bottom IS the section's range; there are no pin-spacers to measure.
  // Two roots overlap where a sheet rises over its neighbour (Projects over
  // About, the footer over the keypad): secAt() picks the last range whose top
  // the viewport centre has passed, i.e. the sheet on top, which is the one on
  // screen. Builds from before the overhaul (pin-spacers, e.g. the baseline
  // dist) are NOT bucketed the same way any more; compare them by their own
  // motion-before.json, taken with the old harness.
  mt.computeRanges = () => {
    const out = [];
    for (const [name, sel] of sections) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out.push({ name, top: name === "Hero" ? 0 : r.top + window.scrollY, bottom: r.bottom + window.scrollY });
    }
    out.sort((a, b) => a.top - b.top);
    mt.ranges = out;
    mt.rangeIdx = out.map((r) => sections.findIndex((s) => s[0] === r.name));
  };
  const secAt = (centre) => {
    const r = mt.ranges;
    let k = -1;
    for (let i = 0; i < r.length; i++) if (centre >= r[i].top) k = i;
    return k < 0 ? -1 : mt.rangeIdx[k];
  };

  const frame = (now) => {
    if (!mt.sampling) return;
    const y = mt.y;
    const s = mt.samples;
    s.t.push(now);
    s.y.push(y);
    s.sec.push(secAt(y + innerHeight / 2));
    s.lag.push(now - mt.lastWheelT < 120 ? mt.target - y : NaN);
    if (mt.pending && y !== mt.pending.y0) {
      mt.responses.push(now - mt.pending.t);
      mt.pending = null;
    }
    requestAnimationFrame(frame);
  };
  mt.start = () => {
    mt.computeRanges();
    mt.y = window.scrollY;
    mt.sampling = true;
    mt.t0 = performance.now();
    performance.mark("motion-trace-t0"); // clock anchor for TRACE=1
    requestAnimationFrame(frame);
    if (typeof ResizeObserver !== "undefined" && !mt._ro) {
      mt._ro = new ResizeObserver(() => mt.computeRanges());
      mt._ro.observe(document.body);
    }
  };
  mt.stop = () => {
    mt.sampling = false;
    mt.t1 = performance.now();
  };
  mt.idleCadence = () =>
    new Promise((res) => {
      const ts = [];
      const f = (t) => {
        ts.push(t);
        if (ts.length < 91) requestAnimationFrame(f);
        else {
          const d = ts.slice(1).map((x, i) => x - ts[i]).sort((a, b) => a - b);
          res(d[Math.floor(d.length / 2)]);
        }
      };
      requestAnimationFrame(f);
    });

  const types = (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes) || [];
  const type = types.includes("long-animation-frame") ? "long-animation-frame" : types.includes("longtask") ? "longtask" : null;
  mt.loafType = type;
  if (type) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        mt.loaf.push({
          start: e.startTime,
          dur: e.duration,
          block: e.blockingDuration ?? Math.max(0, e.duration - 50),
          // LoAF phase split: script vs style/layout vs paint/commit tail
          scriptMs: (e.scripts || []).reduce((a, x) => a + x.duration, 0),
          layoutMs: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : null,
          renderMs: e.renderStart ? e.startTime + e.duration - e.renderStart : null,
          scripts: (e.scripts || [])
            .slice()
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 3)
            .map((s) => ({
              d: Math.round(s.duration),
              inv: String(s.invoker || s.name || "").slice(0, 80),
              src: String(s.sourceURL || "").replace(/^.*\//, "") + (s.sourceFunctionName ? `:${s.sourceFunctionName}` : ""),
            })),
        });
      }
    }).observe({ type, buffered: true });
  }
}

// ── Stats ──────────────────────────────────────────────────────────────────
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN);
const r1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

function frameStats(dts, idle, loafs) {
  const s = dts.slice().sort((a, b) => a - b);
  const n = s.length;
  let dropped = 0;
  for (const d of s) dropped += Math.max(0, Math.round(d / idle) - 1);
  return {
    frames: n,
    p50: r1(pct(s, 50)),
    p95: r1(pct(s, 95)),
    p99: r1(pct(s, 99)),
    max: r1(s[n - 1]),
    gt20: r1((100 * s.filter((d) => d > 20).length) / Math.max(1, n)),
    gt33: r1((100 * s.filter((d) => d > 33.4).length) / Math.max(1, n)),
    droppedPct: r1((100 * dropped) / Math.max(1, n + dropped)),
    longN: loafs.length,
    longMs: Math.round(loafs.reduce((a, e) => a + e.dur, 0)),
    blockMs: Math.round(loafs.reduce((a, e) => a + e.block, 0)),
  };
}

function analyse(raw, vh) {
  const { samples: S, loaf, sections: sec } = raw;
  const names = sec.map((s) => s[0]);
  const buckets = Object.fromEntries([...names, HERO_WINDOW, "overall"].map((k) => [k, { dts: [], loaf: [] }]));
  const heroMax = 1.2 * vh;
  for (let i = 1; i < S.t.length; i++) {
    const dt = S.t[i] - S.t[i - 1];
    const name = names[S.sec[i]];
    if (name) buckets[name].dts.push(dt);
    if (S.y[i] <= heroMax) buckets[HERO_WINDOW].dts.push(dt);
    buckets.overall.dts.push(dt);
  }
  // assign each long frame to the sample nearest its start
  const findIdx = (t) => {
    let lo = 0,
      hi = S.t.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (S.t[m] < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  for (const e of loaf) {
    if (e.start < raw.t0 || e.start > raw.t1) continue;
    const i = findIdx(e.start);
    const name = names[S.sec[i]];
    if (name) buckets[name].loaf.push(e);
    if (S.y[i] <= heroMax) buckets[HERO_WINDOW].loaf.push(e);
    buckets.overall.loaf.push(e);
  }
  const perBucket = {};
  for (const [k, b] of Object.entries(buckets)) {
    perBucket[k] = frameStats(b.dts, raw.idle, b.loaf);
    // top script sources inside long frames for this bucket
    const agg = {};
    for (const e of b.loaf) for (const s of e.scripts) {
      const key = `${s.inv} @ ${s.src}`;
      agg[key] = (agg[key] || 0) + s.d;
    }
    perBucket[k].topScripts = Object.entries(agg)
      .sort((a, c) => c[1] - a[1])
      .slice(0, 4)
      .map(([key, ms]) => `${ms}ms ${key}`);
  }

  // tracking lag
  const lags = S.lag.filter((x) => Number.isFinite(x)).map(Math.abs).sort((a, b) => a - b);
  const resp = raw.responses.slice().sort((a, b) => a - b);

  // pauses: gaps in wheel stream >= 300ms
  const pauses = [];
  const wh = raw.wheels;
  const settleAfter = (tLast, tNext) => {
    const i0 = findIdx(tLast);
    let lastMoveT = S.t[i0],
      lastY = S.y[i0];
    for (let i = i0 + 1; i < S.t.length && S.t[i] < tNext; i++) {
      if (S.y[i] !== lastY) {
        lastY = S.y[i];
        lastMoveT = S.t[i];
      }
    }
    return { settleMs: Math.round(lastMoveT - tLast), ySettled: Math.round(lastY), yAtLastWheel: Math.round(S.y[i0]) };
  };
  for (let i = 0; i < wh.length; i++) {
    const next = i + 1 < wh.length ? wh[i + 1] : raw.t1;
    if (next - wh[i] >= 300) {
      const st = settleAfter(wh[i], next);
      const secName = names[S.sec[findIdx(wh[i])]] || "?";
      pauses.push({ at: secName, ...st, gapMs: Math.round(next - wh[i]) });
    }
  }
  const tails = pauses.map((p) => p.settleMs).sort((a, b) => a - b);

  let dist = 0;
  for (let i = 1; i < S.y.length; i++) dist += Math.abs(S.y[i] - S.y[i - 1]);

  // Worst individual frames (rAF intervals) and long animation frames, with
  // where they happened, so one-off mounts can be told apart from steady cost.
  const worstFrames = [];
  for (let i = 1; i < S.t.length; i++) worstFrames.push({ i, dt: S.t[i] - S.t[i - 1] });
  worstFrames.sort((a, b) => b.dt - a.dt);
  const worst = worstFrames.slice(0, 12).map(({ i, dt }) => ({
    tMs: Math.round(S.t[i] - raw.t0),
    dt: r1(dt),
    y: Math.round(S.y[i]),
    at: names[S.sec[i]] || "?",
  }));
  const longFrames = loaf
    .filter((e) => e.start >= raw.t0 && e.start <= raw.t1)
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 12)
    .map((e) => {
      const i = findIdx(e.start);
      return {
        tMs: Math.round(e.start - raw.t0),
        dur: Math.round(e.dur),
        block: Math.round(e.block),
        scriptMs: Math.round(e.scriptMs || 0),
        layoutMs: e.layoutMs == null ? null : Math.round(e.layoutMs),
        renderMs: e.renderMs == null ? null : Math.round(e.renderMs),
        y: Math.round(S.y[i]),
        at: names[S.sec[i]] || "?",
        scripts: e.scripts,
      };
    });

  return {
    buckets: perBucket,
    worstFrames: worst,
    longFrames,
    scroll: {
      responseLagMs: { n: resp.length, p50: r1(pct(resp, 50)), p95: r1(pct(resp, 95)), max: r1(resp[resp.length - 1]) },
      trackingLagPx: { n: lags.length, p50: r1(pct(lags, 50)), p95: r1(pct(lags, 95)), max: r1(lags[lags.length - 1]) },
      settleTailMs: { n: tails.length, p50: r1(pct(tails, 50)), p95: r1(pct(tails, 95)), max: r1(tails[tails.length - 1]) },
      pauses,
      distancePx: Math.round(dist),
      durationMs: Math.round(raw.t1 - raw.t0),
    },
  };
}

// ── Compositor frames from a Chromium trace (TRACE=1) ──────────────────────
function compositorFrames(buf, raw, vh) {
  let evs;
  try {
    const j = JSON.parse(buf.toString());
    evs = Array.isArray(j) ? j : j.traceEvents;
  } catch {
    return null;
  }
  const mark = evs.find((e) => e.name === "motion-trace-t0");
  if (!mark) return null;
  const off = mark.ts / 1000 - raw.t0; // trace ms -> performance.now ms
  const S = raw.samples;
  const names = raw.sections.map((x) => x[0]);
  const findIdx = (t) => {
    let lo = 0,
      hi = S.t.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (S.t[m] < t) lo = m + 1;
      else hi = m;
    }
    return lo;
  };
  const b = {};
  const bump = (k, st) => {
    const o = (b[k] ||= { presented: 0, partial: 0, dropped: 0 });
    if (st === "STATE_DROPPED") o.dropped++;
    else if (st === "STATE_PRESENTED_PARTIAL") o.partial++;
    else if (st === "STATE_PRESENTED_ALL") o.presented++;
  };
  const seen = new Set();
  for (const e of evs) {
    if (e.name !== "PipelineReporter" || (e.ph !== "b" && e.ph !== "X")) continue;
    const st = e.args?.chrome_frame_reporter?.state;
    if (!st || st === "STATE_NO_UPDATE_DESIRED") continue;
    const id = `${e.id2?.local ?? e.id ?? ""}:${e.ts}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = e.ts / 1000 - off;
    if (t < raw.t0 || t > raw.t1) continue;
    const i = findIdx(t);
    const name = names[S.sec[i]];
    if (name) bump(name, st);
    if (S.y[i] <= 1.2 * vh) bump(HERO_WINDOW, st);
    bump("overall", st);
  }
  for (const o of Object.values(b)) {
    const tot = o.presented + o.partial + o.dropped;
    o.droppedPct = r1((100 * o.dropped) / Math.max(1, tot));
  }
  return b;
}

// ── One run ─────────────────────────────────────────────────────────────────
async function oneRun(browser, runIdx) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(initScript, SECTIONS);
  const url = TIER ? `${URL}${URL.includes("?") ? "&" : "?"}tier=${TIER}` : URL;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const tLoad = Date.now();
  while (Date.now() - tLoad < LOADER_TIMEOUT_MS) {
    if (!(await page.evaluate(() => document.documentElement.classList.contains("loading-active")))) break;
    await sleep(100);
  }
  await sleep(1800);
  const idle = await page.evaluate(() => window.__mt.idleCadence());
  const pre = await page.evaluate(() => ({
    lenis: document.documentElement.classList.contains("lenis"),
    tier: document.documentElement.getAttribute("data-tier"),
    heroLite: document.documentElement.hasAttribute("data-hero-lite"),
    scrollHeight: document.documentElement.scrollHeight,
    vh: innerHeight,
    dpr: devicePixelRatio,
  }));
  if (!pre.lenis) console.warn("  WARN: html.lenis missing at trace start (measuring native scroll?)");

  await page.mouse.move(W / 2, H / 2);
  if (TRACE)
    await browser.startTracing(page, {
      categories: ["disabled-by-default-devtools.timeline.frame", "blink.user_timing", "benchmark"],
    });
  await page.evaluate(() => window.__mt.start());
  const ranges = await page.evaluate(() => window.__mt.ranges);
  // Deterministic pause points: on first reaching each section top (+ one in the hero dive).
  const pausePts = [
    { name: "hero-dive", y: 0.5 * pre.vh },
    ...ranges.filter((r) => r.top > 0).map((r) => ({ name: r.name, y: r.top })),
  ];
  // Playwright/headless Chromium reports wheel deltaY divided by the device
  // scale factor (dispatch 100 at DPR2 -> the page sees deltaY 50), while a real
  // Mac wheel/trackpad reports CSS px. Pre-multiply so Lenis sees STEP CSS px at
  // any DPR (verified via wheelDeltaMean in the output).
  const dispatch = STEP * DPR;
  const rand = mulberry32(SEED);
  let stuck = 0,
    lastY = -1,
    steps = 0;
  const tDrive = Date.now();
  while (steps < 3000 && Date.now() - tDrive < MAX_S * 1000) {
    await page.mouse.wheel(0, dispatch);
    steps++;
    await sleep(16 + Math.floor(rand() * 18));
    const st = await page.evaluate(() => [window.scrollY, document.documentElement.scrollHeight, innerHeight]);
    const [y, sh, vh] = st;
    while (pausePts.length && y >= pausePts[0].y) {
      pausePts.shift();
      await sleep(PAUSE_MS);
    }
    if (y + vh >= sh - 2 && Math.abs(y - lastY) < 1) {
      if (++stuck >= 10) break;
    } else stuck = 0;
    lastY = y;
  }
  await sleep(1200);
  await page.evaluate(() => window.__mt.stop());
  const traceBuf = TRACE ? await browser.stopTracing() : null;
  const raw = await page.evaluate(() => {
    const m = window.__mt;
    return {
      samples: m.samples,
      loaf: m.loaf,
      loafType: m.loafType,
      wheels: m.wheels,
      wheelDeltaMean: m.wheels.length ? m.deltaSum / m.wheels.length : null,
      responses: m.responses,
      attrEvents: m.attrEvents,
      heroCurve: m.heroCurve,
      sections: m.sections,
      ranges: m.ranges,
      t0: m.t0,
      t1: m.t1,
      scrollHeight: document.documentElement.scrollHeight,
    };
  });
  raw.idle = idle;
  const a = analyse(raw, pre.vh);
  if (traceBuf) a.compositor = compositorFrames(traceBuf, raw, pre.vh);
  const inRun = raw.attrEvents.filter((e) => e.t >= raw.t0);
  // Hero dive: how long --hero-to-about takes to travel 0.01 -> 0.99 and how
  // many discrete pixelation buckets (data-hero-px) it shows on the way. The
  // bucket rate is the dive's EFFECTIVE animation fps regardless of frame rate.
  const curve = raw.heroCurve.filter((e) => e.t >= raw.t0).map((e) => ({ t: e.t - raw.t0, y: e.y, v: parseFloat(e.v) }));
  const c0 = curve.find((e) => e.v >= 0.01);
  const c1 = curve.find((e) => e.v >= 0.99);
  const pxEv = inRun.filter((e) => e.attr === "data-hero-px" && e.v !== null);
  const diveMs = c0 && c1 ? c1.t - c0.t : null;
  const heroDive = {
    diveMs: diveMs == null ? null : Math.round(diveMs),
    diveScrollPx: c0 && c1 ? Math.round(c1.y - c0.y) : null,
    varWrites: c0 && c1 ? curve.filter((e) => e.t >= c0.t && e.t <= c1.t).length : null,
    pxSteps: pxEv.length,
    pxStepTimesMs: pxEv.map((e) => Math.round(e.t - raw.t0)),
    // visual update rate while the pixel steps play (first step -> last step)
    pxStepSpanMs: pxEv.length > 1 ? Math.round(pxEv[pxEv.length - 1].t - pxEv[0].t) : null,
    effectiveFps: pxEv.length > 1 ? r1(((pxEv.length - 1) / (pxEv[pxEv.length - 1].t - pxEv[0].t)) * 1000) : null,
  };
  const liteLatch = inRun.find((e) => e.attr === "data-hero-lite" && e.v !== null);
  const result = {
    run: runIdx,
    steps,
    wheelDeltaMean: r1(raw.wheelDeltaMean),
    idleCadenceMs: r1(idle),
    lenisAtStart: pre.lenis,
    tier: pre.tier,
    heroLiteAtStart: pre.heroLite,
    heroLiteLatchedAt: liteLatch ? { tMs: Math.round(liteLatch.t - raw.t0), scrollY: Math.round(liteLatch.y) } : null,
    heroDive,
    heroTimeline: inRun
      .filter((e) => e.attr !== "class")
      .slice(0, 40)
      .map((e) => ({ tMs: Math.round(e.t - raw.t0), y: Math.round(e.y), attr: e.attr, v: e.v })),
    loafType: raw.loafType,
    scrollHeight: raw.scrollHeight,
    ranges: raw.ranges.map((r) => ({ name: r.name, top: Math.round(r.top), bottom: Math.round(r.bottom) })),
    pageErrors: errors,
    ...a,
  };
  await context.close();
  return result;
}

// ── Median across runs ─────────────────────────────────────────────────────
function median(xs) {
  const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : r1((s[m - 1] + s[m]) / 2);
}
function summarise(runs) {
  const keys = ["frames", "p50", "p95", "p99", "max", "gt20", "gt33", "droppedPct", "longN", "longMs", "blockMs"];
  const buckets = {};
  for (const b of Object.keys(runs[0].buckets)) {
    buckets[b] = Object.fromEntries(keys.map((k) => [k, median(runs.map((r) => r.buckets[b][k]))]));
  }
  const sc = (path) => median(runs.map((r) => path.split(".").reduce((o, k) => o?.[k], r.scroll)));
  return {
    buckets,
    scroll: {
      responseLagMs: { p50: sc("responseLagMs.p50"), p95: sc("responseLagMs.p95") },
      trackingLagPx: { p50: sc("trackingLagPx.p50"), p95: sc("trackingLagPx.p95"), max: sc("trackingLagPx.max") },
      settleTailMs: { p50: sc("settleTailMs.p50"), p95: sc("settleTailMs.p95"), max: sc("settleTailMs.max") },
      distancePx: sc("distancePx"),
      durationMs: sc("durationMs"),
    },
  };
}

function printTable(title, sum) {
  const cols = ["frames", "p50", "p95", "p99", "max", "gt20", "gt33", "droppedPct", "longN", "longMs"];
  const hdr = ["bucket", "frames", "p50", "p95", "p99", "max", ">20%", ">33%", "drop%", "LoAF", "LoAFms"];
  const rows = Object.entries(sum.buckets).map(([k, v]) => [k, ...cols.map((c) => (v[c] == null ? "-" : String(v[c])))]);
  const wd = hdr.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i ? c.padStart(wd[i]) : c.padEnd(wd[i]))).join("  ");
  console.log(`\n${title}`);
  console.log(line(hdr));
  for (const r of rows) console.log(line(r));
  const s = sum.scroll;
  console.log(
    `scroll: response p50/p95 ${s.responseLagMs.p50}/${s.responseLagMs.p95}ms | tracking lag p50/p95/max ${s.trackingLagPx.p50}/${s.trackingLagPx.p95}/${s.trackingLagPx.max}px | settle tail p50/p95/max ${s.settleTailMs.p50}/${s.settleTailMs.p95}/${s.settleTailMs.max}ms | ${s.distancePx}px in ${s.durationMs}ms`,
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
async function startPreview() {
  if (process.env.URL) return null;
  const child = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
  const t0 = Date.now();
  while (Date.now() - t0 < 20_000) {
    try {
      if ((await fetch(URL)).ok) return child;
    } catch {}
    await sleep(200);
  }
  child.kill();
  throw new Error("vite preview did not start");
}

const sh = (c) => {
  try {
    return execSync(c, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
};

const preview = await startPreview();
const launch = GPU
  ? { headless: true, channel: "chromium", args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] }
  : { headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] };
const browser = await chromium.launch(launch);
let out;
try {
  // GPU / renderer meta
  let renderer = null,
    featureStatus = null;
  try {
    const p = await browser.newPage();
    renderer = await p.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      return gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : "no-webgl";
    });
    await p.close();
    const cdp = await browser.newBrowserCDPSession();
    const info = await cdp.send("SystemInfo.getInfo");
    featureStatus = info?.gpu?.featureStatus || null;
  } catch {}

  const meta = {
    when: new Date().toISOString(),
    git: sh("git rev-parse --short HEAD"),
    dirtyFiles: Number(sh("git status --porcelain | wc -l") || 0),
    url: URL,
    W,
    H,
    DPR,
    TIER,
    GPU,
    RUNS,
    STEP,
    SEED,
    PAUSE_MS,
    browser: browser.version(),
    renderer,
    featureStatus,
  };
  console.log(`motion-trace ${W}x${H} DPR${DPR} ${GPU ? "GPU" : "swiftshader"} tier=${TIER || "auto"} runs=${RUNS} | ${renderer}`);
  if (featureStatus) console.log(`  gpu: raster=${featureStatus.rasterization} compositing=${featureStatus.gpu_compositing} webgl=${featureStatus.webgl}`);

  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await oneRun(browser, i);
    runs.push(r);
    console.log(
      `  run ${i + 1}: ${r.steps} wheels (deltaY ${r.wheelDeltaMean}), idle ${r.idleCadenceMs}ms, lenis=${r.lenisAtStart}, tier=${r.tier}, heroLite start=${r.heroLiteAtStart} latched=${r.heroLiteLatchedAt ? `@y${r.heroLiteLatchedAt.scrollY}/${r.heroLiteLatchedAt.tMs}ms` : "no"}, overall p95 ${r.buckets.overall.p95}ms${r.pageErrors.length ? `, ${r.pageErrors.length} page errors` : ""}`,
    );
  }
  const summary = summarise(runs);
  summary.heroDive = {
    diveMs: median(runs.map((r) => r.heroDive.diveMs)),
    pxSteps: median(runs.map((r) => r.heroDive.pxSteps)),
    pxStepSpanMs: median(runs.map((r) => r.heroDive.pxStepSpanMs)),
    effectiveFps: median(runs.map((r) => r.heroDive.effectiveFps)),
    heroLiteAtStart: runs.map((r) => r.heroLiteAtStart),
    heroLiteLatched: runs.map((r) => (r.heroLiteLatchedAt ? r.heroLiteLatchedAt.scrollY : null)),
  };
  printTable(`median of ${RUNS} run(s) - frame interval ms`, summary);
  if (runs[0].compositor) {
    summary.compositor = {};
    for (const k of Object.keys(runs[0].compositor))
      summary.compositor[k] = {
        presented: median(runs.map((r) => r.compositor?.[k]?.presented)),
        partial: median(runs.map((r) => r.compositor?.[k]?.partial)),
        dropped: median(runs.map((r) => r.compositor?.[k]?.dropped)),
        droppedPct: median(runs.map((r) => r.compositor?.[k]?.droppedPct)),
      };
    console.log("\ncompositor frames (TRACE): bucket presented/partial/dropped (drop%)");
    for (const [k, v] of Object.entries(summary.compositor))
      console.log(`  ${k.padEnd(14)} ${v.presented}/${v.partial}/${v.dropped} (${v.droppedPct}%)`);
  }
  const hd = summary.heroDive;
  console.log(
    `hero dive: 0.01->0.99 in ${hd.diveMs}ms, ${hd.pxSteps} pixel steps over ${hd.pxStepSpanMs}ms (~${hd.effectiveFps} visual fps) | heroLite at start ${JSON.stringify(hd.heroLiteAtStart)} latched@y ${JSON.stringify(hd.heroLiteLatched)}`,
  );
  out = { meta, summary, runs };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`\nwrote ${OUT}`);
} finally {
  await browser.close();
  preview?.kill();
}
