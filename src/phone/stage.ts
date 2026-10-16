import * as THREE from "three";
import { installObjects } from "./objects";

/*
 * The phone site's stage. Scroll places a camera on Daniel's objects in order
 * (room, Mac, hobby props, voxel podium, keypad). Every window
 * (.ph-win[data-shot]) holds its own 2D canvas (.ph-gl) that scrolls WITH the
 * page, so the 3D can never trail the DOM; ONE off-DOM WebGL renderer draws
 * each on-screen window's station with that window's camera and copies the
 * pixels into its canvas in the same task. The section grounds are CSS (the
 * canvases are transparent). Each object is shown exactly once, in its own
 * window(s): the camera ARRIVES as that window rises in, driven by the raw
 * scroll (it stops the instant the finger does). Frames are drawn only when
 * something changes; ambient drift runs at <= 30 fps and rests 4 s after the
 * last input. Lab: .scratch/mobile-redesign (m05-stage.js, its `arrive`
 * offsets); keep the numbers in step.
 */

export interface Station {
  group: THREE.Group;
  object?: THREE.Object3D;
  /** Per frame while a window of it is near the screen; `t` is the ambient clock.
   *  Returns true only while something of its own still moves (spring, hop, glitch, drag). */
  update?: (dt: number, t: number, st: StageState) => boolean;
  measure?: (vw: number, vh: number) => void;
  drag?: (dx: number) => void;
  /** A tap in `win` (ndc in that window's canvas; the shared camera is posed for it). */
  tap?: (ndc: { x: number; y: number }, win: HTMLElement) => boolean;
  /** Before each window's draw: per-window state (the Mac shows that window's project). */
  prepare?: (win: HTMLElement) => void;
  /** Textures to upload before the first reveal besides those on the group's materials. */
  warm?: THREE.Texture[];
}
export type StationKey = "room" | "mac" | "props" | "podium" | "keypad";
export type StationImpl = Omit<Station, "group">;
interface Shot {
  at: StationKey;
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  /** Where the camera starts its arrival, as an offset from pos (first window of a station). */
  arrive?: THREE.Vector3;
  P: THREE.Vector3;
  L: THREE.Vector3;
}
interface CamState {
  P: THREE.Vector3;
  L: THREE.Vector3;
  fov: number;
}
type Seg = { y0: number; y1: number; shot: Shot } & ({ k: "dwell" } | { k: "arrive" | "move"; from: CamState; to: CamState });
/** One stage window: its DOM box (cached), its canvas, and its two segments. */
interface Win {
  el: HTMLElement;
  /** Where the canvas lives: the window itself, or the sticky Interests pin. */
  host: HTMLElement;
  sticky: boolean;
  cv: HTMLCanvasElement;
  g: CanvasRenderingContext2D | null;
  shot: Shot;
  /** Document top and height of the window; CSS size of its canvas. */
  top: number;
  h: number;
  cw: number;
  ch: number;
  /** Arrive (or the Mac's move) as it rises in, then dwell until it leaves. */
  a: Seg;
  d: Seg;
  /** Near the screen last frame / needs a draw / its canvas holds a frame. */
  near: boolean;
  need: boolean;
  full: boolean;
}
export interface StageState {
  /** The raw scroll position the cameras are placed for. */
  y: number;
  /** Each station's arrival progress (linear): 0 as its first window enters, 1 once settled. */
  arrive: Record<StationKey, number>;
  /** Ambient time step this frame (0 while ambient drift rests). */
  amb: number;
  /** Windows near the screen this frame, with their arrive/move progress (1 once settled). */
  wins: Array<{ el: HTMLElement; p: number }>;
}
type PhProbe = { drawn: StationKey[]; frames: number; cam: () => { x: number; y: number; z: number } };
export interface StageCtx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  root: HTMLElement;
  REDUCED: boolean;
  invalidate: () => void;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// World stations (where each object lives). Each window draws only its own
// station, so neighbours never show in each other's frame whatever the spacing.
const AT: Record<StationKey, THREE.Vector3> = {
  room: V(0, -3.4, 0),
  mac: V(3.2, -3.5, 0),
  props: V(6.8, -3.3, 0),
  podium: V(10.5, -3.4, 0),
  keypad: V(14.4, -3.7, 0),
};
// pos/look are offsets from the station. `arrive` (the lab's numbers) is where
// a station's first window starts its camera, added to pos with the aim kept on
// the object, so it is in frame from the window's first rows and only grows
// and turns as the camera settles: further out (+z) and up (+y) for a crane.
const SHOT_SPEC: Record<string, { at: StationKey; pos: THREE.Vector3; look: THREE.Vector3; fov: number; arrive?: THREE.Vector3 }> = {
  room: { at: "room", pos: V(0, 1.6, 10), look: V(0, -0.1, 0), fov: 30, arrive: V(-0.8, 1.6, 2.2) }, // crane down onto it
  mac0: { at: "mac", pos: V(-1.7, 1.7, 7.9), look: V(0, 0.7, 0), fov: 30, arrive: V(-1.6, 0.5, 2.4) }, // truck in
  mac1: { at: "mac", pos: V(2.3, 1.3, 7.7), look: V(0, 0.7, 0), fov: 30 },
  mac2: { at: "mac", pos: V(-1.1, 0.75, 8.0), look: V(0, 0.75, 0), fov: 30 },
  mac3: { at: "mac", pos: V(0.6, 1.2, 7.3), look: V(0, 0.78, 0), fov: 30 },
  props: { at: "props", pos: V(0, 1.4, 6.9), look: V(0, -0.15, 0), fov: 30, arrive: V(1.2, 1.6, 2.2) }, // crane down
  podium: { at: "podium", pos: V(2.0, 1.5, 7.0), look: V(0, 0.58, 0), fov: 30, arrive: V(1.0, 0.5, 3.0) }, // dolly in (aim mid-height: the #25 trophy tops out at 1.44)
  keypad: { at: "keypad", pos: V(0, 9.2, 4.2), look: V(0, 0.4, 0.3), fov: 32, arrive: V(0, 2.6, 1.0) }, // drop onto it
};
const SHOTS: Record<string, Shot> = Object.fromEntries(
  Object.entries(SHOT_SPEC).map(([k, s]) => [k, { ...s, P: s.pos.clone().add(AT[s.at]), L: s.look.clone().add(AT[s.at]) }]),
);
const UP = V(0, 1, 0);
const DRIFT_A = THREE.MathUtils.degToRad(4);
const DRIFT_D = 0.025;
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
/** Ambient drift rests this long after the last scroll or touch, and draws at most 30 fps. */
const AMBIENT_MS = 4000;
const AMBIENT_FRAME = 1000 / 30;

export function installStage(root: HTMLElement): () => void {
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Measured (M4 Metal, iPhone 14 Pro viewport, 4x CPU): MSAA off at DPR 2
  // costs 40-60% less GPU per window than MSAA on at DPR 2, and less than MSAA
  // on at DPR 1.5, and is sharper on a 3x screen.
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const main = root.querySelector<HTMLElement>(".ph-site")!;
  const offs: Array<() => void> = [];
  let alive = true;
  const on = <K extends keyof WindowEventMap>(k: K, f: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => {
    window.addEventListener(k, f, o);
    offs.push(() => window.removeEventListener(k, f, o));
  };

  // ── Renderer + camera: one context on a canvas that is never in the DOM
  // (its class only names it for the perf tools). Each window's pixels are
  // copied out of it into that window's own canvas.
  const glc = document.createElement("canvas");
  glc.className = "ph-stage";
  const renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  let dirty = true;

  const stations = {} as Record<StationKey, Station>;
  for (const k of Object.keys(AT) as StationKey[]) {
    const g = new THREE.Group();
    g.position.copy(AT[k]);
    g.visible = false;
    scene.add(g);
    stations[k] = { group: g };
  }
  const mount = (key: StationKey, impl: StationImpl) => {
    const st = stations[key];
    Object.assign(st, impl);
    if (impl.object) st.group.add(impl.object);
    warm(key);
    dirty = true;
    kick();
  };

  // ── Prewarm: upload a station's textures and compile its programs in idle
  // time, one job per idle slot, long before its window, so the first reveal
  // never pays for them inside a scroll frame. (compile() walks hidden groups.)
  const jobs: Array<() => Promise<unknown> | void> = [];
  let pumping = false;
  // (iOS Safari has no requestIdleCallback.)
  const idle = (f: () => void) =>
    typeof requestIdleCallback === "function" ? requestIdleCallback(f, { timeout: 1200 }) : setTimeout(f, 50);
  function pump() {
    if (pumping || !jobs.length || !alive) return;
    pumping = true;
    idle(() => {
      const job = jobs.shift()!;
      Promise.resolve()
        .then(() => (alive ? job() : undefined))
        .catch(() => {})
        .then(() => {
          pumping = false;
          pump();
        });
    });
  }
  function warm(key: StationKey) {
    const st = stations[key];
    const texs = new Set<THREE.Texture>(st.warm ?? []);
    st.group.traverse((o) => {
      const mats = (o as THREE.Mesh).material;
      for (const mt of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        for (const v of Object.values(mt)) if ((v as THREE.Texture | null)?.isTexture) texs.add(v as THREE.Texture);
        const u = (mt as THREE.ShaderMaterial).uniforms;
        if (u) for (const { value } of Object.values(u)) if ((value as THREE.Texture | null)?.isTexture) texs.add(value as THREE.Texture);
      }
    });
    for (const t of texs) jobs.push(() => renderer.initTexture(t));
    jobs.push(() => renderer.compileAsync(st.group, camera, scene));
    pump();
  }

  // ── Scroll -> camera: each window has its own short timeline ───────────────
  //   arrive: a station's first window, from its top edge entering at the
  //           screen's bottom until the window is centred (a tall one: pinned):
  //           the camera eases from the shot + `arrive` onto the shot.
  //   move:   the Mac's next window, same span: an orbit from the previous
  //           window's last framing.
  //   dwell:  from there until the window leaves: the shot with a gentle
  //           scroll-scrubbed drift (a few degrees of orbit + a touch of dolly).
  // Each starts and ends at zero velocity, so there is no step where they
  // join. Every window frames its object on its own centre, through a fixed
  // full-screen virtual viewport (one stable svh), so nothing moves when the
  // iOS toolbar shows or hides.
  let arrivals: Partial<Record<StationKey, Seg>> = {};
  let vw = document.documentElement.clientWidth;
  let svh = window.innerHeight;
  const docTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
  // A 100svh probe: read once, and again only when the width changes.
  const svhProbe = document.createElement("div");
  svhProbe.setAttribute("aria-hidden", "true");
  svhProbe.style.cssText = "position:absolute;left:0;top:0;width:0;height:100svh;visibility:hidden;pointer-events:none";
  root.appendChild(svhProbe);
  const readSvh = () => svhProbe.offsetHeight || window.innerHeight;

  function stateOf(shot: Shot, q: number): CamState {
    const o = shot.P.clone().sub(shot.L).applyAxisAngle(UP, q * DRIFT_A).multiplyScalar(1 - q * DRIFT_D);
    return { P: shot.L.clone().add(o), L: shot.L.clone(), fov: shot.fov };
  }

  // The windows, each with its own canvas (first child, so the window's own
  // labels paint above it; the sticky Interests window keeps it in its pin).
  const wins: Win[] = [...main.querySelectorAll<HTMLElement>(".ph-win[data-shot]")].map((el) => {
    const pin = el.querySelector<HTMLElement>(".ph-play-pin");
    const host = pin ?? el;
    const cv = document.createElement("canvas");
    cv.className = "ph-gl";
    cv.setAttribute("aria-hidden", "true");
    cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none";
    cv.width = cv.height = 0;
    host.prepend(cv);
    const shot = SHOTS[el.dataset.shot!];
    const seg: Seg = { k: "dwell", y0: 0, y1: 0, shot };
    return { el, host, sticky: !!pin, cv, g: cv.getContext("2d"), shot, top: 0, h: 0, cw: 0, ch: 0, a: seg, d: seg, near: false, need: true, full: false };
  });
  offs.push(() => wins.forEach((w) => w.cv.remove()));

  function measure() {
    let prev: Shot | null = null;
    arrivals = {};
    for (const w of wins) {
      w.top = docTop(w.el);
      w.h = w.el.offsetHeight;
      w.cw = w.host.clientWidth;
      w.ch = w.host.clientHeight;
      const { shot, top, h } = w;
      // Settled as the window is centred (a tall one: as it pins); the
      // arrival runs from its first rows to there.
      const settle = h > svh ? top : top + h / 2 - svh / 2;
      const enter = top - svh;
      const to = stateOf(shot, -1);
      if (prev?.at === shot.at) {
        // The Mac's next project: the orbit, played inside the arriving window.
        w.a = { k: "move", y0: enter, y1: settle, shot, from: stateOf(prev, 1), to };
      } else {
        // A new station: it arrives in its own window, never flown in from the
        // previous object (that one was already seen in its own window).
        const from = { P: to.P.clone().add(shot.arrive ?? V(0, 0, 0)), L: to.L.clone(), fov: to.fov };
        w.a = { k: "arrive", y0: enter, y1: settle, shot, from, to };
        arrivals[shot.at] = w.a;
      }
      w.d = { k: "dwell", y0: settle, y1: top + h, shot };
      w.need = true;
      prev = shot;
    }
    sizeGL();
    for (const st of Object.values(stations)) st.measure?.(vw, svh);
    photos.measure();
    dirty = true;
    kick();
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  const _p = new THREE.Vector3();
  const _l = new THREE.Vector3();
  const _o = new THREE.Vector3();
  const state: StageState = { y: 0, arrive: { room: 0, mac: 0, props: 0, podium: 0, keypad: 0 }, amb: 0, wins: [] };
  // Debug probe (always on, cheap): what the last rendered frame drew, for tests.
  const lastCam = new THREE.Vector3();
  const probe: PhProbe = { drawn: [], frames: 0, cam: () => ({ x: lastCam.x, y: lastCam.y, z: lastCam.z }) };
  (window as Window & { __phStage?: PhProbe }).__phStage = probe;

  const progOf = (s: Seg, y: number) => (s.y1 > s.y0 ? THREE.MathUtils.clamp((y - s.y0) / (s.y1 - s.y0), 0, 1) : 1);
  // Pose the shared camera for window w at scroll y: its segment's shot (eased
  // from the raw scroll), seen through w's slice of the virtual viewport.
  function camFor(w: Win, y: number) {
    const s = y < w.d.y0 ? w.a : w.d;
    // Reduced motion: static settled shots (no arrival, no orbit, no drift).
    const p = REDUCED && s.k !== "dwell" ? 1 : progOf(s, y);
    let fov: number;
    if (s.k === "dwell") {
      const q = REDUCED ? 0 : Math.sin(((p * 2 - 1) * Math.PI) / 2);
      _o.copy(s.shot.P).sub(s.shot.L).applyAxisAngle(UP, q * DRIFT_A).multiplyScalar(1 - q * DRIFT_D);
      _l.copy(s.shot.L);
      _p.copy(_l).add(_o);
      fov = s.shot.fov;
    } else {
      const k = ease(p);
      const a = s.from;
      const b = s.to;
      if (s.k === "move") {
        // An orbit between the Mac's windows (cylindrical about the station).
        const c = AT[s.shot.at];
        const ra = Math.hypot(a.P.x - c.x, a.P.z - c.z);
        const rb = Math.hypot(b.P.x - c.x, b.P.z - c.z);
        const aa = Math.atan2(a.P.x - c.x, a.P.z - c.z);
        const ab = Math.atan2(b.P.x - c.x, b.P.z - c.z);
        const r = THREE.MathUtils.lerp(ra, rb, k);
        const ang = THREE.MathUtils.lerp(aa, ab, k);
        _p.set(c.x + Math.sin(ang) * r, THREE.MathUtils.lerp(a.P.y, b.P.y, k), c.z + Math.cos(ang) * r);
      } else {
        // Arrival: one eased crane/truck/dolly onto the shot, aim on the object.
        _p.lerpVectors(a.P, b.P, k);
      }
      _l.lerpVectors(a.L, b.L, k);
      fov = THREE.MathUtils.lerp(a.fov, b.fov, k);
    }
    // The lab framed every shot on a full screen with the window centred on
    // it: the window's canvas is that screen's middle slice.
    const cw = Math.max(1, w.cw);
    const ch = Math.max(1, w.ch);
    camera.aspect = cw / svh;
    camera.setViewOffset(cw, svh, 0, (svh - ch) / 2, cw, ch);
    camera.position.copy(_p);
    camera.fov = fov;
    camera.lookAt(_l);
    camera.updateProjectionMatrix();
  }
  // Where a window's canvas sits on screen at scroll y (the pin sticks).
  const hostTop = (w: Win, y: number) =>
    (w.sticky ? THREE.MathUtils.clamp(y, w.top, w.top + w.h - w.ch) : w.top) - y;

  // ── Sizing: the GL canvas is as big as the biggest window canvas and only
  // reallocates when that changes (the width, or the stable svh). A height-only
  // resize (the iOS toolbar) changes nothing.
  let glW = 0;
  let glH = 0;
  function sizeGL() {
    let w = 1;
    let h = 1;
    for (const v of wins) {
      w = Math.max(w, v.cw);
      h = Math.max(h, v.ch);
    }
    // +1: a window's rounded device size may not exceed the floored GL size.
    if (w + 1 !== glW || h + 1 !== glH) {
      glW = w + 1;
      glH = h + 1;
      renderer.setSize(glW, glH, false);
    }
  }
  function resize() {
    const w = document.documentElement.clientWidth;
    if (w === vw) return;
    vw = w;
    svh = readSvh();
    measure();
  }
  on("resize", resize);
  const ro = new ResizeObserver(() => measure());
  ro.observe(main);
  offs.push(() => ro.disconnect());

  // ── Loop: draw a window only when something it shows changed: the scroll
  // moved, it came near the screen, its station still moves, or ambient drift
  // is due (<= 30 fps, resting 4 s after the last input). Otherwise the loop
  // stops until the next scroll, touch or invalidate.
  let running = !document.hidden;
  let raf = 0;
  let last = performance.now();
  let lastY = NaN;
  let lastDraw = 0;
  let lastInput = performance.now();
  let ambT = 0;
  let landed = "";
  const moving = new Set<StationKey>();
  const updated = new Set<StationKey>();
  function frame(now: number) {
    raf = 0;
    if (!running) return;
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const y = window.scrollY;
    const scrolled = y !== lastY;
    lastY = y;
    const ambOn = !REDUCED && now - lastInput < AMBIENT_MS;
    if (ambOn) ambT += dt;
    // Windows near the screen (cached boxes; a quarter screen of margin so an
    // entering window already holds its frame on its first visible row).
    const vhNow = window.innerHeight;
    const M = svh * 0.25;
    const near: Win[] = [];
    const seen = new Set<Win>();
    let landedNow = "";
    for (const w of wins) {
      const t = hostTop(w, y);
      if (t >= vhNow + M || t + w.ch <= -M) {
        w.near = false;
        continue;
      }
      if (!w.near) w.need = true;
      w.near = true;
      near.push(w);
      if (t < vhNow && t + w.ch > 0) {
        seen.add(w);
        // The room's callout prints in once the room has settled (never over it mid-move).
        if (!landedNow && y >= w.d.y0) landedNow = w.shot.at;
      }
    }
    if (landedNow !== landed) {
      landed = landedNow;
      main.dataset.landed = landedNow;
    }
    state.y = y;
    state.amb = ambOn ? dt : 0;
    state.wins = near.map((w) => ({ el: w.el, p: REDUCED ? 1 : progOf(w.a, y) }));
    for (const k of Object.keys(state.arrive) as StationKey[]) {
      const a = arrivals[k];
      state.arrive[k] = REDUCED || !a ? 1 : progOf(a, y);
    }
    // Each station near the screen steps once (posed for its first window:
    // the room's card billboards to it).
    moving.clear();
    updated.clear();
    for (const w of near) {
      const k = w.shot.at;
      const st = stations[k];
      if (updated.has(k) || !st.update || !st.object) continue;
      updated.add(k);
      camFor(w, y);
      if (st.update(dt, ambT, state)) moving.add(k);
    }
    // Scroll, ambient drift and springs only redraw windows actually on screen:
    // one in the margin holds still (its arrival has not begun, or its dwell
    // has ended) and was drawn as it came near.
    const all = dirty;
    const amb = ambOn && now - lastDraw >= AMBIENT_FRAME - 1;
    const scr = scrolled && !REDUCED;
    dirty = false;
    let drew = false;
    for (const w of near) {
      if (!(all || w.need || (seen.has(w) && (scr || amb || moving.has(w.shot.at))))) continue;
      w.need = false;
      drew = drawWin(w, y) || drew;
    }
    if (drew) {
      lastDraw = now;
      probe.frames++;
    }
    const shown = new Set<StationKey>();
    for (const w of seen) if (w.full) shown.add(w.shot.at);
    probe.drawn = [...shown];
    if ((moving.size && seen.size) || (ambOn && seen.size)) raf = requestAnimationFrame(frame);
  }
  // Draw window w: its station alone, through its camera, into the shared GL
  // canvas's bottom-left corner, then copy that into the window's canvas in
  // the same task (the GL buffer is still valid).
  function drawWin(w: Win, y: number) {
    const st = stations[w.shot.at];
    const g = w.g;
    if (!g || !st.object || !w.cw || !w.ch) {
      // Not built yet: an empty (transparent) window shows its CSS ground.
      if (g && w.full) g.clearRect(0, 0, w.cv.width, w.cv.height);
      w.full = false;
      return false;
    }
    const pw = Math.round(w.cw * DPR);
    const ph = Math.round(w.ch * DPR);
    if (w.cv.width !== pw || w.cv.height !== ph) {
      w.cv.width = pw;
      w.cv.height = ph;
    }
    camFor(w, y);
    st.prepare?.(w.el);
    for (const s of Object.values(stations)) s.group.visible = s === st;
    renderer.setViewport(0, 0, w.cw, w.ch);
    renderer.setScissor(0, 0, w.cw, w.ch);
    renderer.setScissorTest(true);
    renderer.render(scene, camera);
    st.group.visible = false;
    g.clearRect(0, 0, pw, ph);
    g.drawImage(glc, 0, glc.height - ph, pw, ph, 0, 0, pw, ph);
    w.full = true;
    lastCam.copy(camera.position);
    return true;
  }
  function kick() {
    if (!raf && running && alive) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  const input = () => {
    lastInput = performance.now();
    kick();
  };
  const onVis = () => {
    running = !document.hidden;
    dirty = true;
    kick();
  };
  document.addEventListener("visibilitychange", onVis);
  offs.push(() => document.removeEventListener("visibilitychange", onVis));
  // If the system reclaims the context, three rebuilds its state on restore;
  // every window then draws again (and the warm jobs re-upload).
  const onRestored = () => {
    wins.forEach((w) => (w.need = true));
    (Object.keys(stations) as StationKey[]).forEach((k) => stations[k].object && warm(k));
    dirty = true;
    kick();
  };
  glc.addEventListener("webglcontextrestored", onRestored);
  offs.push(() => glc.removeEventListener("webglcontextrestored", onRestored));

  // ── Touch: inside a window, a horizontal drag turns that object (vertical
  // pan stays native via touch-action: pan-y); a tap pokes it.
  for (const w of wins) {
    const el = w.el;
    const station = () => stations[w.shot.at];
    let d: { x: number; y: number; lx: number; drag: boolean; id: number } | null = null;
    let dragged = false;
    const down = (e: PointerEvent) => {
      d = { x: e.clientX, y: e.clientY, lx: e.clientX, drag: false, id: e.pointerId };
      dragged = false;
      input();
    };
    const move = (e: PointerEvent) => {
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.drag && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) d.drag = dragged = true;
      if (d.drag) {
        station().drag?.((e.clientX - d.lx) / vw);
        dirty = true;
        input();
      }
      d.lx = e.clientX;
    };
    const end = () => (d = null);
    // Taps go through "click" (a user gesture in WebKit, so window.open is allowed). Real links/buttons keep their own job.
    const click = (e: MouseEvent) => {
      if (dragged || (e.target as Element).closest("a, button")) return;
      const st = station();
      if (!st.tap || !st.object) return;
      // NDC in THIS window's canvas, raycast with THIS window's camera.
      const r = w.cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const ndc = { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
      camFor(w, window.scrollY);
      st.tap(ndc, el);
      dirty = true;
      input();
    };
    const opt = { passive: true };
    el.addEventListener("pointerdown", down, opt);
    el.addEventListener("pointermove", move, opt);
    el.addEventListener("pointerup", end, opt);
    el.addEventListener("pointercancel", end, opt);
    el.addEventListener("click", click);
    offs.push(() => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
      el.removeEventListener("click", click);
    });
  }

  // ── Recents: three photo columns with their own drift. Columns start
  // top-aligned and finish bottom-aligned: each lifts by how much taller it is
  // than the shortest one, spread over the block's pass.
  const photos = (() => {
    const box = main.querySelector<HTMLElement>(".ph-photos")!;
    let cols: HTMLElement[] = [];
    let lift = [0, 0, 0];
    let boxTop = 0;
    let boxH = 1;
    const measureP = () => {
      if (!cols.length) return;
      const hs = cols.map((c) => c.scrollHeight);
      const lo = Math.min(...hs);
      lift = hs.map((h) => h - lo);
      // The block is as tall as the shortest column (they all end bottom-aligned).
      if (!REDUCED) box.style.height = Math.round(lo + 6 + 40) + "px";
      boxTop = docTop(box);
      boxH = Math.max(1, box.offsetHeight);
      drift();
    };
    // From the cached box (no layout read per scroll event).
    const drift = () => {
      if (REDUCED || !cols.length) return;
      const top = boxTop - window.scrollY;
      if (top + boxH < -svh || top > svh * 2) return;
      const k = THREE.MathUtils.clamp((svh - top) / boxH, 0, 1);
      cols.forEach((c, i) => (c.style.transform = `translate3d(0, ${(-k * lift[i]).toFixed(1)}px, 0)`));
    };
    void fetch("/photos/manifest.json")
      .then((r) => r.json() as Promise<Array<{ src: string; w: number; h: number }>>)
      .then((list) => {
        if (!alive) return;
        box.replaceChildren();
        cols = [0, 1, 2].map(() => {
          const c = document.createElement("div");
          c.className = "ph-pcol";
          box.appendChild(c);
          return c;
        });
        const colH = [0, 0, 0];
        for (const p of list) {
          const k = colH.indexOf(Math.min(...colH));
          const img = new Image(p.w, p.h);
          img.loading = "lazy"; // before src, or a detached Image starts fetching at once
          img.decoding = "async";
          img.alt = "";
          img.src = p.src;
          cols[k].appendChild(img);
          colH[k] += p.h / p.w;
        }
        measure();
      })
      .catch(() => {});
    on("scroll", drift, { passive: true });
    return { measure: measureP };
  })();

  // ── Reveal: titles print in with stepped clips (chrome), sheet content rises
  // with a smooth ease-out (content). Reduced motion: everything is just there.
  if (!REDUCED && "IntersectionObserver" in window) {
    root.classList.add("ph-rv");
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add("ph-in");
          io.unobserve(e.target);
        }),
      { rootMargin: "0px 0px -8% 0px" },
    );
    main.querySelectorAll<HTMLElement>(".ph-head, .ph-sheet").forEach((el) => {
      [...el.children].forEach((c, i) => (c as HTMLElement).style.setProperty("--i", String(Math.min(i, 6))));
      io.observe(el);
    });
    offs.push(() => io.disconnect());
  }

  svh = readSvh();
  measure();
  void document.fonts?.ready.then(() => alive && measure());
  on("load", measure);
  on("scroll", input, { passive: true });
  kick();
  const disposeObjects = installObjects(
    {
      renderer,
      scene,
      camera,
      root,
      REDUCED,
      invalidate: () => {
        dirty = true;
        kick();
      },
    },
    mount,
  );

  return () => {
    alive = false;
    running = false;
    if (raf) cancelAnimationFrame(raf);
    offs.forEach((f) => f());
    disposeObjects();
    delete (window as Window & { __phStage?: PhProbe }).__phStage;
    root.classList.remove("ph-rv");
    svhProbe.remove();
    jobs.length = 0;
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((mt) => {
        Object.values(mt).forEach((v) => (v as THREE.Texture | null)?.isTexture && (v as THREE.Texture).dispose());
        mt.dispose();
      });
    });
    renderer.dispose();
    renderer.forceContextLoss();
  };
}
