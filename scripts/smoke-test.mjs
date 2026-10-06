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

// Mirrors sectionRegistry selectors without importing app code.
const SECTION_SEL = {
  Hero: ".portfolio-section--hero",
  About: ".portfolio-about",
  Projects: ".portfolio-mac",
  Work: ".portfolio-work",
  Play: ".other-pin-wrap",
  Honours: ".portfolio-bp",
  Recents: ".portfolio-photos",
  Contact: ".keypad-section",
};

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

// Resolve after `n` rendered frames (bounded, so a stalled compositor can't
// hang the run).
async function waitFrames(page, n, timeout = 5000) {
  await page.evaluate(
    ({ n, timeout }) =>
      new Promise((resolve) => {
        let k = 0;
        const t = setTimeout(resolve, timeout);
        const f = () => (++k >= n ? (clearTimeout(t), resolve()) : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    { n, timeout },
  );
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

// The dial's active section as both the visible label and the button's
// aria-label ("Open section menu. Current: 06 Recents"). The aria-label is
// written on the React commit; the visible label only after the drum spring
// crosses its swap point, i.e. several more rAF frames. On a frame-starved
// box (swiftshader under load: 0-5 rAF/s) the commit can land well before
// the spring, so the sweep counts a section as reached on either. The menu
// jump check below still asserts the VISIBLE label lands.
function dialStateInPage() {
  const label = (document.querySelector(".snc-dial-label")?.textContent || "").trim();
  const aria = document.querySelector(".snc-dial")?.getAttribute("aria-label") || "";
  const m = /Current:\s*\d+\s+(.+)$/.exec(aria);
  return { label, aria: m ? m[1].trim() : "" };
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
  const sectionEls = await page.evaluate((sel) =>
    Object.fromEntries(
      Object.entries(sel).map(([k, s]) => [k, !!document.querySelector(s)]),
    ), SECTION_SEL);
  for (const s of SECTIONS) check(sectionEls[s], `section element: ${s}`);

  // 3. Scroll through the page; the dial must visit every section label in
  //    order, and the 3D sections must mount their canvases on approach.
  const seen = new Set();
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  const vh = viewport.height;
  const vw = viewport.width;
  let shot = 1;
  for (let y = 0; y <= docH; y += Math.round(vh * 0.6)) {
    await scrollTo(page, y);
    const st = await page.evaluate(dialStateInPage);
    seen.add(st.label);
    seen.add(st.aria);
    if (SHOTS && y % Math.round(vh * 1.8) < Math.round(vh * 0.6)) {
      await page.screenshot({
        path: `${SHOTS}/${name}-${String(shot++).padStart(2, "0")}-y${y}.png`,
      });
    }
  }
  // The sweep samples each stop once after a fixed beat, so a section whose
  // band is only a few stops long (pins were shortened in the motion overhaul)
  // can be missed when the box is slow to produce frames: the dial label only
  // changes on rAF (ScrollTrigger update -> React commit -> drum spring crosses
  // LABEL_SWAP_AT). For any section the sweep did not see, park just past its
  // activation line (section top at 45% of the viewport, measured on the pin
  // spacer when it has one) and WAIT for the label instead of sampling once.
  for (const s of SECTIONS.slice(1)) {
    if (seen.has(s)) continue;
    const y = await page.evaluate(({ sel, vhh }) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const box = el.closest(".pin-spacer") || el;
      return Math.round(box.getBoundingClientRect().top + window.scrollY - vhh * 0.45 + vhh * 0.25);
    }, { sel: SECTION_SEL[s], vhh: vh });
    if (y == null) continue;
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    const want = JSON.stringify(s);
    if (await waitFor(page, new Function(`const st = (${dialStateInPage})(); return st.label === ${want} || st.aria === ${want};`), { timeout: 15_000 })) {
      seen.add(s);
      console.log(`  info dial reached ${s} on the targeted pass (y=${y})`);
    }
  }
  for (const s of SECTIONS.slice(1)) check(seen.has(s), `dial reached: ${s}`);

  // 3a. Seam layout (overhaul 2026-10-06, src/seams/stack.css): no section
  //     pins any more; holds are sticky stages inside tall in-flow roots.
  //     Checked after the sweep so every lazy section has mounted.
  if (!mobile) {
    const spacers = await page.evaluate(() => document.querySelectorAll(".pin-spacer").length);
    check(spacers === 0, `no GSAP pin-spacers on the page (${spacers})`);
    // About sits still under the rising Projects sheet: its stage's screen
    // top is the same at About's doc top (1.0vh) and half a screen later.
    const aboutTop = await page.evaluate(() => {
      const el = document.querySelector(".portfolio-about");
      return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
    });
    const aboutAt = async (y) => {
      await page.evaluate((yy) => window.scrollTo(0, yy), y);
      await settleScroll(page);
      await waitFrames(page, 2);
      return page.evaluate(() => ({
        y: Math.round(window.scrollY),
        top: document.querySelector(".portfolio-about .about-stage")?.getBoundingClientRect().top ?? null,
      }));
    };
    const a0 = aboutTop == null ? null : await aboutAt(aboutTop);
    const a1 = aboutTop == null ? null : await aboutAt(aboutTop + Math.round(vh * 0.5));
    check(
      !!a0 && !!a1 && a0.top != null && a1.top != null && a1.y - a0.y >= vh * 0.4 && Math.abs(a1.top - a0.top) <= 1,
      `About holds still under the Projects sheet (${a0 && a1 ? `y ${a0.y} -> ${a1.y}: top ${a0.top?.toFixed(1)} -> ${a1.top?.toFixed(1)}` : "no About"})`,
    );
  }

  // The heavy scenes mount on approach and RELEASE their WebGL context once
  // scrolled away, so each one is checked while its section is in view.
  // Desktop lands on Projects the way the menu does (jumpToSection -> the
  // pin's jump progress) when the debug handle exists: an element-top scroll
  // from below now lands at mac-pin p=1, the exit beat, where the Mac is
  // leaving. Older builds without window.__scroll fall back to element top.
  // `immediate` is a synchronous uncovered cut, so no tween is left running
  // to fight the next scroll on a frame-starved box.
  const macJumped = !mobile && (await page.evaluate(async () => {
    const j = window.__scroll?.jumpToSection;
    if (!j) return false;
    await j("Projects", { immediate: true });
    return true;
  }));
  if (macJumped) {
    await sleep(300);
    console.log(`  info Projects landing via jumpToSection: y=${await page.evaluate(() => Math.round(window.scrollY))}`);
  } else await scrollToSelector(page, ".portfolio-mac");
  // Canvases mount on approach (IntersectionObserver -> lazy chunk -> WebGL
  // context): wait for it rather than assuming a fixed beat is enough.
  if (!mobile) await waitFor(page, () => !!document.querySelector(".portfolio-mac canvas"), { timeout: 10_000 });
  else await sleep(1500);
  const macIn = await page.evaluate(() => ({
    canvas: !!document.querySelector(".portfolio-mac canvas"),
    accordion: document.querySelectorAll(".portfolio-mac .mac-acc-head").length,
  }));
  if (mobile) check(macIn.accordion >= 4 || macIn.canvas, `Projects mobile accordion rendered (${macIn.accordion} items)`);
  else check(macIn.canvas, "Projects canvas mounted in view");
  await scrollToSelector(page, ".other-pin-wrap");
  check(
    await waitFor(page, () => !!document.querySelector(".other-pin-wrap canvas"), { timeout: 10_000 }),
    "Play canvas mounted in view",
  );
  await scrollToSelector(page, ".keypad-section");
  if (mobile) await sleep(1500);
  if (!mobile) {
    check(
      await waitFor(page, () => !!document.querySelector(".keypad-section canvas"), { timeout: 10_000 }),
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
    // IntersectionObserver entries are only computed on rendering frames: on
    // a frame-starved box a fixed 350 ms can pass with no frame, the tiles
    // scroll past unobserved and never latch. Let a couple of frames land.
    if (!mobile) await waitFrames(page, 2); // phones skip the observer
  }
  if (!mobile) {
    await waitFor(page, () => {
      const all = [...document.querySelectorAll(".portfolio-bp .bp-tile")];
      // Desktop has no tiles now (the podium); phones keep the grid.
      return all.length === 0 || all.every((t) => t.classList.contains("is-revealed"));
    }, { timeout: 8000 });
  } else await sleep(800);
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
    // Desktop: the 3D podium replaces the tile grid. It mounts, plays its
    // entrance once on screen, then shows the headliner's card; ←/→ on the
    // focused canvas steps the card; all 12 entries stay in the SR list.
    // The podium builds from the scroll (seam 5) and is complete at the
    // section's doc top (p = 1), so land there, not on the podium element.
    await scrollToSelector(page, ".portfolio-bp");
    const podium = await waitFor(page, () => !!document.querySelector(".bp-podium-canvas"), { timeout: 10_000 });
    check(podium, "Honours podium canvas mounted");
    const carded = await waitFor(
      page,
      () => !document.querySelector(".bp-podium-card")?.classList.contains("is-hidden") &&
        (document.querySelector(".bp-podium-title")?.textContent || "").length > 0,
      { timeout: 15_000, step: 300 },
    );
    check(carded, "Honours podium shows the headline card after its entrance");
    if (carded) {
      const before = await page.evaluate(() => document.querySelector(".bp-podium-title")?.textContent);
      await page.focus(".bp-podium-canvas");
      await page.keyboard.press("ArrowRight");
      await page.evaluate((b) => { window.__bpBefore = b; }, before);
      const stepped = await waitFor(page, () => document.querySelector(".bp-podium-title")?.textContent !== window.__bpBefore, { timeout: 3000 });
      check(stepped, "Honours podium: arrow key steps to the next honour");
      await page.evaluate(() => document.activeElement?.blur());
    }
    const srItems = await page.evaluate(() => document.querySelectorAll(".portfolio-bp ul.sr-only li").length);
    check(srItems === 12, `Honours list kept for screen readers (${srItems}/12)`);
  }

  // 3c. Recents photo plane: the canvas draws photos inside the hold, a
  //     click / tap opens the focus view (scroll locked), Escape / the
  //     backdrop closes it and unlocks, and the plane never traps page scroll.
  {
    const top = await page.evaluate(() => {
      const el = document.querySelector(".portfolio-photos");
      return el ? el.getBoundingClientRect().top + window.scrollY : -1;
    });
    check(top >= 0, "Recents section present");
    await scrollTo(page, top + Math.round(vh * 0.6));
    await settleScroll(page);
    const mounted = await waitFor(page, () => !!document.querySelector(".portfolio-photos .recents-plane canvas"), { timeout: 10_000 });
    check(mounted, "Recents plane canvas mounted in view");
    // Non-background pixels = photos drawn (decode is async; give frames time).
    const drawn = await waitFor(page, () => {
      const c = document.querySelector(".recents-plane canvas");
      if (!c || !c.width) return false;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4 * 211) if (Math.abs(d[i] - 238) + Math.abs(d[i + 1] - 240) + Math.abs(d[i + 2] - 243) > 40) n++;
      return n > 200;
    }, { timeout: 15_000, step: 300 });
    check(drawn, "Recents plane draws photos");
    // Find a photo: on desktop the hover sets body cursor:pointer; on a phone
    // just tap a grid of points until the focus view opens.
    const pts = [];
    for (const fy of [0.5, 0.62, 0.42, 0.72]) for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) pts.push([Math.round(vw * fx), Math.round(vh * fy)]);
    let opened = false;
    for (const [x, y] of pts) {
      if (mobile) await page.touchscreen.tap(x, y);
      else {
        await page.mouse.move(x, y);
        await sleep(200);
        if (!(await page.evaluate(() => document.body.style.cursor === "pointer"))) continue;
        await page.mouse.click(x, y);
      }
      opened = await waitFor(page, () => document.querySelector(".recents-focus")?.classList.contains("is-open") === true, { timeout: 1500 });
      if (opened) break;
    }
    check(opened, "Recents photo opens the focus view");
    if (opened) {
      const locked = await page.evaluate(() => document.documentElement.style.overflow === "hidden");
      check(locked, "Recents focus view locks scroll");
      if (mobile) await page.touchscreen.tap(8, Math.round(vh * 0.97));
      else await page.keyboard.press("Escape");
      const closed = await waitFor(page, () =>
        !document.querySelector(".recents-focus")?.classList.contains("is-open") &&
        document.documentElement.style.overflow !== "hidden", { timeout: 3000 });
      check(closed, `Recents focus view closes (${mobile ? "backdrop tap" : "Escape"}) and unlocks scroll`);
    }
    // Not a scroll trap: scrolling over the plane still moves the page.
    const y0 = await page.evaluate(() => window.scrollY);
    if (mobile) await page.evaluate((dy) => window.scrollBy(0, dy), vh);
    else {
      await page.mouse.move(Math.round(vw / 2), Math.round(vh / 2));
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 300); await sleep(120); }
    }
    await settleScroll(page);
    const y1 = await page.evaluate(() => window.scrollY);
    check(y1 > y0 + 100, `page scrolls over the Recents plane (+${Math.round(y1 - y0)}px)`);

    // The hold's release leaves no strip: softHold's release bump is fully
    // spent 0.15vh past the hold (no translate left on the stage, which then
    // rides the section 1:1: its top at -0.15vh), unlike the old softRelease's
    // permanent L/2 page-tone strip. The photos hold applies at every width.
    const hold = await page.evaluate(() => {
      const st = window.__scroll?.ScrollTrigger?.getById("photos-pin");
      return st ? st.end - st.start : null;
    });
    const relY = Math.round(top + (hold ?? vh * 0.8) + vh * 0.15);
    await scrollTo(page, relY);
    await settleScroll(page);
    const clean = await waitFor(page, () => {
      const s = document.querySelector(".portfolio-photos .photos-stage");
      if (!s) return false;
      const t = s.style.translate;
      // Flush with the section's bottom edge = no strip below the stage.
      const sec = s.closest(".portfolio-photos").getBoundingClientRect();
      return (t === "" || t === "none" || t === "0px") && Math.abs(s.getBoundingClientRect().bottom - sec.bottom) <= 2;
    }, { timeout: 4000 });
    const rel = await page.evaluate(() => {
      const s = document.querySelector(".portfolio-photos .photos-stage");
      if (!s) return null;
      const sec = s.closest(".portfolio-photos").getBoundingClientRect();
      return { t: s.style.translate, top: Math.round(s.getBoundingClientRect().top), gap: Math.round(sec.bottom - s.getBoundingClientRect().bottom), y: Math.round(window.scrollY) };
    });
    check(
      clean && rel && rel.y >= relY - 2,
      `Recents release leaves no strip (hold ${hold == null ? "?" : Math.round(hold)}px, y ${rel?.y}/${relY}, stage top ${rel?.top}, gap ${rel?.gap}px, translate '${rel?.t ?? ""}')`,
    );
  }

  // 4. Work accordion. Desktop (owner gate G2, seam overhaul 2026-10-06):
  //    every role starts open and each header toggles its own row, so the
  //    check is all open, then one row collapses and re-expands on click (the
  //    re-expand is what fires work_expand). Phones keep the single-open stack:
  //    expanding a collapsed role toggles aria-expanded.
  await scrollToSelector(page, ".portfolio-work");
  const workToggle = mobile
    ? await page.evaluate(() => {
        const btns = [...document.querySelectorAll(".portfolio-work button[aria-expanded]")];
        const collapsed = btns.find((b) => b.getAttribute("aria-expanded") === "false");
        if (!collapsed) return { found: false };
        collapsed.click();
        return { found: true, id: collapsed.getAttribute("aria-controls") };
      })
    : { found: false };
  if (!mobile) {
    const roles = await page.evaluate(() => {
      const btns = [...document.querySelectorAll(".portfolio-work button[aria-expanded]")];
      return {
        n: btns.length,
        open: btns.filter((b) => b.getAttribute("aria-expanded") === "true").length,
        multi: !!document.querySelector(".portfolio-work.is-multi"),
        id: btns[0]?.getAttribute("aria-controls") || null,
      };
    });
    check(roles.n > 0 && roles.open === roles.n && roles.multi, `work roles all open on desktop (${roles.open}/${roles.n}${roles.multi ? "" : ", not multi"})`);
    let cycled = false;
    let expandsBefore = 0;
    let expandsAfter = 0;
    if (roles.id) {
      const sel = `.portfolio-work [aria-controls="${roles.id}"]`;
      const state = (want) => new Function(`return document.querySelector(${JSON.stringify(sel)})?.getAttribute("aria-expanded") === ${JSON.stringify(want)};`);
      await page.evaluate((s) => document.querySelector(s)?.click(), sel);
      const collapsed = await waitFor(page, state("false"), { timeout: 3000 });
      if (collapsed) {
        // The header's onClick reads `open` from the last render, so the
        // second click goes in only after the collapse has committed.
        await waitFrames(page, 2);
        expandsBefore = await page.evaluate(() => (window.__events || []).filter((e) => e[0] === "work_expand").length);
        await page.evaluate((s) => document.querySelector(s)?.click(), sel);
        cycled = await waitFor(page, state("true"), { timeout: 3000 });
        expandsAfter = await page.evaluate(() => (window.__events || []).filter((e) => e[0] === "work_expand").length);
      }
    }
    check(cycled && expandsAfter > expandsBefore, `work role collapses then re-expands on click (work_expand ${expandsBefore} -> ${expandsAfter})`);
  }
  if (mobile) check(workToggle.found, "work accordion has a collapsed role");
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
    // The labels are drei <Html> nodes inside the menu's R3F canvas, so they
    // exist only once the canvas has created its renderer and committed the
    // scene. data-open now flips in the mount effect (motion overhaul W7: no
    // rAF hop), i.e. before the canvas is up, so wait for the labels.
    await waitFor(
      page,
      new Function(`return document.querySelectorAll(".navx-spill-label").length >= ${SECTIONS.length};`),
      { timeout: 20_000 },
    );
    await sleep(300);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-98-menu.png` });
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll(".navx-spill-label")].map((e) => e.textContent.trim()),
    );
    check(
      SECTIONS.every((s) => labels.includes(s)),
      `menu lists all sections (${labels.join(", ")})`,
    );
    // A missing label is already a FAIL above; don't let the click's 30 s
    // auto-wait throw and abort the rest of the run (and the mobile scenario).
    await page
      .locator(".navx-spill-root .navx-spill-label", { hasText: "Contact" })
      .first()
      .evaluate((b) => b.click(), undefined, { timeout: 5000 })
      .catch(() => {});
    const jumped = await waitFor(page, () => {
      const closed = document.querySelector(".navx-spill-root") == null;
      const label = (document.querySelector(".snc-dial-label")?.textContent || "").trim();
      const unlocked = document.documentElement.style.overflow !== "hidden";
      return closed && unlocked && label === "Contact";
    }, { timeout: 15_000 }); // covered cut + label spring both need frames
    if (!jumped) {
      console.log(`  info menu jump state: ${JSON.stringify(await page.evaluate(() => ({
        y: Math.round(window.scrollY),
        menuMounted: document.querySelector(".navx-spill-root") != null,
        label: (document.querySelector(".snc-dial-label")?.textContent || "").trim(),
        overflow: document.documentElement.style.overflow,
      })))}`);
    }
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

  // 7b. Page ends and the seam overlay. #seam-layer (desktop, fine pointer,
  //     motion OK only) is the page's single fixed cross-section overlay; it
  //     must be hidden at rest at both ends, after every seam has had its
  //     turn (the sweep, the menu cut, jump-to-top). At the page end the
  //     keypad stays stuck under the footer sheet (wide screens) and every
  //     footer row has printed (all widths).
  {
    await settleScroll(page);
    const layerState = () => page.evaluate(() => {
      const el = document.getElementById("seam-layer");
      return el ? { vis: getComputedStyle(el).visibility, kids: el.childElementCount } : null;
    });
    const atTop = await layerState();
    await scrollTo(page, await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight));
    await settleScroll(page);
    await waitFrames(page, 2);
    await sleep(600); // the rows' steps(9) wipes settle
    const atEnd = await layerState();
    const idle = (s) => s && s.vis === "hidden" && s.kids === 0;
    check(
      mobile ? (!atTop || idle(atTop)) && (!atEnd || idle(atEnd)) : idle(atTop) && idle(atEnd),
      `seam overlay idle at rest (top ${JSON.stringify(atTop)}, end ${JSON.stringify(atEnd)})`,
    );
    const end = await page.evaluate(() => {
      const hold = document.querySelector(".keypad-section .keypad-hold")?.getBoundingClientRect();
      const foot = document.querySelector(".portfolio-footer")?.getBoundingClientRect();
      const rows = [...document.querySelectorAll(".portfolio-footer [data-print-row]")];
      return {
        y: Math.round(window.scrollY),
        holdTop: hold ? Math.round(hold.top) : null,
        footTop: foot ? Math.round(foot.top) : null,
        rows: rows.length,
        printed: rows.filter((r) => r.classList.contains("is-printed")).length,
      };
    });
    if (!mobile) {
      check(
        end.holdTop != null && Math.abs(end.holdTop) <= 1 && end.footTop != null && end.footTop > 0,
        `keypad stays in view under the footer (y ${end.y}: keypad top ${end.holdTop}, footer top ${end.footTop})`,
      );
    }
    check(end.rows > 0 && end.printed === end.rows, `footer rows printed at page end (${end.printed}/${end.rows})`);
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
  executablePath: process.env.CHROME || undefined, // a local Chromium when Playwright's own build is not installed
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
