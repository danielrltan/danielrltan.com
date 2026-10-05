/**
 * Dev-only side-by-side of the six ?loader= variants (loader-lab.html). Each
 * card replays BootLoader's timeline: eased count over the chosen duration,
 * 100, a 500 ms hold, the 540 ms fade, then loops. Network numbers are
 * simulated here (a ~1.4 MB first load); on the site they are real.
 */
import { VARIANTS, type LoaderVariant } from "./variants";
import type { LoadStats } from "./loadStats";

const HOLD = 500;
const FADE = 540;
const GAP = 700;
const BYTES = 1.4e6;
const outQuad = (t: number) => 1 - (1 - t) * (1 - t);

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
  .lab-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,420px),1fr)); gap:16px; padding:16px; }
  .lab-card { margin:0; }
  .lab-card figcaption { display:flex; justify-content:space-between; padding:8px 2px 0; }
  .lab-card a { color:inherit; }
  .lab-stage { position:relative; aspect-ratio:16/10; background:#ff4f00; border-radius:8px; overflow:hidden; }
  .lab-stage .ldr-host { transition:opacity ${FADE}ms cubic-bezier(.22,1,.36,1); }
  .lab-stage .ldr-host.is-gone { opacity:0; }
`;
document.head.appendChild(style);

let dur = 1200;
/** ?at=0..1 pins every card at that point of the run (for screenshots). */
const AT = new URLSearchParams(location.search).get("at");
const grid = document.getElementById("grid")!;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

interface Card { host: HTMLElement; v: LoaderVariant; info: (typeof VARIANTS)[number]; t0: number }
const cards: Card[] = VARIANTS.map((info) => {
  const fig = document.createElement("figure");
  fig.className = "lab-card";
  const stage = document.createElement("div");
  stage.className = "lab-stage";
  const host = document.createElement("div");
  host.className = "ldr-host";
  stage.appendChild(host);
  const cap = document.createElement("figcaption");
  cap.innerHTML = `<span>${info.id} · ${info.name}</span><a href="/?loader=${info.id}" target="_blank">Open on the site</a>`;
  fig.append(stage, cap);
  grid.appendChild(fig);
  return { host, info, v: info.create(host, reduced), t0: performance.now() };
});

function restart(c: Card) {
  c.v.destroy();
  c.host.classList.remove("is-gone");
  c.v = c.info.create(c.host, reduced);
  c.t0 = performance.now();
}

function tick(now: number) {
  for (const c of cards) {
    const t = AT != null ? Number(AT) * dur : now - c.t0;
    const lin = Math.min(1, t / dur);
    const done = lin >= 1;
    const p = done ? 1 : 0.99 * outQuad(lin);
    const n = done ? 100 : Math.floor(p * 100);
    const bytes = BYTES * lin;
    const s: LoadStats = {
      elapsedMs: 380 + Math.min(t, dur),
      bytes,
      files: Math.round(1 + 30 * lin),
      cached: 0,
      bytesPerSec: BYTES / (dur / 1000),
      last: "",
    };
    c.v.frame(now, p, n, s);
    if (t > dur + HOLD) c.host.classList.add("is-gone");
    if (t > dur + HOLD + FADE + GAP) restart(c);
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
