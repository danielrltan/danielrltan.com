/**
 * The signature hero (owner brief 2026-10-09, after haoqi.design's glass
 * "hello"): Daniel's captured signature as an inflated 3D tube over the glyph
 * field, pushed around by a cursor-driven fluid.
 *
 * Passes per frame, all into one canvas:
 *   1. field   -> bgRT: glyph tiles (FIELD_FRAG). The fluid swirls which glyph
 *                 each cell prints; a huge tilted copy of the signature is
 *                 carved in; uLight lights a spot of that copy.
 *   2. tubes   -> sigRT (MSAA): the signature, refracting bgRT behind it.
 *   3. comp    -> canvas: field + signature, the signature smeared by the flow.
 *   4. props   -> canvas: the hobby GLBs on top (props.ts), sparks on a 2D
 *                 canvas above.
 *
 * The light: during the opening draw-on it rides the pen tip; afterwards it
 * MIRRORS the cursor: wherever the pointer sits relative to the 3D signature
 * (anywhere over or near it, not only on a stroke), the same place on the big
 * background copy lights up.
 */
import * as THREE from "three";
import { Fluid } from "./fluid";
import { HeroProps } from "./props";
import { COMP_FRAG, FIELD_FRAG, QUAD_VERT, SIG_FRAG, SIG_VERT } from "./shaders";
import { SIG_CENTER_Y, signatureBox, sigHeightFrac, type SigBox } from "./layout";
import { eventsToStrokes, type SignatureData } from "../signatureGeometry";

const CELL_PX = 15; // the old ring's 10 px cell, x1.5 (owner)
const TUBE_R = 0.05; // of the signature's height
const RADIAL = 20;
const TIME_SCALE = 0.48; // real pen timing, compressed (~1.65 s total)
const DRAW_DELAY = 250; // ms after start()
const SPOT_MARGIN = 0.5; // signature heights of spotlight falloff past its box

// Raw sRGB triples for the ShaderMaterials (they skip three's colour chunks, so
// no THREE.Color: that would linearise them; colour management stays on for
// the rest of the site's scenes).
const hex = (h: string) =>
  new THREE.Vector3(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

interface Stroke {
  curve: THREE.CatmullRomCurve3;
  segments: number;
  fracs: number[];
  times: number[];
  t0: number;
  t1: number;
  mesh: THREE.Mesh;
  head: THREE.Mesh;
  tail: THREE.Mesh;
}

/** Signature points [nx, ny, t] per stroke (nx/ny 0..1 within its bounds, y down). */
type RawStroke = Array<[number, number, number]>;

function fracAtTime(s: Stroke, t: number): number {
  if (t <= s.t0) return 0;
  if (t >= s.t1) return 1;
  let i = 1;
  while (i < s.times.length && s.times[i]! < t) i++;
  const a = s.times[i - 1]!;
  const b = s.times[i]!;
  const k = b > a ? (t - a) / (b - a) : 1;
  return s.fracs[i - 1]! + (s.fracs[i]! - s.fracs[i - 1]!) * k;
}

export interface SignatureHeroOptions {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  data: SignatureData;
  coarse: boolean;
  /** Where the signature landed (px, hero coords): the words + iris guard. */
  onLayout: (box: SigBox) => void;
  /** False while the hero is covered / scrolled off: skip all GPU work. */
  shouldRender: () => boolean;
  /** False once you leave the resting hero: no pointer effects or grabs. */
  isActive: () => boolean;
}

export class SignatureHero {
  private readonly o: SignatureHeroOptions;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly dpr: number;
  private readonly aspect: number;
  private readonly raw: RawStroke[];
  private readonly strokes: Stroke[];
  private readonly drawEnd: number;
  private readonly fsScene = new THREE.Scene();
  private readonly fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly fsQuad: THREE.Mesh;
  private readonly fieldMat: THREE.ShaderMaterial;
  private readonly sigMat: THREE.ShaderMaterial;
  private readonly compMat: THREE.ShaderMaterial;
  private readonly sigScene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  private readonly group = new THREE.Group();
  private readonly capGeom: THREE.SphereGeometry;
  private readonly fluid: Fluid;
  private readonly props: HeroProps;
  private readonly bgSigCanvas = document.createElement("canvas");
  private readonly bgSigTex: THREE.CanvasTexture;
  private readonly bgSigXf = { cw: 1, ch: 1, sw: 1, sh: 1, cx: 0, cy: 0, rot: 0 };
  private bgRT: THREE.WebGLRenderTarget | null = null;
  private sigRT: THREE.WebGLRenderTarget | null = null;
  private W = 1;
  private H = 1;
  private baseY = 0;
  private readonly pointer = { x: 0, y: 0, tx: 0, ty: 0, u: 0.5, v: 0.5, inside: false, last: null as { u: number; v: number; t: number } | null };
  private readonly light = { u: 0.5, v: 0.5, k: 0 };
  private t0 = -1;
  private prev = 0;
  private raf = 0;
  private readonly off: Array<() => void> = [];
  private readonly ray = new THREE.Raycaster();
  private readonly plane = new THREE.Plane();
  private readonly v3 = new THREE.Vector3();
  private readonly n3 = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();

  constructor(o: SignatureHeroOptions) {
    this.o = o;
    this.renderer = new THREE.WebGLRenderer({ canvas: o.canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    // Only the GLB props (drawn straight to the canvas, last) use three's colour
    // chunks; the raw ShaderMaterials never include them.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.dpr = Math.min(window.devicePixelRatio || 1, o.coarse ? 1.25 : 1.5);
    this.renderer.setPixelRatio(this.dpr);

    // Signature data -> strokes in signature space (height 1, y up, centred).
    const b = o.data.bounds ?? { minX: 0, minY: 0, maxX: 1000, maxY: 384 };
    this.aspect = (b.maxX - b.minX) / Math.max(1, b.maxY - b.minY);
    this.raw = eventsToStrokes(o.data.events).map((s) => s.points.map((p): [number, number, number] => [p.x, p.y, p.t]));

    this.fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.fsQuad.frustumCulled = false;
    this.fsScene.add(this.fsQuad);

    this.bgSigTex = new THREE.CanvasTexture(this.bgSigCanvas);
    this.bgSigTex.minFilter = this.bgSigTex.magFilter = THREE.LinearFilter;
    this.bgSigTex.generateMipmaps = false;

    this.fieldMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: FIELD_FRAG,
      uniforms: {
        uGrid: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uTileCount: { value: 8 },
        uFieldBase: { value: hex("#ff4f00") },
        uFieldBlob: { value: hex("#ff7a3c") },
        uVel: { value: null },
        uSwirl: { value: 0.065 },
        uDye: { value: null },
        uBgSig: { value: this.bgSigTex },
        uBgSigAmt: { value: 0.75 },
        uSigTone: { value: hex("#ffa679") },
        uLight: { value: new THREE.Vector3(0.5, 0.5, 0) },
        uLightR: { value: 0.22 },
        uAspect: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.sigMat = new THREE.ShaderMaterial({
      vertexShader: SIG_VERT,
      fragmentShader: SIG_FRAG,
      uniforms: {
        uBg: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uRefract: { value: 0.035 },
        uInk: { value: 0.95 },
        uTop: { value: hex("#ffffff") },
        uBottom: { value: hex("#fff3ea") },
        uFloor: { value: hex("#ff7a3c") },
        uDeep: { value: hex("#c23d00") },
      },
    });
    this.compMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT,
      fragmentShader: COMP_FRAG,
      uniforms: {
        uBg: { value: null },
        uSig: { value: null },
        uVel: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uWarp: { value: 0.045 },
        uSplit: { value: 0.35 },
      },
      depthTest: false,
      depthWrite: false,
    });

    // Tubes.
    this.camera.position.set(0, 0, 6);
    this.sigScene.add(this.group);
    this.capGeom = new THREE.SphereGeometry(TUBE_R, RADIAL, 12);
    this.strokes = this.raw.map((r, i) => this.buildStroke(r, i));
    this.drawEnd = Math.max(0, ...this.strokes.map((s) => s.t1));
    this.setDraw(-1);

    this.fluid = new Fluid(this.renderer, { res: o.coarse ? 96 : 144, iterations: o.coarse ? 4 : 8, dissipation: 0.9, dyeDissipation: 0.75 });
    this.props = new HeroProps({ renderer: this.renderer, host: o.host, fluid: this.fluid, coarse: o.coarse, isActive: o.isActive });

    this.layout();
    this.listen();
    // Probe for the acceptance scripts (like window.__hobbies / __knobAnchor).
    (window as unknown as Record<string, unknown>).__sigHero = {
      light: this.light,
      target: this.target,
      maskAt: (u: number, v: number) => {
        const g = this.bgSigCanvas.getContext("2d");
        if (!g) return 0;
        const x = Math.round(u * this.bgSigCanvas.width);
        const y = Math.round((1 - v) * this.bgSigCanvas.height);
        return g.getImageData(x, y, 1, 1).data[0]! / 255;
      },
    };
  }
  /** Where the light is heading this frame (field uv), for the probe. */
  private readonly target = { u: 0, v: 0, tip: false, s: -1, f: 0 };

  // ---- geometry ---------------------------------------------------------------
  private buildStroke(raw: RawStroke, index: number): Stroke {
    const A = this.aspect;
    let pts = raw.map(([nx, ny, t]) => ({ p: new THREE.Vector3((nx - 0.5) * A, 0.5 - ny, 0), t }));
    // Drop near-duplicates (pen jitter), then a light 3-tap smooth that keeps the ends.
    const kept = [pts[0]!];
    for (const q of pts.slice(1)) if (q.p.distanceTo(kept[kept.length - 1]!.p) > 0.006) kept.push(q);
    if (kept.length < 2) kept.push(pts[pts.length - 1]!);
    pts = kept.map((q, i, a) => {
      if (i === 0 || i === a.length - 1) return q;
      const p = a[i - 1]!.p.clone().add(q.p.clone().multiplyScalar(2)).add(a[i + 1]!.p).multiplyScalar(0.25);
      return { p, t: q.t };
    });
    // Lift each stroke a touch in z so crossings of different strokes sit apart.
    pts.forEach((q) => (q.p.z = 0.012 * index));

    const curve = new THREE.CatmullRomCurve3(pts.map((q) => q.p), false, "centripetal");
    const segments = Math.max(4, Math.ceil(curve.getLength() / 0.0065));
    const geom = new THREE.TubeGeometry(curve, segments, TUBE_R, RADIAL, false);

    // Arc fraction <-> time table from the polyline (close to the curve's own arc).
    const fr = [0];
    for (let i = 1; i < pts.length; i++) fr.push(fr[i - 1]! + pts[i]!.p.distanceTo(pts[i - 1]!.p));
    const total = fr[fr.length - 1] || 1;
    const times = pts.map((q) => q.t * TIME_SCALE);
    const mesh = new THREE.Mesh(geom, this.sigMat);
    const head = new THREE.Mesh(this.capGeom, this.sigMat);
    const tail = new THREE.Mesh(this.capGeom, this.sigMat);
    head.position.copy(curve.getPointAt(0));
    this.group.add(mesh, head, tail);
    return {
      curve, segments, fracs: fr.map((f) => f / total), times,
      t0: times[0]!, t1: times[times.length - 1]!, mesh, head, tail,
    };
  }

  /** Draw-on: each stroke's tube grows along its length with the real pen timing. */
  private setDraw(tMs: number): void {
    for (const s of this.strokes) {
      const f = fracAtTime(s, tMs);
      const started = tMs >= s.t0;
      const n = Math.floor(f * s.segments);
      s.mesh.visible = started && f > 0;
      s.head.visible = started;
      s.tail.visible = started;
      s.mesh.geometry.setDrawRange(0, n * RADIAL * 6);
      s.tail.position.copy(s.curve.getPointAt(Math.min(1, n / s.segments)));
    }
  }

  // ---- background signature (huge, tilted, carved into the field) ------------
  private drawBgSig(): void {
    const S = 4; // texels per glyph cell
    const cw = Math.ceil((this.W / CELL_PX) * S);
    const ch = Math.ceil((this.H / CELL_PX) * S);
    this.bgSigCanvas.width = cw;
    this.bgSigCanvas.height = ch;
    const g = this.bgSigCanvas.getContext("2d");
    if (!g) return;
    g.fillStyle = "#000";
    g.fillRect(0, 0, cw, ch);
    const sw = Math.max(cw, ch * 1.4) * 1.4; // signature width in mask px
    const sh = sw / this.aspect;
    // Centred behind the front signature, so the light lands on its strokes.
    Object.assign(this.bgSigXf, { cw, ch, sw, sh, cx: cw * 0.5, cy: ch * (0.5 - SIG_CENTER_Y), rot: -0.12 });
    g.save();
    g.translate(this.bgSigXf.cx, this.bgSigXf.cy);
    g.rotate(this.bgSigXf.rot);
    g.strokeStyle = "#fff";
    g.lineCap = g.lineJoin = "round";
    g.lineWidth = sh * 0.045;
    // Trace the tubes' OWN curves (smoothed, the path the pen tip follows), not
    // the raw capture, so the opening trace light lands exactly on this copy.
    for (const st of this.strokes) {
      g.beginPath();
      st.curve.getSpacedPoints(Math.max(32, st.segments)).forEach((q, i) => {
        const x = (q.x / this.aspect) * sw;
        const y = -q.y * sh;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      });
      g.stroke();
    }
    g.restore();
    this.bgSigTex.needsUpdate = true;
  }

  /** Field uv of signature point (nx, ny) on the big background copy. */
  private bgSigUv(nx: number, ny: number): [number, number] {
    const xf = this.bgSigXf;
    const x = (nx - 0.5) * xf.sw;
    const y = (ny - 0.5) * xf.sh;
    const c = Math.cos(xf.rot);
    const s = Math.sin(xf.rot);
    return [(xf.cx + x * c - y * s) / xf.cw, 1 - (xf.cy + x * s + y * c) / xf.ch];
  }

  // ---- layout -------------------------------------------------------------------
  layout = (): void => {
    const W = Math.max(1, this.o.host.clientWidth);
    const H = Math.max(1, this.o.host.clientHeight);
    this.W = W;
    this.H = H;
    this.renderer.setSize(W, H, false);
    const pw = Math.round(W * this.dpr);
    const ph = Math.round(H * this.dpr);
    this.bgRT?.dispose();
    this.sigRT?.dispose();
    this.bgRT = new THREE.WebGLRenderTarget(pw, ph, { depthBuffer: false });
    this.sigRT = new THREE.WebGLRenderTarget(pw, ph, { samples: 4 });
    const fu = this.fieldMat.uniforms;
    (fu.uGrid!.value as THREE.Vector2).set(W / CELL_PX, H / CELL_PX);
    fu.uAspect!.value = W / H;
    this.drawBgSig();
    this.props.resize(W, H);
    this.sigMat.uniforms.uBg!.value = this.bgRT.texture;
    (this.sigMat.uniforms.uRes!.value as THREE.Vector2).set(pw, ph);
    this.compMat.uniforms.uBg!.value = this.bgRT.texture;
    this.compMat.uniforms.uSig!.value = this.sigRT.texture;
    this.fluid.resize(W / H);
    (this.compMat.uniforms.uTexel!.value as THREE.Vector2).copy(this.fluid.texel);

    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    const visH = 2 * this.camera.position.z * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.group.scale.setScalar(sigHeightFrac(W, H, this.aspect) * visH);
    this.baseY = SIG_CENTER_Y * visH;
    this.o.onLayout(signatureBox(W, H, this.aspect));
  };

  // ---- pointer --------------------------------------------------------------------
  private listen(): void {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opt?: AddEventListenerOptions) => {
      window.addEventListener(type, fn as EventListener, opt);
      this.off.push(() => window.removeEventListener(type, fn as EventListener, opt));
    };
    on("pointermove", (e) => this.onMove(e.clientX, e.clientY), { passive: true });
    on("touchmove", (e) => {
      const t = e.touches[0];
      if (t) this.onMove(t.clientX, t.clientY);
    }, { passive: true });
    on("touchend", () => (this.pointer.last = null), { passive: true });
    on("resize", this.layout, { passive: true });
    const ro = new ResizeObserver(() => this.layout());
    ro.observe(this.o.host);
    this.off.push(() => ro.disconnect());
  }

  /** Splat flow from the pointer's motion; it also drives parallax + tilt. */
  private onMove(clientX: number, clientY: number): void {
    const p = this.pointer;
    const r = this.o.host.getBoundingClientRect();
    const u = (clientX - r.left) / r.width;
    const v = 1 - (clientY - r.top) / r.height;
    if (!this.o.isActive() || u < 0 || u > 1 || v < 0 || v > 1) {
      p.last = null;
      p.inside = false;
      return;
    }
    p.u = u;
    p.v = v;
    p.inside = true;
    p.tx = u * 2 - 1;
    p.ty = v * 2 - 1;
    const now = performance.now();
    if (p.last) {
      const dt = Math.max(8, now - p.last.t) / 1000;
      const dx = (u - p.last.u) / dt;
      const dy = (v - p.last.v) / dt;
      // Texels/s of the sim grid, capped so a flick doesn't tear the field.
      const k = this.fluid.res * 0.4;
      const cap = 1500;
      const fx = THREE.MathUtils.clamp(dx * k * (this.W / this.H), -cap, cap);
      const fy = THREE.MathUtils.clamp(dy * k, -cap, cap);
      const ink = Math.min(0.9, Math.hypot(dx, dy * (this.H / this.W)) * 0.6);
      if (Math.abs(fx) + Math.abs(fy) > 1) this.fluid.splat(u, v, fx, fy, this.o.coarse ? 0.0028 : 0.0013, ink);
    }
    p.last = { u, v, t: now };
  }

  // ---- light ------------------------------------------------------------------------
  /** Cursor cast onto the signature's plane -> [nx, ny, strength] (strength 1
   *  inside the signature's box, easing to 0 SPOT_MARGIN outside), or null. */
  private onSignatureArea(u: number, v: number): [number, number, number] | null {
    const g = this.group;
    g.updateMatrixWorld();
    this.n3.set(0, 0, 1).transformDirection(g.matrixWorld);
    this.plane.setFromNormalAndCoplanarPoint(this.n3, this.v3.setFromMatrixPosition(g.matrixWorld));
    this.ray.setFromCamera(this.ndc.set(u * 2 - 1, v * 2 - 1), this.camera);
    if (!this.ray.ray.intersectPlane(this.plane, this.v3)) return null;
    const local = g.worldToLocal(this.v3);
    const nx = local.x / this.aspect + 0.5;
    const ny = 0.5 - local.y;
    const out = Math.hypot(Math.max(0, -nx, nx - 1) * this.aspect, Math.max(0, -ny, ny - 1));
    if (out >= SPOT_MARGIN) return null;
    const k = 1 - out / SPOT_MARGIN;
    return [nx, ny, k * k * (3 - 2 * k)];
  }

  /** The pen tip while a stroke is being drawn in; null while the pen is up
   *  (between strokes, the light fades and snaps on where the next starts). */
  private drawTip(drawMs: number): [number, number] | null {
    if (drawMs < 0 || drawMs > this.drawEnd) return null;
    for (let i = 0; i < this.strokes.length; i++) {
      const s = this.strokes[i]!;
      if (drawMs < s.t0 || drawMs > s.t1) continue;
      const f = fracAtTime(s, drawMs);
      this.target.s = i;
      this.target.f = f;
      const q = s.curve.getPointAt(f);
      return [q.x / this.aspect + 0.5, 0.5 - q.y];
    }
    return null;
  }

  private updateLight(dt: number, drawMs: number): void {
    const tip = this.drawTip(drawMs);
    const p = this.pointer;
    const hit: [number, number, number] | null = tip
      ? [tip[0], tip[1], 1]
      : p.inside && this.o.isActive()
        ? this.onSignatureArea(p.u, p.v)
        : null;
    const L = this.light;
    this.target.tip = !!tip;
    const want = hit ? hit[2] : 0;
    // The opening trace is ON at once and sits exactly on the pen tip (any
    // easing trailed it by ~120 px on the big copy); the cursor light eases.
    if (tip) L.k = 1;
    else L.k += (want - L.k) * (1 - Math.exp(-dt * (want > L.k ? 7 : 2.2)));
    if (hit) {
      const [tu, tv] = this.bgSigUv(hit[0], hit[1]);
      Object.assign(this.target, { u: tu, v: tv, tip: !!tip });
      const f = tip || L.k < 0.05 ? 1 : 1 - Math.exp(-dt * 14);
      L.u += (tu - L.u) * f;
      L.v += (tv - L.v) * f;
    }
    (this.fieldMat.uniforms.uLight!.value as THREE.Vector3).set(L.u, L.v, L.k);
  }

  // ---- loop -------------------------------------------------------------------------
  private blit(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget | null): void {
    this.fsQuad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.fsScene, this.fsCam);
  }

  /** Begin the draw-on (the loader has lifted). */
  start(): void {
    if (this.t0 >= 0) return;
    this.t0 = performance.now();
    this.prev = this.t0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.prev) / 1000);
    this.prev = now;
    if (!this.o.shouldRender()) return;
    const t = (now - this.t0) / 1000;
    const drawMs = now - this.t0 - DRAW_DELAY;
    this.setDraw(drawMs);

    // Eased pointer (lagged parallax), centred again once you leave the hero.
    const p = this.pointer;
    if (!this.o.isActive()) {
      p.tx = 0;
      p.ty = 0;
      p.inside = false;
    }
    const lag = 1 - Math.exp(-dt * 5);
    p.x += (p.tx - p.x) * lag;
    p.y += (p.ty - p.y) * lag;
    const settle = Math.min(1, Math.max(0, (drawMs - this.drawEnd) / 900));
    const g = this.group;
    g.rotation.y = Math.sin(t * 0.45) * 0.07 * settle + p.x * 0.22;
    g.rotation.x = Math.sin(t * 0.33) * 0.03 * settle - p.y * 0.14;
    g.position.y = this.baseY + Math.sin(t * 0.8) * 0.025 * settle;
    this.camera.position.x = p.x * 0.35;
    this.camera.position.y = p.y * 0.22;
    this.camera.lookAt(0, this.baseY * 0.5, 0);

    this.props.update(dt, t);
    this.updateLight(dt, drawMs);
    this.fluid.step(dt);
    const fu = this.fieldMat.uniforms;
    fu.uTime!.value = t;
    fu.uVel!.value = this.fluid.velocity;
    fu.uDye!.value = this.fluid.dye;
    this.compMat.uniforms.uVel!.value = this.fluid.velocity;

    const r = this.renderer;
    this.blit(this.fieldMat, this.bgRT);
    r.setRenderTarget(this.sigRT);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.sigScene, this.camera);
    this.blit(this.compMat, null);
    r.autoClear = false;
    r.clearDepth();
    this.props.render(r);
    r.autoClear = true;
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.off.forEach((f) => f());
    this.props.dispose();
    this.fluid.dispose();
    this.bgRT?.dispose();
    this.sigRT?.dispose();
    this.bgSigTex.dispose();
    for (const s of this.strokes) s.mesh.geometry.dispose();
    this.capGeom.dispose();
    this.fsQuad.geometry.dispose();
    for (const m of [this.fieldMat, this.sigMat, this.compMat]) m.dispose();
    this.renderer.dispose();
  }
}
