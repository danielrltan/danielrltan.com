/**
 * Cursor lab (dev only, cursor-lab.html). Grid: 24 tiles, each a small
 * playground with the site's three surfaces (dotted orange hero, white page,
 * solid orange button) plus a link, a paragraph and an input; hover a tile to
 * drive its cursor. Focus (?c=N): a fuller mock of the site with one cursor
 * full-screen; ← / → or the buttons switch.
 */
import "./lab.css";
import { CURSORS, mountCursor } from "./index";

const app = document.getElementById("app")!;
const params = new URLSearchParams(location.search);
const focus = Number(params.get("c"));

function tile(info: (typeof CURSORS)[number]) {
  const fig = document.createElement("figure");
  fig.className = "cl-tile";
  fig.innerHTML = `
    <div class="cl-play">
      <div class="cl-hero"><div class="cl-word">DANIEL<br>TAN</div><button class="cl-chip">Menu</button></div>
      <div class="cl-white">
        <p>Software engineer and designer, building <a href="#">Poddle</a> and other small worlds.</p>
        <div class="cl-row"><button class="cl-btn">Projects</button><input placeholder="Say hi" /></div>
      </div>
      <div class="cl-layer"></div>
    </div>
    <figcaption><b>${info.id} · ${info.name}</b><small>${info.blurb}</small><a href="?c=${info.id}">Focus</a></figcaption>`;
  return fig;
}

if (!focus) {
  const bar = document.createElement("header");
  bar.className = "cl-bar";
  bar.innerHTML = `<strong>Cursor lab</strong><span>Hover a tile to drive its cursor. Focus opens it full-screen.</span>`;
  const grid = document.createElement("main");
  grid.className = "cl-grid";
  app.append(bar, grid);
  for (const info of CURSORS) {
    const fig = tile(info);
    grid.appendChild(fig);
    const play = fig.querySelector<HTMLElement>(".cl-play")!;
    const layer = fig.querySelector<HTMLElement>(".cl-layer")!;
    // Rest the preview over the white half, where the cursor reads hardest.
    mountCursor(info, play, layer, { restAt: () => ({ x: play.clientWidth * 0.62, y: play.clientHeight * 0.45 }) });
  }
} else {
  app.innerHTML = `
    <div class="cf">
      <section class="cf-hero" data-surface="orange"><small>Hey! Welcome to the website of</small><h1>DANIEL<br>TAN</h1><button class="cf-menu">Menu</button></section>
      <section class="cf-sec">
        <h2>About</h2>
        <p>Software engineer and designer at Western. Lately: <a href="#">Poddle</a>, pickleball where your phone is the paddle, and a <a href="#">3D room</a> you can poke around in.</p>
        <div class="cf-row"><button class="cf-btn">See projects</button><button class="cf-ghost">Resume</button><input placeholder="Your email" /></div>
        <textarea rows="3" placeholder="Say hi"></textarea>
      </section>
      <section class="cf-cards">
        <a class="cf-card" href="#"><span>01</span><b>Poddle</b></a>
        <a class="cf-card" href="#"><span>02</span><b>Cognetech</b></a>
        <a class="cf-card" href="#"><span>03</span><b>MoTrack.co</b></a>
      </section>
      <section class="cf-band"><h3>Let's build something.</h3><button>Get in touch</button></section>
      <footer class="cf-foot"><p>© Daniel Tan</p></footer>
      <div class="cf-layer"></div>
      <nav class="cf-switch"><header><button data-d="-1">‹</button><button data-d="1">›</button><b></b><a href="cursor-lab.html">Grid</a></header><small></small></nav>
    </div>`;
  const scope = app.querySelector<HTMLElement>(".cf")!;
  const layer = app.querySelector<HTMLElement>(".cf-layer")!;
  let idx = Math.max(0, CURSORS.findIndex((c) => c.id === focus));
  let eng: ReturnType<typeof mountCursor> | null = null;
  const show = () => {
    eng?.destroy();
    const info = CURSORS[idx];
    app.querySelector(".cf-switch b")!.textContent = `${info.id} · ${info.name}`;
    app.querySelector(".cf-switch small")!.textContent = info.blurb;
    history.replaceState(null, "", `?c=${info.id}`);
    eng = mountCursor(info, scope, layer);
  };
  const step = (d: number) => {
    idx = (idx + d + CURSORS.length) % CURSORS.length;
    show();
  };
  app.querySelectorAll<HTMLButtonElement>("[data-d]").forEach((b) => b.addEventListener("click", () => step(Number(b.dataset.d))));
  addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).matches("input, textarea")) return;
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  });
  show();
}
