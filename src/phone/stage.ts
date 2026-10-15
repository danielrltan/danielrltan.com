import * as THREE from "three";
import { installObjects } from "./objects";

/*
 * The phone site's stage: ONE fixed WebGL canvas behind the whole page. Scroll
 * places a camera on Daniel's objects in order (room, Mac, hobby props, voxel
 * podium, keypad); the page is sharp white sheets that leave windows open
 * where an object is the subject. Each object is shown exactly once, in its
 * own window(s): the camera ARRIVES as that window rises in (no flights from
 * the previous object, no transit gaps). Lab: .scratch/mobile-redesign
 * (m05-stage.js, its `arrive` offsets); keep the numbers in step.
 */

export interface Station {
  group: THREE.Group;
  object?: THREE.Object3D;
  update?: (dt: number, t: number, st: StageState) => boolean;
  measure?: (vw: number, vh: number) => void;
  drag?: (dx: number) => void;
  tap?: (ndc: { x: number; y: number }) => boolean;
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
type Win = HTMLElement & { _top: number; _h: number };
// Every segment belongs to one window (w) and its region (r).
type Seg = { y0: number; y1: number; w: Win; shot: Shot; r: number } & (
  | { k: "dwell" }
  | { k: "arrive" | "move"; from: CamState; to: CamState }
);
export interface StageState {
  /** The (smoothed) scroll position the camera is placed for. */
  y: number;
  /** Each station's arrival progress (linear): 0 as its first window enters, 1 once settled. */
  arrive: Record<StationKey, number>;
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
  podium: { at: "podium", pos: V(2.0, 1.3, 7.0), look: V(0, -0.02, 0), fov: 30, arrive: V(1.0, 0.5, 3.0) }, // dolly in
  keypad: { at: "keypad", pos: V(0, 9.2, 4.2), look: V(0, 0.4, 0.3), fov: 32, arrive: V(0, 2.6, 1.0) }, // drop onto it
};
const SHOTS: Record<string, Shot> = Object.fromEntries(
  Object.entries(SHOT_SPEC).map(([k, s]) => [k, { ...s, P: s.pos.clone().add(AT[s.at]), L: s.look.clone().add(AT[s.at]) }]),
);
const GROUND: Record<string, THREE.Vector3> = {
  orange: V(1, 0x4f / 255, 0),
  light: V(0xee / 255, 0xf0 / 255, 0xf3 / 255),
  grey: V(0xd8 / 255, 0xda / 255, 0xde / 255),
};
const UP = V(0, 1, 0);
const DRIFT_A = THREE.MathUtils.degToRad(4);
const DRIFT_D = 0.025;
const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

export function installStage(root: HTMLElement): () => void {
  const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  const canvas = root.querySelector<HTMLCanvasElement>(".ph-stage")!;
  const main = root.querySelector<HTMLElement>(".ph-site")!;
  const offs: Array<() => void> = [];
  const on = <K extends keyof WindowEventMap>(k: K, f: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => {
    window.addEventListener(k, f, o);
    offs.push(() => window.removeEventListener(k, f, o));
  };

  // ── Renderer + camera ──────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(DPR);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  let dirty = true;

  // ── Ground: a full-screen quad drawn first. The ground belongs to the page,
  // not the camera: section A's colour above the next section's boundary, B's
  // below, joined by a 3-row pixel dither (75/50/25 %) that scrolls with the
  // page, so it can never drift from the DOM.
  const groundMat = new THREE.ShaderMaterial({
    vertexShader: "void main(){ gl_Position = vec4(position.xy * 2.0, 0.999, 1.0); }",
    fragmentShader: `uniform vec3 uA; uniform vec3 uB; uniform float uSplit; uniform float uCell; uniform vec2 uRes;
      void main(){
        float yTop = uRes.y - gl_FragCoord.y;
        float d = floor((yTop - uSplit) / uCell);
        float cx = mod(floor(gl_FragCoord.x / uCell), 4.0);
        bool a = d < 0.0 || (d == 0.0 && cx < 3.0) || (d == 1.0 && mod(cx, 2.0) == 1.0) || (d == 2.0 && cx == 2.0);
        gl_FragColor = vec4(a ? uA : uB, 1.0);
      }`,
    uniforms: {
      uA: { value: GROUND.orange.clone() },
      uB: { value: GROUND.orange.clone() },
      uSplit: { value: 1e6 },
      uCell: { value: 12 * DPR },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    depthTest: false,
    depthWrite: false,
  });
  const groundQuad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
  groundQuad.frustumCulled = false;
  groundQuad.renderOrder = -1000;
  scene.add(groundQuad);

  const stations = {} as Record<StationKey, Station>;
  for (const k of Object.keys(AT) as StationKey[]) {
    const g = new THREE.Group();
    g.position.copy(AT[k]);
    scene.add(g);
    stations[k] = { group: g };
  }
  const mount = (key: StationKey, impl: StationImpl) => {
    const st = stations[key];
    Object.assign(st, impl);
    if (impl.object) st.group.add(impl.object);
    dirty = true;
  };

  // ── Scroll -> camera: each window has its own short timeline ───────────────
  //   arrive: a station's first window, from its top edge entering at the
  //           screen's bottom until the window is centred (a tall one: pinned):
  //           the camera eases from the shot + `arrive` onto the shot.
  //   move:   the Mac's next window, same span: an orbit from the previous
  //           window's last framing.
  //   dwell:  from there until the window leaves: the shot with a gentle
  //           scroll-scrubbed drift (a few degrees of orbit + a touch of dolly).
  // Each starts and ends at zero velocity, so there is no step where they
  // join. The frame centre ("focus") is a point on the PAGE, so 3D moves 1:1
  // with the DOM it belongs to.
  let segs: Seg[] = [];
  let arrivals: Partial<Record<StationKey, Seg>> = {};
  let sheets: Array<[number, number]> = [];
  let bounds: Array<{ top: number; g: string }> = [];
  let regions: Array<{ top: number; bot: number }> = [];
  let vh = window.innerHeight;
  let vw = window.innerWidth;
  let sizedW = 0;
  let sizedH = 0;
  const docTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY;

  function stateOf(shot: Shot, q: number): CamState {
    const o = shot.P.clone().sub(shot.L).applyAxisAngle(UP, q * DRIFT_A).multiplyScalar(1 - q * DRIFT_D);
    return { P: shot.L.clone().add(o), L: shot.L.clone(), fov: shot.fov };
  }
  function lockOf(w: Win, y: number) {
    return w._h > vh ? THREE.MathUtils.clamp(y + vh / 2, w._top + vh / 2, w._top + w._h - vh / 2) : w._top + w._h / 2;
  }
  // The centre of the part of a window on screen (the screen's bottom edge
  // while it has not entered yet).
  function sliceOf(w: Win, y: number) {
    const t = THREE.MathUtils.clamp(w._top, y, y + vh);
    const b = THREE.MathUtils.clamp(w._top + w._h, y, y + vh);
    return (t + b) / 2;
  }

  function measure() {
    vh = window.innerHeight;
    vw = window.innerWidth;
    const wins = [...main.querySelectorAll<HTMLElement>(".ph-win[data-shot]")] as Win[];
    wins.forEach((w) => {
      w._top = docTop(w);
      w._h = w.offsetHeight;
    });
    // Stage regions: runs of adjacent windows (in practice each window is its own).
    regions = [];
    for (const el of main.querySelectorAll<HTMLElement>(".ph-win")) {
      const top = docTop(el);
      const bot = top + el.offsetHeight;
      const last = regions[regions.length - 1];
      if (last && Math.abs(last.bot - top) < 2) last.bot = bot;
      else regions.push({ top, bot });
    }
    const regOf = (top: number) => regions.findIndex((r) => top >= r.top - 1 && top < r.bot);
    segs = [];
    arrivals = {};
    let prev: Shot | null = null;
    for (const w of wins) {
      const shot = SHOTS[w.dataset.shot!];
      const top = w._top;
      const h = w._h;
      const r = regOf(top);
      // Settled as the window is centred (a tall one: as it pins, where its
      // lock is the screen centre); the move runs from its first rows to there.
      const settle = h > vh ? top : top + h / 2 - vh / 2;
      const enter = top - vh;
      const to = stateOf(shot, -1);
      if (prev?.at === shot.at) {
        // The Mac's next project: the orbit, played inside the arriving window.
        segs.push({ k: "move", y0: enter, y1: settle, w, shot, r, from: stateOf(prev, 1), to });
      } else {
        // A new station: it arrives in its own window, never flown in from the
        // previous object (that one was already seen in its own window).
        const from = { P: to.P.clone().add(shot.arrive ?? V(0, 0, 0)), L: to.L.clone(), fov: to.fov };
        const a: Seg = { k: "arrive", y0: enter, y1: settle, w, shot, r, from, to };
        segs.push(a);
        arrivals[shot.at] = a;
      }
      segs.push({ k: "dwell", y0: settle, y1: top + h, w, shot, r });
      prev = shot;
    }
    segs.sort((a, b) => a.y0 - b.y0);
    // The ground switches where each section starts (its header's top edge).
    bounds = [...main.querySelectorAll<HTMLElement>(":scope > .ph-sec")].map((s) => ({ top: docTop(s), g: s.dataset.ground ?? "light" }));
    sheets = [...main.querySelectorAll<HTMLElement>(".ph-sheet, .ph-opaque")].map((s) => {
      const t = docTop(s);
      return [t, t + s.offsetHeight];
    });
    for (const st of Object.values(stations)) st.measure?.(vw, vh);
    photos.measure();
    dirty = true;
  }

  // ── Camera ─────────────────────────────────────────────────────────────────
  const _p = new THREE.Vector3();
  const _l = new THREE.Vector3();
  const _o = new THREE.Vector3();
  const tilt = { x: 0, y: 0 };
  const tiltTarget = { x: 0, y: 0 };
  const state: StageState = { y: 0, arrive: { room: 0, mac: 0, props: 0, podium: 0, keypad: 0 } };
  // Debug probe (always on, cheap): what the last rendered frame drew, for tests.
  const lastCam = new THREE.Vector3();
  const probe: PhProbe = { drawn: [], frames: 0, cam: () => ({ x: lastCam.x, y: lastCam.y, z: lastCam.z }) };
  (window as Window & { __phStage?: PhProbe }).__phStage = probe;

  function segAt(y: number, list = segs) {
    let s = list[0];
    for (const g of list) {
      if (y >= g.y0) s = g;
      else break;
    }
    return s;
  }
  const progOf = (s: Seg, y: number) => (s.y1 > s.y0 ? THREE.MathUtils.clamp((y - s.y0) / (s.y1 - s.y0), 0, 1) : 1);
  // Point the camera for one segment at scroll y (focus uses the raw scroll yr).
  function camFor(s: Seg, y: number, yr: number) {
    let p = progOf(s, y);
    // Reduced motion: an arrival is just the shot; the Mac's orbit is a cut.
    if (REDUCED && s.k !== "dwell") p = s.k === "arrive" || p >= 0.5 ? 1 : 0;
    let fov: number;
    let focus: number;
    if (s.k === "dwell") {
      const q = REDUCED ? 0 : Math.sin(((p * 2 - 1) * Math.PI) / 2);
      _o.copy(s.shot.P).sub(s.shot.L).applyAxisAngle(UP, q * DRIFT_A).multiplyScalar(1 - q * DRIFT_D);
      _l.copy(s.shot.L);
      _p.copy(_l).add(_o);
      fov = s.shot.fov;
      focus = lockOf(s.w, yr);
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
      // The object starts centred on the sliver of window already on screen
      // (so it shows from the first rows, not once half the window is in) and
      // eases onto the window's own centre as the camera settles.
      focus = REDUCED ? lockOf(s.w, yr) : THREE.MathUtils.lerp(sliceOf(s.w, yr), lockOf(s.w, yr), k);
    }
    const shift = vh / 2 - (focus - yr);
    if (Math.abs(shift) > 0.5) camera.setViewOffset(sizedW, sizedH, 0, shift * (sizedH / Math.max(1, canvas.clientHeight)), sizedW, sizedH);
    else if (camera.view?.enabled) camera.clearViewOffset();
    camera.position.copy(_p);
    // Gyro (after a tap): a small parallax offset in camera space.
    camera.lookAt(_l);
    camera.translateX(tilt.x * 0.35);
    camera.translateY(tilt.y * 0.22);
    camera.fov = fov;
    camera.lookAt(_l);
    camera.updateProjectionMatrix();
  }
  // Each stage region shows its own part of the timeline: the segment that
  // owns it at this scroll, or (before/after) its first/last segment held still.
  function segForRegion(ri: number, y: number) {
    const own = segs.filter((g) => g.r === ri);
    if (!own.length) return null;
    if (y <= own[0].y0) return own[0];
    return segAt(y, own);
  }
  // The regions on screen this frame, each with its segment (built in frame(),
  // drawn by renderStage()). Off-screen stations neither update nor draw.
  let live: Array<{ r: { top: number; bot: number }; sg: Seg }> = [];
  function placeLive(y: number, yr: number) {
    const H = canvas.clientHeight || vh;
    live = [];
    regions.forEach((r, ri) => {
      if (r.bot <= yr || r.top >= yr + H) return;
      const sg = segForRegion(ri, y);
      if (sg) live.push({ r, sg });
    });
  }
  let landed = "";
  function placeGround(y: number) {
    let i = 0;
    while (i < bounds.length - 1 && bounds[i + 1].top <= y) i++;
    const A = bounds[i];
    const N = bounds[i + 1];
    const ga = A?.g ?? "orange";
    let gb = ga;
    let split = 1e6;
    if (N && N.top < y + canvas.clientHeight) {
      gb = N.g;
      split = (N.top - y) * (sizedH * DPR / Math.max(1, canvas.clientHeight));
    }
    groundMat.uniforms.uA.value.copy(GROUND[ga]);
    groundMat.uniforms.uB.value.copy(GROUND[gb]);
    groundMat.uniforms.uSplit.value = split;
  }
  // Is any part of the viewport NOT covered by an opaque sheet?
  function stageVisible(y: number) {
    let reach = y;
    for (const [t, b] of sheets) {
      if (b <= reach) continue;
      if (t > reach + 12) return true; // hairline gaps between sheets count as covered
      reach = Math.max(reach, b);
      if (reach >= y + vh) return false;
    }
    return reach < y + vh;
  }

  // ── Sizing: only reallocate on width changes (iOS URL bar show/hide changes height).
  function resize() {
    const w = document.documentElement.clientWidth;
    const h = Math.max(window.innerHeight, canvas.clientHeight || 0);
    if (w !== sizedW || Math.abs(h - sizedH) > 120) {
      sizedW = w;
      sizedH = h;
      renderer.setSize(w, h, false);
      groundMat.uniforms.uRes.value.set(w * DPR, h * DPR);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    measure();
  }
  on("resize", resize);
  const ro = new ResizeObserver(() => measure());
  ro.observe(main);
  offs.push(() => ro.disconnect());

  // ── Loop: render only when the stage shows and something changed or animates.
  let running = !document.hidden;
  let raf = 0;
  let smoothY = window.scrollY;
  let lastRawY = -1;
  let last = performance.now();
  function frame(now: number) {
    raf = 0;
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const y = window.scrollY;
    const prevY = smoothY;
    const visible = stageVisible(y);
    // While opaque sheets cover the stage nobody sees the camera: let it catch
    // up at once, so it is never still travelling when the stage reopens.
    smoothY = REDUCED || !visible ? y : smoothY + (y - smoothY) * (1 - Math.exp(-dt * 9));
    if (y !== lastRawY) {
      lastRawY = y;
      dirty = true;
    }
    if (Math.abs(y - smoothY) < 0.3) smoothY = y;
    if (smoothY !== prevY) dirty = true;
    const tk = 1 - Math.exp(-dt * 4);
    if (Math.abs(tiltTarget.x - tilt.x) + Math.abs(tiltTarget.y - tilt.y) > 0.001) {
      tilt.x += (tiltTarget.x - tilt.x) * tk;
      tilt.y += (tiltTarget.y - tilt.y) * tk;
      dirty = true;
    }
    placeGround(y);
    placeLive(smoothY, y);
    state.y = smoothY;
    for (const k of Object.keys(state.arrive) as StationKey[]) {
      const a = arrivals[k];
      state.arrive[k] = REDUCED || !a ? 1 : progOf(a, smoothY);
    }
    // The room's callout prints in once the room has settled (never over it mid-move).
    const l = live.find((v) => v.sg.k === "dwell")?.sg.shot.at ?? "";
    if (l !== landed) {
      landed = l;
      main.dataset.landed = l;
    }
    // Every station with a window on screen animates (once per frame, with the
    // camera of its first such window: the room's card billboards to it).
    let animating = false;
    const done = new Set<StationKey>();
    for (const { sg } of live) {
      const k = sg.shot.at;
      const st = stations[k];
      if (done.has(k) || !st.update) continue;
      done.add(k);
      camFor(sg, smoothY, y);
      animating = st.update(dt, now / 1000, state) || animating;
    }
    if (visible && (dirty || (animating && !REDUCED))) {
      renderStage(y);
      dirty = false;
    } else if (!visible) probe.drawn = []; // opaque sheets cover the whole stage
    raf = requestAnimationFrame(frame);
  }
  // Ground over the whole screen; 3D only inside the windows on screen, each
  // clipped to its region and drawing ONLY its own station (so no object ever
  // shows under a heading or edge, or in another object's window).
  function renderStage(y: number) {
    const k = sizedH / Math.max(1, canvas.clientHeight);
    for (const st of Object.values(stations)) st.group.visible = false;
    renderer.autoClear = true;
    renderer.render(scene, camera); // ground only
    groundQuad.visible = false;
    renderer.autoClear = false;
    renderer.setScissorTest(true);
    const drawn: StationKey[] = [];
    for (const { r, sg } of live) {
      const key = sg.shot.at;
      const st = stations[key];
      const t = Math.max(0, r.top - y);
      const b = Math.min(canvas.clientHeight, r.bot - y);
      if (b <= t || !st.object) continue; // not built yet: nothing to draw
      camFor(sg, smoothY, y);
      st.group.visible = true;
      renderer.setScissor(0, sizedH - b * k, sizedW, (b - t) * k);
      renderer.clearDepth();
      renderer.render(scene, camera);
      st.group.visible = false;
      if (!drawn.includes(key)) drawn.push(key);
      lastCam.copy(camera.position);
    }
    renderer.setScissorTest(false);
    renderer.autoClear = true;
    groundQuad.visible = true;
    probe.drawn = drawn;
    probe.frames++;
  }
  const kick = () => {
    if (!raf && running) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  };
  const onVis = () => {
    running = !document.hidden;
    dirty = true;
    kick();
  };
  document.addEventListener("visibilitychange", onVis);
  offs.push(() => document.removeEventListener("visibilitychange", onVis));

  // ── Touch: inside a window, a horizontal drag turns that object (vertical
  // pan stays native via touch-action: pan-y); a tap pokes it. The first tap
  // on a 3D object also asks for device orientation (iOS needs the gesture).
  let gyroAsked = false;
  let gyroBase: [number, number] | null = null;
  const onOrient = (e: DeviceOrientationEvent) => {
    if (e.beta == null || e.gamma == null) return;
    gyroBase ??= [e.beta, e.gamma];
    tiltTarget.x = THREE.MathUtils.clamp((e.gamma - gyroBase[1]) / 28, -1, 1);
    tiltTarget.y = THREE.MathUtils.clamp((e.beta - gyroBase[0]) / 28, -1, 1);
  };
  function askGyro() {
    if (gyroAsked || REDUCED) return;
    gyroAsked = true;
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
    if (!DOE) return;
    const go = () => on("deviceorientation", onOrient, { passive: true });
    if (typeof DOE.requestPermission === "function") DOE.requestPermission().then((r) => r === "granted" && go()).catch(() => {});
    else go();
  }
  for (const w of main.querySelectorAll<HTMLElement>(".ph-win[data-shot]")) {
    const station = () => stations[SHOTS[w.dataset.shot!].at];
    let d: { x: number; y: number; lx: number; drag: boolean; id: number } | null = null;
    let dragged = false;
    const down = (e: PointerEvent) => {
      d = { x: e.clientX, y: e.clientY, lx: e.clientX, drag: false, id: e.pointerId };
      dragged = false;
    };
    const move = (e: PointerEvent) => {
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.drag && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) d.drag = dragged = true;
      if (d.drag) {
        station().drag?.((e.clientX - d.lx) / vw);
        dirty = true;
      }
      d.lx = e.clientX;
    };
    const end = () => (d = null);
    // Taps go through "click" (a user gesture in WebKit, so window.open and the
    // motion-permission request are allowed). Real links/buttons keep their own job.
    const click = (e: MouseEvent) => {
      if (dragged || (e.target as Element).closest("a, button")) return;
      const st = station();
      if (!st.tap) return;
      const ndc = { x: (e.clientX / vw) * 2 - 1, y: -(e.clientY / canvas.clientHeight) * 2 + 1 };
      // Raycast with THIS window's camera (another window may have been drawn last).
      const ri = regions.findIndex((r) => (w as Win)._top >= r.top - 1 && (w as Win)._top < r.bot);
      const sg = ri < 0 ? null : segForRegion(ri, smoothY);
      if (sg) camFor(sg, smoothY, window.scrollY);
      if (st.tap(ndc)) askGyro();
      dirty = true;
    };
    const opt = { passive: true };
    w.addEventListener("pointerdown", down, opt);
    w.addEventListener("pointermove", move, opt);
    w.addEventListener("pointerup", end, opt);
    w.addEventListener("pointercancel", end, opt);
    w.addEventListener("click", click);
    offs.push(() => {
      w.removeEventListener("pointerdown", down);
      w.removeEventListener("pointermove", move);
      w.removeEventListener("pointerup", end);
      w.removeEventListener("pointercancel", end);
      w.removeEventListener("click", click);
    });
  }

  // ── Recents: three photo columns with their own drift. Columns start
  // top-aligned and finish bottom-aligned: each lifts by how much taller it is
  // than the shortest one, spread over the block's pass.
  const photos = (() => {
    const box = main.querySelector<HTMLElement>(".ph-photos")!;
    let cols: HTMLElement[] = [];
    let lift = [0, 0, 0];
    const measureP = () => {
      if (!cols.length) return;
      const hs = cols.map((c) => c.scrollHeight);
      const lo = Math.min(...hs);
      lift = hs.map((h) => h - lo);
      // The block is as tall as the shortest column (they all end bottom-aligned).
      if (!REDUCED) box.style.height = Math.round(lo + 6 + 40) + "px";
      drift();
    };
    const drift = () => {
      if (REDUCED || !cols.length) return;
      const r = box.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) return;
      const k = THREE.MathUtils.clamp((vh - r.top) / r.height, 0, 1);
      cols.forEach((c, i) => (c.style.transform = `translate3d(0, ${(-k * lift[i]).toFixed(1)}px, 0)`));
    };
    let alive = true;
    offs.push(() => (alive = false));
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

  resize();
  void document.fonts?.ready.then(() => measure());
  on("load", measure);
  on("scroll", () => {
    dirty = true;
    kick();
  }, { passive: true });
  kick();
  const disposeObjects = installObjects({ renderer, scene, camera, root, REDUCED, invalidate: () => (dirty = true) }, mount);

  return () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    offs.forEach((f) => f());
    disposeObjects();
    delete (window as Window & { __phStage?: PhProbe }).__phStage;
    root.classList.remove("ph-rv");
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
