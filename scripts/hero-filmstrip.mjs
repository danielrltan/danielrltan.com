// scripts/hero-filmstrip.mjs
//
// Captures what the hero -> About transition actually LOOKS like in motion:
// every frame the compositor presents (CDP screencast, real GPU via headless
// ANGLE/Metal) during a scripted wheel scroll from the top of the page to just
// past About's arrival, at two speeds. Writes the raw frames plus a labelled
// contact sheet per speed, and a small JSON with per-frame scrollY and the
// dive/opacity CSS vars so perceived lag (visual vs scroll) can be read off.
// Screencast capture is ack-throttled (~15-30fps), so captureFps is NOT the
// page frame rate; use scripts/motion-trace.mjs (GPU=1) for frame timing.
//
//   URL=http://localhost:5173/ node scripts/hero-filmstrip.mjs
//   OUT=.scratch/film/baseline SPEEDS=slow,fast COLS=6 node scripts/hero-filmstrip.mjs
//
// Env: URL (required unless PORT/preview), OUT (.scratch/film), W (1440), H (900),
//      DPR (1), SPEEDS (slow,fast), COLS (6), SHEET_FRAMES (24), SWIFTSHADER (0|1).

import { chromium } from "playwright";
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const URL = process.env.URL || "http://localhost:5173/";
const OUT = process.env.OUT || ".scratch/film";
const W = Number(process.env.W || 1440);
const H = Number(process.env.H || 900);
const DPR = Number(process.env.DPR || 1);
const SPEEDS = (process.env.SPEEDS || "slow,fast").split(",");
const COLS = Number(process.env.COLS || 6);
const SHEET_FRAMES = Number(process.env.SHEET_FRAMES || 24);

// Wheel profiles: [deltaY per event, ms between events]. "slow" ~ a gentle
// trackpad scroll (~1500px/s), "fast" ~ a decisive flick (~4000px/s). Both stop
// at 1.35 viewports, then hold so the settle / dissolve tail is captured.
const PROFILES = { slow: [40, 16], fast: [120, 16] };

const launch = process.env.SWIFTSHADER === "1"
  ? { headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] }
  : { headless: true, channel: "chromium", args: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu"] };

const browser = await chromium.launch(launch);
const summary = {};
const T0 = Date.now();
for (const speed of SPEEDS) {
  const [step, gap] = PROFILES[speed] || PROFILES.slow;
  const dir = `${OUT}/${speed}`;
  mkdirSync(dir, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  const sep = URL.includes("?") ? "&" : "?";
  await page.goto(`${URL}${sep}tier=standard`, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 300; i++) {
    if (!(await page.evaluate(() => document.documentElement.classList.contains("loading-active")))) break;
    await page.waitForTimeout(100);
  }
  console.log(speed, "loaded", Date.now() - T0, "ms");
  await page.mouse.move(W / 2, H / 2);
  await page.waitForTimeout(2500); // let the hero entrance finish

  const cdp = await ctx.newCDPSession(page);
  const frames = [];
  const t0 = Date.now();
  cdp.on("Page.screencastFrame", async (f) => {
    frames.push({ t: Date.now() - t0, data: f.data, scrollY: f.metadata.scrollOffsetY });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  // Sample page-side state alongside (scroll + the vars the transition reads).
  await page.evaluate(() => {
    const log = (window.__film = []);
    const t0 = performance.now();
    const cs = () => getComputedStyle(document.documentElement);
    const tick = () => {
      // Prefer the hero's debug mirror (spec §5 O8): once the hero stops
      // writing per-frame vars on :root the computed vars go flat. Fall back
      // to the vars for baseline builds that predate the mirror.
      const hm = window.__heroMotion;
      const row = { t: performance.now() - t0, y: window.scrollY };
      if (hm) {
        row.dive = String(hm.dive);
        row.op = String(hm.opacity);
        if (hm.phase) row.phase = hm.phase;
      } else {
        const s = cs();
        row.dive = s.getPropertyValue("--hero-to-about").trim();
        row.op = s.getPropertyValue("--hero-opacity").trim();
      }
      log.push(row);
      if (log.length < 20000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, maxWidth: 960, everyNthFrame: 1 });
  await page.waitForTimeout(300);
  const target = 1.35 * H;
  // Closed loop: keep wheeling at the profile's rhythm until the page has
  // actually travelled `target`, not until we've SENT `target`. Headless
  // Chromium at DPR2 delivers only about half of each wheel delta, so an
  // open-loop count left the DPR2 run frozen mid-dive (maxY 660 of 1215).
  // "Travelled" is Lenis's target (smoothing would make window.scrollY lag
  // and overshoot) via the window.__scroll debug handle; builds without it
  // (main baseline) fall back to scrollY once the smoothing has settled.
  const scrollGoal = () =>
    page.evaluate(() => {
      const l = window.__scroll?.getLenis?.();
      return l && Number.isFinite(l.targetScroll) ? { y: l.targetScroll, exact: true } : { y: window.scrollY, exact: false };
    });
  // Goal = what the open-loop phase travels at DPR1 (whole steps past target:
  // 1320 fast / 1240 slow at H=900), so DPR1 and DPR2 films end at the same Y.
  const goal = Math.ceil(target / step) * step;
  let sent = 0;
  const wheelUntil = Date.now() + 15_000;
  while (sent < target) {
    await page.mouse.wheel(0, step);
    sent += step;
    await page.waitForTimeout(gap);
  }
  let first = await scrollGoal();
  if (!first.exact) {
    // Let the smoothing settle before trusting scrollY.
    for (let i = 0, last = -1; i < 20 && first.y !== last; i++) {
      last = first.y;
      await page.waitForTimeout(100);
      first = await scrollGoal();
    }
  }
  // With Lenis's target, top up any shortfall. Without it, only top up a
  // clear one (the DPR2 halving): a settled scrollY can sit wherever a
  // baseline hero settle put it. Once topping up, go all the way to `goal`.
  const short = first.exact ? first.y < goal - 1 : first.y < 0.6 * target;
  while (short && Date.now() < wheelUntil) {
    await page.mouse.wheel(0, step);
    sent += step;
    await page.waitForTimeout(gap);
    const g = await scrollGoal();
    if (g.y >= goal - 1) break;
  }
  const reached = await scrollGoal();
  console.log(speed, "wheeled", Date.now() - T0, "ms,", frames.length, "frames so far; sent", sent, "goal", Math.round(reached.y), "of", goal);
  await page.waitForTimeout(2200); // settle / dissolve tail
  await cdp.send("Page.stopScreencast");
  const pageLog = await page.evaluate(() => window.__film);
  await ctx.close();

  // Raw frames.
  frames.forEach((f, i) => writeFileSync(`${dir}/f${String(i).padStart(4, "0")}.jpg`, Buffer.from(f.data, "base64")));
  // Contact sheet: SHEET_FRAMES evenly spaced frames across the motion window
  // (first frame where scroll moved -> last frame where anything changed).
  const moving = frames.findIndex((f) => f.scrollY > 2);
  const start = Math.max(0, moving - 1);
  const pick = [];
  const n = Math.min(SHEET_FRAMES, frames.length - start);
  for (let k = 0; k < n; k++) pick.push(start + Math.round((k * (frames.length - 1 - start)) / Math.max(1, n - 1)));
  const tw = 320;
  const th = Math.round((tw * H) / W);
  const rows = Math.ceil(pick.length / COLS);
  const tiles = await Promise.all(
    pick.map(async (fi, k) => {
      const f = frames[fi];
      const img = await sharp(Buffer.from(f.data, "base64")).resize(tw, th).toBuffer();
      const label = Buffer.from(
        `<svg width="${tw}" height="18"><rect width="${tw}" height="18" fill="black" opacity="0.7"/><text x="4" y="13" font-family="monospace" font-size="12" fill="white">#${fi} t=${f.t}ms y=${Math.round(f.scrollY)}</text></svg>`,
      );
      return { input: await sharp(img).composite([{ input: label, top: 0, left: 0 }]).toBuffer(), top: Math.floor(k / COLS) * th, left: (k % COLS) * tw };
    }),
  );
  await sharp({ create: { width: COLS * tw, height: rows * th, channels: 3, background: "#222" } })
    .composite(tiles)
    .png()
    .toFile(`${dir}/sheet.png`);
  writeFileSync(`${dir}/log.json`, JSON.stringify({ frames: frames.map(({ t, scrollY }) => ({ t, scrollY })), page: pageLog }));

  const dur = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
  summary[speed] = { frames: frames.length, durationMs: dur, captureFps: dur ? +((frames.length * 1000) / dur).toFixed(1) : 0, sheet: `${dir}/sheet.png` };
  console.log(speed, summary[speed]);
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));
await browser.close();
