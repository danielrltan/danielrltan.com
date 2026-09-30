// scripts/smoke-test.mjs
//
// End-to-end smoke test for the built site. Drives a headless Chromium
// (Playwright, already a devDependency) against a running server and checks
// the things a visitor actually depends on: the boot loader lifts, the DOM
// outline is sane, every section resolves, the nav menu opens/jumps/closes,
// the Work accordion and the Projects detail work, the 3D sections mount
// their canvases on approach, every image/asset resolves, and the analytics
// hooks fire. Runs the same flow at desktop and phone widths.
//
//   npm run build && npm run test:smoke          # against vite preview (auto-started)
//   URL=http://localhost:5173/ node scripts/smoke-test.mjs   # against a dev server
//   SHOTS=.scratch/shots node scripts/smoke-test.mjs          # also save screenshots
//
// Exit code is non-zero on any failure. Headless Chromium has no real GPU, so
// the capability tier resolves to "low" (static hero ring); pass
// TIER=standard to force the WebGL hero path as well.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const PORT = process.env.PORT || 5310;
const URL = process.env.URL || `http://localhost:${PORT}/`;
const SHOTS = process.env.SHOTS || "";
const TIER = process.env.TIER || "";
const LOADER_TIMEOUT_MS = 45_000;

const SECTIONS = [
  "Hero",
  "About",
  "Projects",
  "Work",
  "Play",
  "Honours",
  "Recents",
  "Contact",
];

let failures = 0;
let passes = 0;
function check(cond, msg) {
  if (cond) {
    passes++;
    console.log(`  ok   ${msg}`);
  } else {
    failures++;
    console.log(`  FAIL ${msg}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, { timeout = 10_000, step = 100 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn)) return true;
    await sleep(step);
  }
  return false;
}

async function scrollTo(page, y) {
  await page.evaluate((yy) => window.scrollTo(0, yy), y);
  await sleep(600);
}

async function scrollToSelector(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top);
  }, selector);
  await sleep(900);
}

async function settleScroll(page, { timeout = 6000 } = {}) {
  const t0 = Date.now();
  let last = -1;
  while (Date.now() - t0 < timeout) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) return;
    last = y;
    await sleep(400);
  }
}

async function dialLabel(page) {
  return page.evaluate(() =>
    (document.querySelector(".snc-dial-label")?.textContent || "").trim(),
  );
}

async function runScenario(browser, name, { viewport, mobile, query }) {
  console.log(`\n== ${name} (${viewport.width}x${viewport.height}) ==`);
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on("pageerror", (e) => pageErrors.push((e.stack || e.message).split("\n").slice(0, 4).join(" <- ")));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    consoleErrors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });
  // Stub Umami so we can assert the tracking calls without a network.
  await page.addInitScript(() => {
    window.__events = [];
    window.umami = { track: (e, d) => window.__events.push([e, d]) };
  });

  const url = query ? `${URL}?${query}` : URL;
  const t0 = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // 1. Boot loader lifts (html.loading-active removed) and the static
  //    boot screen + crawler fallback are gone.
  const lifted = await waitFor(
    page,
    () => !document.documentElement.classList.contains("loading-active"),
    { timeout: LOADER_TIMEOUT_MS },
  );
  check(lifted, `loader lifted (${Date.now() - t0}ms)`);
  await sleep(1500);
  const outline = await page.evaluate(() => ({
    boot: !!document.getElementById("boot-screen"),
    seo: !!document.getElementById("seo-fallback"),
    mains: document.querySelectorAll("main").length,
    h1s: document.querySelectorAll("h1").length,
    tier: document.documentElement.getAttribute("data-tier"),
    canvases: document.querySelectorAll("canvas").length,
  }));
  check(!outline.boot, "static #boot-screen removed");
  check(!outline.seo, "#seo-fallback removed after mount");
  check(outline.mains === 1, `exactly one <main> (${outline.mains})`);
  check(outline.h1s === 1, `exactly one <h1> (${outline.h1s})`);
  console.log(`  info tier=${outline.tier} canvases=${outline.canvases}`);
  if (TIER) check(outline.tier === TIER, `tier forced to ${TIER}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-00-hero.png` });

  // 2. Every registry section resolves to a DOM element (mirrors
  //    sectionRegistry.findSectionElements without importing app code).
  const sectionEls = await page.evaluate(() => {
    const sel = {
      Hero: ".portfolio-section--hero",
      About: ".portfolio-about",
      Projects: ".portfolio-mac",
      Work: ".portfolio-work",
      Play: ".other-pin-wrap",
      Honours: ".portfolio-bp",
      Recents: ".portfolio-photos",
      Contact: ".keypad-section",
    };
    return Object.fromEntries(
      Object.entries(sel).map(([k, s]) => [k, !!document.querySelector(s)]),
    );
  });
  for (const s of SECTIONS) check(sectionEls[s], `section element: ${s}`);

  // 3. Scroll through the page; the dial must visit every section label in
  //    order, and the 3D sections must mount their canvases on approach.
  const seen = new Set();
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  const vh = viewport.height;
  let shot = 1;
  for (let y = 0; y <= docH; y += Math.round(vh * 0.6)) {
    await scrollTo(page, y);
    seen.add(await dialLabel(page));
    if (SHOTS && y % Math.round(vh * 1.8) < Math.round(vh * 0.6)) {
      await page.screenshot({
        path: `${SHOTS}/${name}-${String(shot++).padStart(2, "0")}-y${y}.png`,
      });
    }
  }
  for (const s of SECTIONS.slice(1)) check(seen.has(s), `dial reached: ${s}`);

  // The heavy scenes mount on approach and RELEASE their WebGL context once
  // scrolled away, so each one is checked while its section is in view.
  await scrollToSelector(page, ".portfolio-mac");
  await sleep(1500);
  const macIn = await page.evaluate(() => ({
    canvas: !!document.querySelector(".portfolio-mac canvas"),
    accordion: document.querySelectorAll(".portfolio-mac .mac-acc-head").length,
  }));
  if (mobile) check(macIn.accordion >= 4 || macIn.canvas, `Projects mobile accordion rendered (${macIn.accordion} items)`);
  else check(macIn.canvas, "Projects canvas mounted in view");
  await scrollToSelector(page, ".other-pin-wrap");
  await sleep(1500);
  check(
    await page.evaluate(() => !!document.querySelector(".other-pin-wrap canvas")),
    "Play canvas mounted in view",
  );
  await scrollToSelector(page, ".keypad-section");
  await sleep(1500);
  if (!mobile) {
    check(
      await page.evaluate(() => !!document.querySelector(".keypad-section canvas")),
      "Contact keypad canvas mounted in view",
    );
  } else {
    const chips = await page.evaluate(
      () => document.querySelectorAll(".keypad-contact-chip").length,
    );
    check(chips >= 4, `mobile contact chips rendered (${chips})`);
  }

  // 3b. Honours tiles: every tile must stay revealed after the section has
  //     been scrolled through (guards the reveal-observer state update).
  await scrollToSelector(page, ".portfolio-bp");
  for (let step = 0; step < 6; step++) {
    await page.evaluate((dy) => window.scrollBy(0, dy), Math.round(vh * 0.45));
    await sleep(350);
  }
  await sleep(800);
  const tiles = await page.evaluate(() => {
    const all = [...document.querySelectorAll(".portfolio-bp .bp-tile")];
    return {
      total: all.length,
      revealed: all.filter((t) => t.classList.contains("is-revealed")).length,
      visible: all.filter((t) => parseFloat(getComputedStyle(t).opacity) > 0.99).length,
    };
  });
  if (mobile) {
    // Phones skip the reveal observer; CSS renders every tile in place.
    check(tiles.total > 0 && tiles.visible === tiles.total, `all Honours tiles visible (${tiles.visible}/${tiles.total})`);
  } else {
    check(
      tiles.total > 0 && tiles.revealed === tiles.total,
      `all Honours tiles revealed (${tiles.revealed}/${tiles.total})`,
    );
  }

  // 4. Work accordion: expanding a collapsed role toggles aria-expanded.
  await scrollToSelector(page, ".portfolio-work");
  const workToggle = await page.evaluate(() => {
    const btns = [...document.querySelectorAll(".portfolio-work button[aria-expanded]")];
    const collapsed = btns.find((b) => b.getAttribute("aria-expanded") === "false");
    if (!collapsed) return { found: false };
    collapsed.click();
    return { found: true, id: collapsed.getAttribute("aria-controls") };
  });
  check(workToggle.found, "work accordion has a collapsed role");
  if (workToggle.found) {
    const isOpen = await waitFor(
      page,
      new Function(
        `const b = document.querySelector('[aria-controls="${workToggle.id}"]'); return b?.getAttribute("aria-expanded") === "true";`,
      ),
      { timeout: 3000 },
    );
    check(isOpen, "work role expands on click");
  }

  // 5. Projects detail: desktop opens via the sr-only "Open … detail" nav and
  //    closes via "Close project"; phones use the inline accordion.
  await scrollToSelector(page, ".portfolio-mac");
  await sleep(800);
  if (mobile) {
    const acc = await page.evaluate(() => {
      const head = [...document.querySelectorAll(".portfolio-mac .mac-acc-head[aria-expanded]")]
        .find((h) => h.getAttribute("aria-expanded") === "false");
      if (!head) return null;
      head.click();
      return head.getAttribute("aria-controls");
    });
    check(!!acc, "mobile project accordion present");
    if (acc) {
      const open = await waitFor(
        page,
        new Function(`return document.querySelector('[aria-controls="${acc}"]')?.getAttribute("aria-expanded") === "true";`),
        { timeout: 3000 },
      );
      check(open, "mobile project accordion expands");
    }
  } else {
    const openBtn = page.getByRole("button", { name: /Open .* detail/ }).first();
    const hasOpen = (await openBtn.count()) > 0;
    check(hasOpen, "project 'Open … detail' control present");
    if (hasOpen) {
      await openBtn.evaluate((b) => b.click());
      const opened = await waitFor(
        page,
        () => (window.__events || []).some((e) => e[0] === "project_open"),
        { timeout: 4000 },
      );
      check(opened, "project detail opens");
      const closeBtn = page.getByRole("button", { name: "Close project" }).first();
      if ((await closeBtn.count()) > 0) await closeBtn.evaluate((b) => b.click());
      else await page.keyboard.press("Escape");
      const closed = await waitFor(
        page,
        () => (window.__events || []).some((e) => e[0] === "project_close"),
        { timeout: 4000 },
      );
      check(closed, "project detail closes");
    }
  }

  // 6. Nav spill menu: open (hotkey on desktop, dial tap on mobile), jump to
  //    Contact, close.
  await scrollToSelector(page, ".portfolio-work");
  if (mobile) {
    await page.locator(".snc-dial").first().evaluate((el) => el.click());
  } else {
    await page.keyboard.press("m");
  }
  const menuOpen = await waitFor(
    page,
    () => document.querySelector('.navx-spill-root[data-open="true"]') != null,
    { timeout: 6000 },
  );
  check(menuOpen, "nav menu opens");
  if (menuOpen) {
    await sleep(900);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-98-menu.png` });
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll(".navx-spill-label")].map((e) => e.textContent.trim()),
    );
    check(
      SECTIONS.every((s) => labels.includes(s)),
      `menu lists all sections (${labels.join(", ")})`,
    );
    await page
      .locator(".navx-spill-root .navx-spill-label", { hasText: "Contact" })
      .first()
      .evaluate((b) => b.click());
    const jumped = await waitFor(page, () => {
      const closed = document.querySelector(".navx-spill-root") == null;
      const label = (document.querySelector(".snc-dial-label")?.textContent || "").trim();
      const unlocked = document.documentElement.style.overflow !== "hidden";
      return closed && unlocked && label === "Contact";
    }, { timeout: 8000 });
    check(jumped, "menu jump lands on Contact, closes, and unlocks scroll");
  }

  // 7. Jump-to-top control returns to the hero. Let the Lenis jump settle
  //    first, or its tween overrides the native smooth scroll.
  await settleScroll(page);
  const jtt = page.getByRole("button", { name: "Jump to top" }).first();
  if ((await jtt.count()) > 0) {
    await jtt.evaluate((b) => b.click());
    const atTop = await waitFor(page, () => window.scrollY < 5, { timeout: 8000 });
    check(atTop, "jump-to-top returns to y=0");
  } else {
    check(false, "jump-to-top control present");
  }

  // 8. Assets: every image and the resume + photo manifest resolve.
  const imgs = await page.evaluate(() =>
    [...document.images].map((i) => ({ src: i.currentSrc || i.src, ok: i.complete && i.naturalWidth > 0 })),
  );
  const brokenImgs = imgs.filter((i) => !i.ok && i.src && !i.src.startsWith("data:"));
  check(brokenImgs.length === 0, `all ${imgs.length} <img> loaded${brokenImgs.length ? ": " + brokenImgs.map((i) => i.src).join(", ") : ""}`);
  for (const path of ["resume/Daniel_Tan_Resume.pdf", "photos/manifest.json", "signature.json", "site.webmanifest", "sitemap.xml", "robots.txt"]) {
    const r = await page.request.get(new globalThis.URL(path, URL).toString());
    check(r.ok(), `asset 200: /${path}`);
  }
  const manifest = await (await page.request.get(new globalThis.URL("photos/manifest.json", URL).toString())).json();
  let photoFails = 0;
  for (const p of manifest) {
    const r = await page.request.head(new globalThis.URL(p.src, URL).toString());
    if (!r.ok()) photoFails++;
  }
  check(photoFails === 0, `all ${manifest.length} manifest photos resolve`);

  // 9. Analytics wiring.
  const events = await page.evaluate(() => (window.__events || []).map((e) => e[0]));
  for (const ev of ["section_view", "nav_open", "nav_jump", "work_expand", "jump_to_top"]) {
    check(events.includes(ev), `analytics event fired: ${ev}`);
  }

  // 10. No runtime errors, no failed requests.
  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ": " + pageErrors.join(" | ") : ""}`);
  const realConsoleErrors = consoleErrors.filter((t) => !/GL Driver Message|WebGL-/.test(t));
  check(realConsoleErrors.length === 0, `no console errors${realConsoleErrors.length ? ": " + realConsoleErrors.slice(0, 5).join(" | ") : ""}`);
  check(failedRequests.length === 0, `no failed requests${failedRequests.length ? ": " + failedRequests.join(", ") : ""}`);

  await context.close();
}

async function startPreview() {
  if (process.env.URL) return null;
  const child = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 20_000) {
    try {
      const r = await fetch(URL);
      if (r.ok) return child;
    } catch {}
    await sleep(200);
  }
  child.kill();
  throw new Error("vite preview did not start");
}

const preview = await startPreview();
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
try {
  const q = TIER ? `tier=${TIER}` : "";
  await runScenario(browser, "desktop", { viewport: { width: 1440, height: 900 }, mobile: false, query: q });
  await runScenario(browser, "mobile", { viewport: { width: 390, height: 844 }, mobile: true, query: q });
} finally {
  await browser.close();
  preview?.kill();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
