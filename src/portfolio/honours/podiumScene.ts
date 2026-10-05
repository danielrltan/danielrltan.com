import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * HONOURS PODIUM: the trophy wall as a 3D podium + tower (owner pick "07"
 * from the 15-option trophy lab, iterated: bigger podium, no black, bigger
 * readable slabs). Plain three.js on one canvas the section owns.
 *
 *   - The three FEATURED wins stand on a clay podium (headliner in the
 *     middle, tallest and orange), each topped with a voxel cup.
 *   - Every other entry is a labelled slab, dropped one by one into a
 *     leaning tower beside it (leadership in a light-orange tint,
 *     scholarships cool grey, the rest white).
 *   - Hover (mouse), click, or ←/→ while the canvas has focus picks an entry:
 *     a podium block lifts and its cup spins faster, a slab pulls out toward
 *     you. The section shows the picked entry's card (onFocus).
 *
 * Entrance plays when start() is called (the section scrolls into view), not
 * on load. The loop only runs while the canvas is on screen and the tab is
 * visible. Reduced motion: everything rests in place, no spin or parallax.
 * No black anywhere in the scene (owner): ink type is slate, shadows grey.
 */

export interface PodiumEntry {
  category: string;
  title: string;
  metric?: string;
  context?: string;
  featured?: boolean;
}

export interface PodiumSceneOptions {
  reduced: boolean;
  /** Called with the entry index to show (hovered, else selected), once the
   *  entrance has finished, and again whenever it changes. */
  onFocus: (index: number) => void;
}

export interface PodiumScene {
  /** Play the entrance (idempotent). */
  start(): void;
  dispose(): void;
}

const ORANGE = 0xff4f00;
const SLATE = "#4a4f58";
const DEEP = "#c23d00";
const MUTED = "#8a8f98";
/** Entrance length before the card shows (ms). */
const READY_MS = 2050;
/** The scene sits in this part of the canvas (fractions); the card owns the
 *  left. Same box as the approved lab draft "07" (the canvas fills the whole
 *  100svh section, header top-left, stats bottom-left). */
const FREE_BOX = { x0: 0.262, x1: 0.99, y0: 0.15, y1: 0.93 };

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

type Ctx2D = CanvasRenderingContext2D & { letterSpacing?: string };

export function createPodiumScene(
  host: HTMLElement,
  entries: readonly PodiumEntry[],
  opts: PodiumSceneOptions,
): PodiumScene {
  const { reduced, onFocus } = opts;
  const canvas = document.createElement("canvas");
  canvas.className = "bp-podium-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute(
    "aria-label",
    "The trophy wall in 3D: headline wins on a podium, the other honours stacked in a tower. Use the left and right arrow keys to step through them.",
  );
  host.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9dce2, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(6, 12, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 });
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.6);
  fill.position.set(-8, 4, 4);
  scene.add(fill);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.ShadowMaterial({ color: 0x6b7280, opacity: 0.16 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const world = new THREE.Group();
  scene.add(world);

  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // ---------- label textures ----------
  function canvasTex(c: HTMLCanvasElement) {
    const tex = track(new THREE.CanvasTexture(c));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    return tex;
  }
  /** Podium face: category, giant metric, title, context. */
  function podiumTex(t: PodiumEntry, w: number, h: number, onOrange: boolean) {
    const PX = 220;
    const c = document.createElement("canvas");
    c.width = Math.round(w * PX);
    c.height = Math.round(h * PX);
    const g = c.getContext("2d") as Ctx2D;
    const ink = onOrange ? "#ffffff" : SLATE;
    const pad = 0.16 * PX;
    g.fillStyle = onOrange ? "rgba(255,255,255,.82)" : DEEP;
    g.font = `600 ${0.15 * PX}px Geist, system-ui, sans-serif`;
    g.letterSpacing = `${0.025 * PX}px`;
    g.fillText(t.category.toUpperCase(), pad, pad + 0.15 * PX);
    g.letterSpacing = "0px";
    const metric = t.metric ?? "";
    g.fillStyle = onOrange ? "#ffffff" : "#ff4f00";
    let fs = 0.78 * PX;
    g.font = `700 ${fs}px Offbit, monospace`;
    while (g.measureText(metric).width > c.width - pad * 2 && fs > 20) {
      fs -= 4;
      g.font = `700 ${fs}px Offbit, monospace`;
    }
    const y0 = pad + 0.3 * PX + fs * 0.82;
    g.fillText(metric, pad, y0);
    g.fillStyle = ink;
    g.font = `600 ${0.25 * PX}px Geist, system-ui, sans-serif`;
    const lines = wrapLines(g, t.title, c.width - pad * 2);
    lines.forEach((l, k) => g.fillText(l, pad, y0 + 0.38 * PX + k * 0.3 * PX));
    if (t.context) {
      g.fillStyle = onOrange ? "rgba(255,255,255,.85)" : MUTED;
      g.font = `600 ${0.15 * PX}px Geist, system-ui, sans-serif`;
      g.letterSpacing = `${0.02 * PX}px`;
      g.fillText(t.context.toUpperCase(), pad, y0 + 0.38 * PX + lines.length * 0.3 * PX + 0.08 * PX);
      g.letterSpacing = "0px";
    }
    return canvasTex(c);
  }
  /** Tower slab face: metric left, category + title right. */
  function blockTex(t: PodiumEntry, w: number, h: number, tint: boolean) {
    const PX = 300;
    const c = document.createElement("canvas");
    c.width = Math.round(w * PX);
    c.height = Math.round(h * PX);
    const g = c.getContext("2d") as Ctx2D;
    const pad = 0.14 * PX;
    const mid = c.height / 2;
    g.textBaseline = "middle";
    const COL = 1.12 * PX;
    g.fillStyle = tint ? DEEP : "#ff4f00";
    let fs = 0.46 * PX;
    g.font = `700 ${fs}px Offbit, monospace`;
    while (t.metric && g.measureText(t.metric).width > COL && fs > 12) {
      fs -= 2;
      g.font = `700 ${fs}px Offbit, monospace`;
    }
    g.fillText(t.metric ?? "", pad, mid + fs * 0.04);
    const x2 = pad + (t.metric ? COL + 0.1 * PX : 0);
    const ts = 0.19 * PX;
    g.font = `600 ${ts}px Geist, system-ui, sans-serif`;
    const tl = wrapLines(g, t.title, c.width - x2 - pad).slice(0, 2);
    const top = mid - (0.13 * PX + tl.length * 0.22 * PX) / 2;
    g.fillStyle = tint ? DEEP : MUTED;
    g.font = `600 ${0.12 * PX}px Geist, system-ui, sans-serif`;
    g.letterSpacing = `${0.018 * PX}px`;
    g.fillText(t.category.toUpperCase(), x2, top + 0.04 * PX);
    g.letterSpacing = "0px";
    g.fillStyle = SLATE;
    g.font = `600 ${ts}px Geist, system-ui, sans-serif`;
    tl.forEach((l, k) => g.fillText(l, x2, top + 0.24 * PX + k * 0.22 * PX));
    return canvasTex(c);
  }

  // ---------- build ----------
  const clay = (hex: number, r = 0.55) =>
    track(new THREE.MeshStandardMaterial({ color: hex, roughness: r, metalness: 0 }));
  const M_WHITE = clay(0xf6f7f9);
  const M_ORANGE = clay(ORANGE, 0.45);
  const M_DEEP = clay(0xc23d00, 0.5);
  const M_PEACH = clay(0xffd8c4, 0.55);
  const M_GREY = clay(0xd8dade);

  interface Item {
    i: number;
    group: THREE.Group;
    kind: "podium" | "block";
    cup?: THREE.Group;
    base?: THREE.Vector3;
    yaw?: number;
    start: number;
    pull: number;
  }
  const items: Item[] = [];
  const pickables: THREE.Object3D[] = [];

  /** Voxel trophy cup (instanced cubes), ~0.95 voxel-units tall. */
  function voxelCup(mat: THREE.Material, v: number) {
    const cells: Array<[number, number, number]> = [];
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) cells.push([x, 0, z]);
    cells.push([0, 1, 0], [0, 2, 0]);
    for (let y = 3; y <= 6; y++) {
      const r = y === 3 ? 1 : 2;
      for (let x = -r; x <= r; x++)
        for (let z = -r; z <= r; z++) {
          const edge = Math.max(Math.abs(x), Math.abs(z)) === r;
          if (edge || y === 3) cells.push([x, y, z]);
        }
    }
    for (const s of [-1, 1]) cells.push([3 * s, 5, 0], [3 * s, 4, 0], [3 * s, 6, 0]);
    const geo = track(new THREE.BoxGeometry(v * 0.94, v * 0.94, v * 0.94));
    const im = new THREE.InstancedMesh(geo, mat, cells.length);
    const m4 = new THREE.Matrix4();
    cells.forEach(([x, y, z], k) => im.setMatrixAt(k, m4.makeTranslation(x * v, y * v + v / 2, z * v)));
    im.castShadow = true;
    im.receiveShadow = true;
    return im;
  }

  const featured = entries.map((e, i) => ({ e, i })).filter(({ e }) => e.featured).slice(0, 3);
  const rest = entries.map((e, i) => ({ e, i })).filter(({ i }) => !featured.some((f) => f.i === i));
  // Podium order left -> right: second, HEADLINER (middle, tallest), third.
  const PW = 3.6;
  const PD = 2.8;
  const podiumSpots = [
    { x: -3.72, h: 3.55 },
    { x: 0, h: 4.75 },
    { x: 3.72, h: 2.65 },
  ];
  const podiumOrder = [featured[1], featured[0], featured[2]];
  podiumOrder.forEach((f, k) => {
    if (!f) return;
    const { x, h } = podiumSpots[k]!;
    const onOrange = f === featured[0];
    const g = new THREE.Group();
    g.position.set(x, 0, 0);
    const body = new THREE.Mesh(track(new RoundedBoxGeometry(PW, h, PD, 4, 0.09)), onOrange ? M_ORANGE : M_WHITE);
    body.position.y = h / 2;
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const faceMat = track(
      new THREE.MeshBasicMaterial({ map: podiumTex(f.e, PW - 0.16, h - 0.16, onOrange), transparent: true, toneMapped: false }),
    );
    const face = new THREE.Mesh(track(new THREE.PlaneGeometry(PW - 0.16, h - 0.16)), faceMat);
    face.position.set(0, h / 2, PD / 2 + 0.002);
    g.add(face);
    const cupG = new THREE.Group();
    cupG.position.y = h;
    cupG.add(voxelCup(onOrange ? M_DEEP : M_ORANGE, onOrange ? 0.17 : 0.14));
    g.add(cupG);
    for (const m of [body, face]) {
      m.userData.i = f.i;
      pickables.push(m);
    }
    world.add(g);
    items.push({ i: f.i, group: g, kind: "podium", cup: cupG, start: 120 + k * 140, pull: 0 });
  });

  const BW = 4.15;
  const BH = 0.84;
  const BD = 1.8;
  const TX = 8.0;
  rest.forEach(({ e, i }, k) => {
    const tint = e.category === "Leadership";
    const g = new THREE.Group();
    const y = k * (BH + 0.035);
    const yaw = (k % 2 ? 1 : -1) * (0.04 + (k % 3) * 0.018);
    g.position.set(TX + (k % 2 ? 0.07 : -0.07), y, -0.15);
    g.rotation.y = yaw;
    const mat = tint ? M_PEACH : e.category === "Scholarship" ? M_GREY : M_WHITE;
    const body = new THREE.Mesh(track(new RoundedBoxGeometry(BW, BH, BD, 3, 0.06)), mat);
    body.position.y = BH / 2;
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const faceMat = track(
      new THREE.MeshBasicMaterial({ map: blockTex(e, BW - 0.1, BH - 0.08, tint), transparent: true, toneMapped: false }),
    );
    const face = new THREE.Mesh(track(new THREE.PlaneGeometry(BW - 0.1, BH - 0.08)), faceMat);
    face.position.set(0, BH / 2, BD / 2 + 0.002);
    g.add(face);
    for (const m of [body, face]) {
      m.userData.i = i;
      pickables.push(m);
    }
    world.add(g);
    items.push({ i, group: g, kind: "block", base: g.position.clone(), yaw, start: 560 + k * 105, pull: 0 });
  });

  // ---------- layout: fit the content box into FREE_BOX of the canvas ----------
  const towerH = Math.max(1, rest.length) * (BH + 0.035) + 0.05;
  const CONTENT = new THREE.Box3(
    new THREE.Vector3(-5.6, 0, -1.5),
    new THREE.Vector3(TX + BW / 2 + 0.1, Math.max(towerH, 5.6), 1.6),
  );
  const target = new THREE.Vector3();
  const baseCam = new THREE.Vector3();
  let W = 1;
  let H = 1;
  function layout() {
    W = Math.max(1, host.clientWidth);
    H = Math.max(1, host.clientHeight);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const b = FREE_BOX;
    const fw = b.x1 - b.x0;
    const fh = b.y1 - b.y0;
    CONTENT.getCenter(target);
    const dir = new THREE.Vector3(0.28, 0.32, 1).normalize();
    const pts: THREE.Vector3[] = [];
    for (const x of [CONTENT.min.x, CONTENT.max.x])
      for (const y of [CONTENT.min.y, CONTENT.max.y])
        for (const z of [CONTENT.min.z, CONTENT.max.z]) pts.push(new THREE.Vector3(x, y, z));
    let dist = 20;
    let ndc = { x0: -1, x1: 1, y0: -1, y1: 1 };
    camera.clearViewOffset();
    for (let k = 0; k < 4; k++) {
      camera.position.copy(target).addScaledVector(dir, dist);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const p = pts.map((v) => v.clone().project(camera));
      ndc = {
        x0: Math.min(...p.map((v) => v.x)),
        x1: Math.max(...p.map((v) => v.x)),
        y0: Math.min(...p.map((v) => v.y)),
        y1: Math.max(...p.map((v) => v.y)),
      };
      dist *= Math.max((ndc.x1 - ndc.x0) / 2 / fw, (ndc.y1 - ndc.y0) / 2 / fh) * 1.03;
    }
    const cxN = (ndc.x0 + ndc.x1) / 2;
    const cyN = (ndc.y0 + ndc.y1) / 2;
    const dx = ((b.x0 + b.x1) / 2 - 0.5) * W - (cxN * W) / 2;
    const dy = ((b.y0 + b.y1) / 2 - 0.5) * H + (cyN * H) / 2;
    camera.setViewOffset(W, H, -dx, -dy, W, H);
    camera.updateProjectionMatrix();
    baseCam.copy(camera.position);
    if (!running) renderer.render(scene, camera);
  }

  // ---------- interaction ----------
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  const parallax = new THREE.Vector2();
  let hoverI = -1;
  let sel = featured[0]?.i ?? 0;
  let ready = false;
  let ownsCursor = false;
  let lastFocus = -2;
  const focusI = () => (hoverI >= 0 ? hoverI : sel);
  const emitFocus = () => {
    if (!ready) return;
    const f = focusI();
    if (f !== lastFocus) {
      lastFocus = f;
      onFocus(f);
    }
  };
  function pick(cx: number, cy: number) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? (hit.object.userData.i as number) : -1;
  }
  function setCursor(on: boolean) {
    // The voxel cursor reads body.style.cursor === "pointer" as a hover target.
    if (on) {
      document.body.style.cursor = "pointer";
      ownsCursor = true;
    } else if (ownsCursor) {
      document.body.style.cursor = "";
      ownsCursor = false;
    }
  }
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    parallax.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    if (e.pointerType !== "mouse") return;
    const i = pick(e.clientX, e.clientY);
    if (i !== hoverI) {
      hoverI = i;
      setCursor(i >= 0);
      emitFocus();
    }
  };
  const onLeave = () => {
    hoverI = -1;
    parallax.set(0, 0);
    setCursor(false);
    emitFocus();
  };
  const onClick = (e: MouseEvent) => {
    const i = pick(e.clientX, e.clientY);
    if (i >= 0) {
      sel = i;
      hoverI = -1;
      emitFocus();
    }
  };
  // Arrow keys only while the canvas has focus (never page-wide).
  const order = [...podiumOrder.filter(Boolean).map((f) => f!.i), ...rest.map((r) => r.i)].sort((a, b) => a - b);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const k = order.indexOf(sel);
    sel = order[(k + (e.key === "ArrowRight" ? 1 : order.length - 1)) % order.length]!;
    hoverI = -1;
    emitFocus();
  };
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("keydown", onKey);

  // ---------- motion ----------
  const backOut = (t: number) => {
    const c = 1.6;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  };
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  let born = -1;
  let last = 0;
  let raf = 0;
  let running = false;
  let visible = false;
  let started = false;
  let disposed = false;
  const offset = new THREE.Vector3();

  function frame(now: number) {
    raf = 0;
    if (disposed) return;
    const t = reduced ? 1e6 : born < 0 ? 0 : now - born;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    const f = focusI();
    for (const it of items) {
      const u = started ? clamp01((t - it.start) / (it.kind === "podium" ? 620 : 420)) : 0;
      const active = ready && it.i === f;
      it.pull += ((active ? 1 : 0) - it.pull) * (1 - Math.exp(-dt * 10));
      if (it.kind === "podium") {
        it.group.scale.y = Math.max(0.001, backOut(u));
        it.group.position.y = it.pull * 0.12;
        const cu = started ? clamp01((t - it.start - 420) / 520) : 0;
        it.cup!.scale.setScalar(Math.max(0.001, backOut(cu)));
        if (!reduced) it.cup!.rotation.y += dt * (0.35 + it.pull * 2.2);
      } else {
        const fall = u * u;
        const drop = (1 - fall) * 7.5;
        const settle = u >= 1 ? Math.max(0, 1 - (t - it.start - 420) / 220) : 0;
        const b = it.base!;
        it.group.position.set(b.x, b.y + drop - Math.sin(settle * Math.PI) * 0.05 + it.pull * 0.04, b.z + it.pull * 1.05);
        it.group.rotation.y = it.yaw! * (1 - it.pull);
        it.group.visible = started && t >= it.start;
      }
    }
    if (started && !ready && t > READY_MS) {
      ready = true;
      emitFocus();
    }
    if (!reduced) {
      offset.set(parallax.x * 0.9, -parallax.y * 0.5, 0).add(baseCam);
      camera.position.lerp(offset, 1 - Math.exp(-dt * 3));
      camera.lookAt(target);
    }
    renderer.render(scene, camera);
    // Reduced motion: once settled, draw on demand only.
    // Before start() there is nothing to animate (one empty frame was drawn).
    const keepGoing =
      started &&
      visible &&
      !document.hidden &&
      (!reduced || items.some((it) => Math.abs((ready && it.i === f ? 1 : 0) - it.pull) > 1e-3));
    if (keepGoing) raf = requestAnimationFrame(frame);
    else running = false;
  }
  function wake() {
    if (running || disposed || !visible || document.hidden) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  const io = new IntersectionObserver((es) => {
    visible = es.some((e) => e.isIntersecting);
    wake();
  });
  io.observe(host);
  const ro = new ResizeObserver(() => layout());
  ro.observe(host);
  const onVis = () => wake();
  document.addEventListener("visibilitychange", onVis);
  // Reduced motion wakes on input too (the loop parks when settled).
  const wakeOnInput = () => wake();
  canvas.addEventListener("pointermove", wakeOnInput);
  canvas.addEventListener("keydown", wakeOnInput);
  canvas.addEventListener("click", wakeOnInput);
  layout();

  return {
    start() {
      if (started || disposed) return;
      started = true;
      born = performance.now();
      if (reduced) {
        ready = true;
        emitFocus();
      }
      wake();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("keydown", onKey);
      canvas.removeEventListener("pointermove", wakeOnInput);
      canvas.removeEventListener("keydown", wakeOnInput);
      canvas.removeEventListener("click", wakeOnInput);
      setCursor(false);
      for (const d of disposables) d.dispose();
      for (const it of items) it.group.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).dispose());
      renderer.dispose();
      canvas.remove();
    },
  };
}
