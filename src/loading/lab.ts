/**
 * Dev-only side-by-side of the ?loader= variants (loader-lab.html). Each card
 * replays BootLoader's timeline: eased count over the chosen duration, 100, a
 * 500 ms hold, the 540 ms exit, then loops. Behind each card sits a still of
 * the real hero so the custom exits (iris, fly-off) show what they reveal.
 * Network numbers are simulated here (a ~1.4 MB first load); on the site
 * they are real.
 */
import { VARIANTS, type LoaderVariant } from "./variants";
import type { LoadEntry, LoadStats } from "./loadStats";

const HOLD = 500;
const FADE = 540;
const GAP = 700;
const outQuad = (t: number) => 1 - (1 - t) * (1 - t);

// Roughly the production first load: document, JS chunks, CSS, fonts, images.
const SIM: LoadEntry[] = [
  [31e3, "doc"], [146e3, "script"], [195e3, "script"], [24e3, "style"], [2e3, "style"],
  [48e3, "font"], [21e3, "font"], [19e3, "font"], [9e3, "data"], [62e3, "script"],
  [18e3, "script"], [7e3, "script"], [310e3, "image"], [120e3, "image"], [44e3, "image"],
  [12e3, "script"], [5e3, "data"], [88e3, "image"], [3e3, "script"], [26e3, "image"],
  [16e3, "font"], [9e3, "style"], [140e3, "image"], [4e3, "data"], [33e3, "script"],
  [71e3, "image"], [2e3, "data"], [15e3, "script"], [52e3, "image"], [6e3, "script"],
].map(([bytes, kind]) => ({ bytes: bytes as number, kind: kind as LoadEntry["kind"], cached: false }));
const SIM_BYTES = SIM.reduce((a, e) => a + e.bytes, 0);

const style = document.createElement("style");
style.textContent = `
  :root { color-scheme: light dark; --bg:#f4f1ee; --ink:#141210; --line:rgba(20,18,16,.14); }
  @media (prefers-color-scheme: dark) { :root { --bg:#121110; --ink:#f4f1ee; --line:rgba(244,241,238,.16); } }
  body { margin:0; background:var(--bg); color:var(--ink); font:14px/1.4 Geist, system-ui, sans-serif; }
  .lab-bar { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:12px; align-items:center;
    padding:12px 16px; background:var(--bg); border-bottom:1px solid var(--line); }
  .lab-ctl { display:flex; gap:4px; margin-left:auto; }
  .lab-bar button { font:inherit; color:inherit; background:transparent; border:1px solid var(--line);
    border-radius:6px; padding:6px 10px; cursor:pointer; }
  .lab-bar button.is-on { background:#ff4f00; border-color:#ff4f00; color:#fff; }
  .lab-h { margin:20px 16px 0; font-size:13px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; opacity:.6; }
  .lab-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr)); gap:16px; padding:12px 16px 16px; }
  .lab-card { margin:0; }
  .lab-card figcaption { display:flex; justify-content:space-between; padding:8px 2px 0; }
  .lab-card a { color:inherit; }
  .lab-stage { position:relative; aspect-ratio:16/10; border-radius:8px; overflow:hidden;
    background:#ff4f00 url(/.scratch/loader/hero-at-reveal.png) center/cover; }
  .lab-stage .ldr-host { background:#ff4f00; transition:opacity ${FADE}ms cubic-bezier(.22,1,.36,1); }
  .lab-stage .ldr-host.is-own { background:transparent; transition:none; }
  .lab-stage .ldr-host.is-gone:not(.is-own) { opacity:0; }
`;
document.head.appendChild(style);

let dur = 1200;
/** ?at=0..1 pins every card at that point of the run (for screenshots);
 *  ?at=exit:0..1 pins them part-way through the exit. */
const AT = new URLSearchParams(location.search).get("at");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const main = document.getElementById("grid")!;

interface Card { host: HTMLElement; v: LoaderVariant; info: (typeof VARIANTS)[number]; t0: number }
const cards: Card[] = [];
for (const [title, from, to] of [["Batch 3 · circles", 13, 18], ["Batch 2", 7, 12], ["Batch 1", 1, 6]] as const) {
  const h = document.createElement("h2");
  h.className = "lab-h";
  h.textContent = title;
  const grid = document.createElement("div");
  grid.className = "lab-grid";
  main.append(h, grid);
  for (const info of VARIANTS.filter((v) => v.id >= from && v.id <= to)) {
    const fig = document.createElement("figure");
    fig.className = "lab-card";
    const stage = document.createElement("div");
    stage.className = "lab-stage";
    const host = document.createElement("div");
    host.className = "ldr-host" + (info.ownsExit ? " is-own" : "");
    stage.appendChild(host);
    const cap = document.createElement("figcaption");
    cap.innerHTML = `<span>${info.id} · ${info.name}</span><a href="/?loader=${info.id}" target="_blank">Open on the site</a>`;
    fig.append(stage, cap);
    grid.appendChild(fig);
    cards.push({ host, info, v: info.create(host, reduced), t0: performance.now() });
  }
}

function restart(c: Card) {
  c.v.destroy();
  c.host.classList.remove("is-gone");
  c.v = c.info.create(c.host, reduced);
  c.t0 = performance.now();
}

function tick(now: number) {
  for (const c of cards) {
    let t = now - c.t0;
    if (AT != null) t = AT.startsWith("exit:") ? dur + HOLD + Number(AT.slice(5)) * FADE : Number(AT) * dur;
    const lin = Math.min(1, t / dur);
    const done = lin >= 1;
    const p = done ? 1 : 0.99 * outQuad(lin);
    const n = done ? 100 : Math.floor(p * 100);
    const count = Math.round(SIM.length * lin);
    const entries = SIM.slice(0, Math.max(1, count));
    const s: LoadStats = {
      elapsedMs: 380 + Math.min(t, dur),
      bytes: SIM_BYTES * lin,
      files: entries.length,
      cached: 0,
      bytesPerSec: SIM_BYTES / (dur / 1000),
      last: "",
      entries,
    };
    const exit = t > dur + HOLD ? Math.min(1, (t - dur - HOLD) / FADE) : 0;
    c.v.frame(now, p, n, s, exit);
    if (exit > 0) c.host.classList.add("is-gone");
    if (AT == null && t > dur + HOLD + FADE + GAP) restart(c);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

document.querySelectorAll<HTMLButtonElement>("[data-dur]").forEach((b) =>
  b.addEventListener("click", () => {
    dur = Number(b.dataset.dur);
    document.querySelectorAll("[data-dur]").forEach((x) => x.classList.toggle("is-on", x === b));
    cards.forEach(restart);
  }),
);
document.getElementById("replay")!.addEventListener("click", () => cards.forEach(restart));
