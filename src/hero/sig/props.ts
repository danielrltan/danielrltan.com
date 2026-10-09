/**
 * Hobby props over the hero: the Play section's ten GLBs (src/other/hobbies.ts)
 * drifting in zero-g. Screen-space circle physics: slow wander, bounce off the
 * edges and each other, grab + throw with the hand's real release velocity, a
 * small springy pop on hover (the custom cursor pops too: body cursor
 * "pointer", the same signal the Mac / keypad canvases use). Hits throw a few
 * tapered sparks (the keypad knob's spark shape); a hard throw leaves a faint
 * glyph wake in the field via the fluid.
 *
 * Owner tuning (2026-10-09): hover kept small (no ripple, pop 1.08); light
 * flicks must stay light: a held body's velocity is its SMOOTHED motion (a
 * per-frame displacement made hand twitches register as thousands of px/s and
 * blast neighbours), and the release is a least-squares fit of the last
 * 100 ms of the hand, 1:1, then plain air drag.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { HOBBIES } from "../../other/hobbies";
import type { Fluid } from "./fluid";

const DRIFT = 16; // px/s the wander settles to
const MAX_SPEED = 2200; // px/s: about the fastest flick a hand makes; also the per-frame ceiling
const RESTITUTION = 0.6;
const HOVER_POP = 1.08;
const SPARK_MIN = 140; // px/s of impact before anything sparks

interface Body {
  file: string;
  i: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  wander: number;
  wanderRate: number;
  axis: THREE.Vector3;
  spin: number;
  extraSpin: number;
  scale: number;
  pop: number;
  popV: number;
  wob: number;
  wobV: number;
  held: boolean;
  hovered: boolean;
  ready: boolean;
  appearAt: number;
  grabDX: number;
  grabDY: number;
  pivot: THREE.Group;
  inner: THREE.Group;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  len: number;
  w: number;
}

interface Sample {
  x: number;
  y: number;
  t: number;
}

function seeded(seed: number): () => number {
  let s = seed * 9301 + 49297;
  return () => (s = (s * 9301 + 49297) % 233280) / 233280;
}

/** The car GLB is an open shell (no floor), which shows when it tumbles. Close
 *  it with a floor pan in the mesh's own frame (+z = down there): the paint's
 *  lowest edge sits at z ~0.25, the tyres reach 0.29. */
function addCarFloor(obj: THREE.Object3D): void {
  const mesh = obj.getObjectByProperty("isMesh", true);
  if (!mesh?.parent) return;
  let metal: THREE.MeshStandardMaterial | null = null;
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!metal && m && !Array.isArray(m) && m.name === "Metal") metal = m;
  });
  const mat = ((metal as THREE.MeshStandardMaterial | null) ?? new THREE.MeshStandardMaterial()).clone();
  mat.color.set(0x262626);
  mat.roughness = 0.55;
  mat.side = THREE.DoubleSide;
  const pan = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.86, 0.02), mat);
  pan.position.set(0, 0, 0.245);
  // A darker centre tunnel so the floor reads as a chassis, not a lid.
  const tunnelMat = mat.clone();
  tunnelMat.color.set(0x171717);
  const tunnel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.5, 0.03), tunnelMat);
  tunnel.position.set(0, -0.05, 0.255);
  mesh.parent.add(pan, tunnel);
}

export interface PropsOptions {
  renderer: THREE.WebGLRenderer;
  host: HTMLElement;
  fluid: Fluid;
  coarse: boolean;
  /** False while the hero isn't the resting screen: no hover, no grabs. */
  isActive: () => boolean;
}

export class HeroProps {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private readonly bodies: Body[] = [];
  private readonly sparks: Spark[] = [];
  private readonly sparkCanvas: HTMLCanvasElement;
  private readonly sctx: CanvasRenderingContext2D | null;
  private readonly envTex: THREE.Texture;
  private readonly ptr = { x: -1e4, y: -1e4, inside: false, history: [] as Sample[] };
  private held: Body | null = null;
  private hovered: Body | null = null;
  private cursorSet = false;
  private W = 1;
  private H = 1;
  private pxToWorld = 1;
  private R = 50;
  private disposed = false;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly off: Array<() => void> = [];
  private readonly opts: PropsOptions;

  constructor(opts: PropsOptions) {
    this.opts = opts;
    const { renderer, host } = opts;
    this.camera.position.set(0, 0, 10);
    const pm = new THREE.PMREMGenerator(renderer);
    this.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = 0.45;
    // The Play section's own rig: white key, cool fill, orange kickers from below.
    this.scene.add(new THREE.AmbientLight("#eef1f4", 0.5));
    const light = (c: string, i: number, x: number, y: number, z: number) => {
      const l = new THREE.DirectionalLight(c, i);
      l.position.set(x, y, z);
      this.scene.add(l);
    };
    light("#ffffff", 2.7, 4, 6, 4);
    light("#d7dde3", 0.8, -5, 3, 2);
    light("#ff4f00", 1.1, -2, -1, -5);
    light("#ff6a2a", 0.35, 3, -4, 2);

    // All ten, in a fresh random order so the spawn ring differs per load.
    const files = HOBBIES.map((h) => h.file);
    for (let i = files.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [files[i], files[j]] = [files[j]!, files[i]!];
    }
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    files.forEach((file, i) => {
      const r = seeded(i + 3);
      const body: Body = {
        file, i, x: 0, y: 0, vx: 0, vy: 0,
        wander: r() * 6.28, wanderRate: 0.25 + r() * 0.3,
        axis: new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(),
        spin: 0.25 + r() * 0.35, extraSpin: 0,
        scale: 0, pop: 1, popV: 0, wob: 0, wobV: 0,
        held: false, hovered: false, ready: false,
        appearAt: 0.15 * i, grabDX: 0, grabDY: 0,
        pivot: new THREE.Group(), inner: new THREE.Group(),
      };
      body.pivot.add(body.inner);
      body.pivot.visible = false;
      body.inner.quaternion.setFromEuler(new THREE.Euler((r() - 0.5) * 1.2, (r() - 0.5) * 2, (r() - 0.5) * 1.2));
      this.scene.add(body.pivot);
      this.bodies.push(body);
      loader.load(`/hobbies/${file}`, (gltf) => {
        if (this.disposed) return;
        const obj = gltf.scene;
        // Same normalisation as HobbiesScene: unit bounding sphere, centred.
        const box = new THREE.Box3().setFromObject(obj);
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const k = sphere.radius > 0 ? 1 / sphere.radius : 1;
        obj.scale.setScalar(k);
        obj.position.copy(box.getCenter(new THREE.Vector3()).multiplyScalar(-k));
        obj.traverse((o) => {
          const m = (o as THREE.Mesh).material;
          if (!m) return;
          for (const mm of Array.isArray(m) ? m : [m]) {
            const sm = mm as THREE.MeshStandardMaterial;
            if (sm.isMeshStandardMaterial) sm.roughness = Math.min(sm.roughness ?? 0.5, 0.34);
          }
        });
        if (file === "car.glb") addCarFloor(obj);
        body.inner.add(obj);
        body.ready = true;
      });
    });

    // Sparks: a 2D canvas over the WebGL one (the props draw last on that).
    this.sparkCanvas = document.createElement("canvas");
    this.sparkCanvas.className = "hero-sig-sparks";
    this.sparkCanvas.setAttribute("aria-hidden", "true");
    host.appendChild(this.sparkCanvas);
    this.sctx = this.sparkCanvas.getContext("2d");

    this.listen();
  }

  // ---- pointer: hover, grab, throw -----------------------------------------
  private listen(): void {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, o?: AddEventListenerOptions) => {
      window.addEventListener(type, fn as EventListener, o);
      this.off.push(() => window.removeEventListener(type, fn as EventListener, o));
    };
    const local = (cx: number, cy: number) => {
      const r = this.opts.host.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top, inside: cy >= r.top && cy <= r.bottom };
    };
    on("pointermove", (e) => {
      const p = local(e.clientX, e.clientY);
      this.ptr.inside = p.inside;
      this.track(p.x, p.y);
    }, { passive: true });
    on("pointerdown", (e) => {
      if (e.pointerType === "touch" || e.button !== 0) return; // touch: touchstart (it can block scroll)
      const p = local(e.clientX, e.clientY);
      if (p.inside && this.grab(p.x, p.y)) {
        e.preventDefault();
        this.swallowClick();
      }
    });
    on("pointerup", () => this.release());
    on("pointercancel", () => this.release());
    on("blur", () => this.release());
    // Touch: only a touch that lands ON a prop stops the page scrolling.
    on("touchstart", (e) => {
      const t = e.touches[0];
      if (!t || e.touches.length > 1) return;
      const p = local(t.clientX, t.clientY);
      if (p.inside && this.grab(p.x, p.y)) e.preventDefault();
    }, { passive: false });
    on("touchmove", (e) => {
      if (!this.held) return;
      e.preventDefault();
      const t = e.touches[0];
      if (t) {
        const p = local(t.clientX, t.clientY);
        this.track(p.x, p.y);
      }
    }, { passive: false });
    on("touchend", () => this.release());
  }

  /** The hero layer doesn't take pointer events, so a grab's click would land
   *  on whatever sits under it: eat the one click that ends this grab. */
  private swallowClick(): void {
    const eat = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("click", eat, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 600);
  }

  private track(x: number, y: number): void {
    const t = performance.now();
    this.ptr.x = x;
    this.ptr.y = y;
    const h = this.ptr.history;
    h.push({ x, y, t });
    while (h.length > 2 && t - h[0]!.t > 160) h.shift();
  }

  private pick(x: number, y: number): Body | null {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i]!;
      if (!b.ready || b.scale < 0.5) continue;
      if (Math.hypot(x - b.x, y - b.y) < this.R * b.pop * 1.05) return b;
    }
    return null;
  }

  private grab(x: number, y: number): boolean {
    if (!this.opts.isActive()) return false;
    const b = this.pick(x, y);
    if (!b) return false;
    this.held = b;
    b.held = true;
    b.grabDX = b.x - x;
    b.grabDY = b.y - y;
    b.popV += 2;
    this.ptr.history = [];
    this.track(x, y);
    return true;
  }

  private release(): void {
    const b = this.held;
    if (!b) return;
    // Release = the hand's real velocity: a least-squares line through the last
    // 100 ms of samples (one jittery sample can't spike it). A hand that had
    // stopped before letting go just drops the object.
    const now = performance.now();
    const h = this.ptr.history.filter((q) => now - q.t <= 100);
    let vx = 0;
    let vy = 0;
    const stale = !h.length || now - h[h.length - 1]!.t > 60;
    if (h.length >= 3 && !stale) {
      const t0 = h[0]!.t;
      let st = 0, sx = 0, sy = 0, stt = 0, stx = 0, sty = 0;
      for (const q of h) {
        const t = (q.t - t0) / 1000;
        st += t; sx += q.x; sy += q.y; stt += t * t; stx += t * q.x; sty += t * q.y;
      }
      const n = h.length;
      const den = n * stt - st * st;
      if (den > 1e-9) {
        vx = (n * stx - st * sx) / den;
        vy = (n * sty - st * sy) / den;
      }
    }
    const s = Math.hypot(vx, vy);
    if (s > MAX_SPEED) {
      vx *= MAX_SPEED / s;
      vy *= MAX_SPEED / s;
    }
    b.vx = vx;
    b.vy = vy;
    b.extraSpin = Math.min(8, s / 250);
    b.held = false;
    this.held = null;
  }

  // ---- collision sparks ------------------------------------------------------
  // Slight: 2-5 short tapered wedges shooting off along the contact's tangent,
  // white cooling to peach, ~0.25 s.
  private spark(x: number, y: number, nx: number, ny: number, impact: number): void {
    if (impact < SPARK_MIN) return;
    const n = Math.min(5, 2 + Math.floor((impact - SPARK_MIN) / 260));
    const tx = -ny;
    const ty = nx;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const a = (Math.random() - 0.5) * 0.9;
      const dx = tx * side * Math.cos(a) - nx * Math.abs(Math.sin(a)) * 0.6;
      const dy = ty * side * Math.cos(a) - ny * Math.abs(Math.sin(a)) * 0.6;
      const l = Math.hypot(dx, dy) || 1;
      const sp = 260 + Math.random() * 220 + Math.min(500, impact * 0.25);
      this.sparks.push({
        x, y, vx: (dx / l) * sp, vy: (dy / l) * sp, age: 0,
        life: 0.18 + Math.random() * 0.12, len: 10 + Math.random() * 8, w: 3 + Math.random() * 1.5,
      });
    }
    if (this.sparks.length > 80) this.sparks.splice(0, this.sparks.length - 80);
  }

  private drawSparks(dt: number): void {
    const g = this.sctx;
    if (!g) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.round(this.W * dpr);
    if (this.sparkCanvas.width !== cw) {
      this.sparkCanvas.width = cw;
      this.sparkCanvas.height = Math.round(this.H * dpr);
    }
    if (!this.sparks.length && !this.sparksDrawn) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    this.sparksDrawn = this.sparks.length > 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      s.age += dt;
      if (s.age >= s.life) {
        this.sparks.splice(i, 1);
        continue;
      }
      const k = s.age / s.life;
      const drag = Math.exp(-dt * 7);
      s.vx *= drag;
      s.vy *= drag;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const sp = Math.hypot(s.vx, s.vy) || 1;
      const ux = s.vx / sp;
      const uy = s.vy / sp;
      const len = s.len * (1 - k * 0.6);
      const w = s.w * (1 - k * 0.5);
      // Wedge: wide at the head, a point at the tail.
      g.beginPath();
      g.moveTo(s.x + uy * w * 0.5, s.y - ux * w * 0.5);
      g.lineTo(s.x - uy * w * 0.5, s.y + ux * w * 0.5);
      g.lineTo(s.x - ux * len, s.y - uy * len);
      g.closePath();
      g.globalAlpha = 1 - k * k;
      g.fillStyle = k < 0.35 ? "#ffffff" : "#ffd3b8";
      g.fill();
    }
    g.globalAlpha = 1;
  }
  private sparksDrawn = false;

  // ---- layout + simulation ---------------------------------------------------
  resize(w: number, h: number): void {
    const first = this.W === 1;
    this.W = w;
    this.H = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const visH = 2 * this.camera.position.z * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.pxToWorld = visH / h;
    this.R = Math.max(34, Math.min(w, h) * (this.opts.coarse ? 0.085 : 0.08));
    if (first) this.place();
    for (const b of this.bodies) {
      b.x = Math.min(w - this.R, Math.max(this.R, b.x));
      b.y = Math.min(h - this.R, Math.max(this.R, b.y));
    }
  }

  /** Spawn on a loose ring around the signature, so nothing starts on it. */
  private place(): void {
    const n = this.bodies.length;
    this.bodies.forEach((b, i) => {
      const a = (i / n) * Math.PI * 2 + 0.4;
      b.x = this.W / 2 + Math.cos(a) * this.W * 0.41;
      b.y = this.H / 2 + Math.sin(a) * this.H * 0.38;
      b.vx = Math.cos(b.wander) * DRIFT;
      b.vy = Math.sin(b.wander) * DRIFT;
    });
  }

  /** dt in s; t = seconds since the hero started drawing. */
  update(dt: number, t: number): void {
    const { W, H, R } = this;
    const active = this.opts.isActive();
    if (!active) this.release();

    // Hover: small pop + wobble; the custom cursor pops via body cursor.
    const over = this.held ?? (active && this.ptr.inside ? this.pick(this.ptr.x, this.ptr.y) : null);
    if (over !== this.hovered) {
      if (this.hovered) this.hovered.hovered = false;
      this.hovered = over;
      if (over) {
        over.hovered = true;
        over.popV += 1.5;
        over.wobV += 2.5;
      }
      this.setCursor(!!over);
    }

    for (const b of this.bodies) {
      if (!b.ready) continue;
      // Entrance: scale in, staggered, after the signature has started.
      const target = t > 1.1 + b.appearAt ? 1 : 0;
      b.scale += (target - b.scale) * (1 - Math.exp(-dt * 6));

      if (b.held) {
        const nx = this.ptr.x + b.grabDX;
        const ny = this.ptr.y + b.grabDY;
        const px = b.x;
        const py = b.y;
        b.x += (nx - b.x) * (1 - Math.exp(-dt * 30));
        b.y += (ny - b.y) * (1 - Math.exp(-dt * 30));
        const f = 1 - Math.exp(-dt * 8);
        b.vx += ((b.x - px) / Math.max(dt, 1 / 120) - b.vx) * f;
        b.vy += ((b.y - py) / Math.max(dt, 1 / 120) - b.vy) * f;
      } else {
        // Wander: steer gently toward a slowly turning heading. Thrown bodies
        // coast on plain air drag (~v/1.1 px); slow ones ease onto the drift.
        b.wander += Math.sin(t * b.wanderRate + b.i) * 0.6 * dt;
        const s = Math.hypot(b.vx, b.vy);
        const tx = Math.cos(b.wander) * DRIFT;
        const ty = Math.sin(b.wander) * DRIFT;
        const k = s > DRIFT * 2 ? 1 - Math.exp(-dt * 1.1) : 1 - Math.exp(-dt * 0.6);
        b.vx += (tx - b.vx) * k;
        b.vy += (ty - b.vy) * k;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        const r = R * b.pop;
        if (b.x < r) { this.spark(0, b.y, -1, 0, Math.abs(b.vx)); b.x = r; b.vx = Math.abs(b.vx) * RESTITUTION; b.wobV += Math.min(8, Math.abs(b.vx) / 120); }
        if (b.x > W - r) { this.spark(W, b.y, 1, 0, Math.abs(b.vx)); b.x = W - r; b.vx = -Math.abs(b.vx) * RESTITUTION; b.wobV += Math.min(8, Math.abs(b.vx) / 120); }
        if (b.y < r) { this.spark(b.x, 0, 0, -1, Math.abs(b.vy)); b.y = r; b.vy = Math.abs(b.vy) * RESTITUTION; b.wobV += Math.min(8, Math.abs(b.vy) / 120); }
        if (b.y > H - r) { this.spark(b.x, H, 0, 1, Math.abs(b.vy)); b.y = H - r; b.vy = -Math.abs(b.vy) * RESTITUTION; b.wobV += Math.min(8, Math.abs(b.vy) / 120); }
      }
      // A hard throw stirs the fluid along its path: a faint glyph wake.
      const sp = Math.hypot(b.vx, b.vy);
      if (!b.held && sp > 300) {
        const f = this.opts.fluid;
        f.splat(b.x / W, 1 - b.y / H, (b.vx / W) * f.res * 0.12 * (W / H), (-b.vy / H) * f.res * 0.12, this.opts.coarse ? 0.0012 : 0.0006, Math.min(0.45, sp / 3500));
      }

      // Springs: pop (hover/held scale) + wobble (squash on hits / hover).
      const popTarget = b.held ? HOVER_POP * 1.05 : b.hovered ? HOVER_POP : 1;
      b.popV += (popTarget - b.pop) * 220 * dt;
      b.popV *= Math.exp(-dt * 14);
      b.pop += b.popV * dt;
      b.wobV += -b.wob * 300 * dt;
      b.wobV *= Math.exp(-dt * 7);
      b.wob += b.wobV * dt;

      // Spin: idle tumble, plus whatever the throw put into it, decaying.
      b.extraSpin *= Math.exp(-dt * 1.2);
      this.tmpQ.setFromAxisAngle(b.axis, (b.spin + b.extraSpin) * dt);
      b.inner.quaternion.premultiply(this.tmpQ);
    }

    // Body-body collisions (equal mass), the held one pushing but not pushed.
    const bs = this.bodies;
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i]!;
        const c = bs[j]!;
        if (!a.ready || !c.ready || a.scale < 0.5 || c.scale < 0.5) continue;
        const dx = c.x - a.x;
        const dy = c.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const min = R * (a.pop + c.pop) * 0.92;
        if (d >= min) continue;
        const nx = dx / d;
        const ny = dy / d;
        const push = (min - d) * 0.5;
        if (!a.held) { a.x -= nx * push * (c.held ? 2 : 1); a.y -= ny * push * (c.held ? 2 : 1); }
        if (!c.held) { c.x += nx * push * (a.held ? 2 : 1); c.y += ny * push * (a.held ? 2 : 1); }
        const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = Math.min(1500, -(1 + RESTITUTION) * rel * 0.5);
          if (!a.held) { a.vx -= imp * nx; a.vy -= imp * ny; }
          if (!c.held) { c.vx += imp * nx; c.vy += imp * ny; }
          const hit = Math.min(8, Math.abs(rel) / 150);
          a.wobV += hit;
          c.wobV += hit;
          this.spark(a.x + nx * R * a.pop, a.y + ny * R * a.pop, nx, ny, Math.abs(rel));
        }
      }
    }

    for (const b of bs) {
      const spd = Math.hypot(b.vx, b.vy);
      if (spd > MAX_SPEED && !b.held) {
        b.vx *= MAX_SPEED / spd;
        b.vy *= MAX_SPEED / spd;
      }
      b.pivot.position.set((b.x - W / 2) * this.pxToWorld, -(b.y - H / 2) * this.pxToWorld, 0);
      const s = R * this.pxToWorld * b.pop * b.scale;
      b.pivot.scale.set(s * (1 + b.wob * 0.12), s * (1 - b.wob * 0.12), s);
      b.pivot.visible = b.ready && b.scale > 0.01;
    }
    this.drawSparks(dt);
  }

  private setCursor(on: boolean): void {
    if (on === this.cursorSet) return;
    this.cursorSet = on;
    document.body.style.cursor = on ? "pointer" : "";
  }

  render(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.off.forEach((f) => f());
    this.setCursor(false);
    this.sparkCanvas.remove();
    this.envTex.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
    });
  }
}
