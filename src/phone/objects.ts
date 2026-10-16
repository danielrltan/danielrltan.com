import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import keypadUrl from "../keypad/keypad.glb?url";
import { MAC_PROJECTS } from "../macintosh/projects";
import { HOBBIES } from "../other/hobbies";
import { SOCIALS } from "../socials";
import { track } from "../analytics";
import type { StageCtx, StageState, StationImpl, StationKey } from "./stage";

/*
 * The phone stage's stations after the hero: the room render on a card, the
 * Mac, the ten hobby props, a voxel podium and the keypad. Each one is built
 * well before its window arrives (never a stand-in), after the hero has
 * composed so the opening never shares the network or the GPU.
 */

type Mount = (key: StationKey, impl: StationImpl) => void;
interface Spring {
  x: number;
  v: number;
}
// Semi-implicit Euler in <= 1/120 s substeps (stable for the stiff ring even
// on a throttled 50 ms frame); snaps to rest so it can report it has stopped.
const spring = (s: Spring, target: number, dt: number, k = 120, c = 12) => {
  const n = Math.min(8, Math.ceil(dt * 120));
  for (let i = 0; i < n; i++) {
    s.v += ((target - s.x) * k - s.v * c) * (dt / n);
    s.x += s.v * (dt / n);
  }
  if (Math.abs(s.v) < 1e-4 && Math.abs(target - s.x) < 1e-4) {
    s.x = target;
    s.v = 0;
  }
  return s.x;
};
/** Still moving (not yet snapped to rest at its target)? */
const busy = (s: Spring, target: number) => s.v !== 0 || s.x !== target;
const EMAIL = "hello@danielrltan.com";

export function installObjects(ctx: StageCtx, mount: Mount): () => void {
  const { renderer, scene, camera, root, REDUCED } = ctx;
  let alive = true;
  const offs: Array<() => void> = [];
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const loadGLB = (url: string) => loader.loadAsync(url) as Promise<GLTF>;
  const loadTex = (url: string) => new THREE.TextureLoader().loadAsync(url);

  // Shared light rig: white key, cool fill (neutral: no coloured kicker, and
  // the key is low enough that no lit face clips past white).
  const pm = new THREE.PMREMGenerator(renderer);
  const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = 0.35;
  pm.dispose();
  scene.add(new THREE.AmbientLight("#eef1f4", 0.45));
  const key = new THREE.DirectionalLight("#ffffff", 1.8);
  key.position.set(4, 7, 5);
  const fill = new THREE.DirectionalLight("#d7dde3", 0.8);
  fill.position.set(-5, 3, 2);
  scene.add(key, fill);

  // Soft contact shadow (a blurred ellipse on its own plane).
  function shadowTex(rgb = "13,14,16", a = 0.34) {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, `rgba(${rgb},${a})`);
    gr.addColorStop(0.45, `rgba(${rgb},${a * 0.55})`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const SHADOW = shadowTex();
  function contactShadow(w: number, d: number, tex = SHADOW) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.renderOrder = -1;
    return m;
  }
  // Normalise a gltf scene to a bounding sphere of radius r, centred.
  function normalise(obj: THREE.Object3D, r = 1) {
    const box = new THREE.Box3().setFromObject(obj);
    const sph = box.getBoundingSphere(new THREE.Sphere());
    const k = sph.radius > 0 ? r / sph.radius : 1;
    obj.scale.setScalar(k);
    obj.position.copy(box.getCenter(new THREE.Vector3()).multiplyScalar(-k));
    const g = new THREE.Group();
    g.add(obj);
    return g;
  }
  const ray = new THREE.Raycaster();
  const win = (sel: string) => root.querySelector<HTMLElement>(sel)!;
  const docTop = (el: Element) => el.getBoundingClientRect().top + window.scrollY;

  // Builders run once each, once the hero has composed (or a failsafe).
  const built: Partial<Record<StationKey, boolean>> = {};
  const builders = {} as Record<StationKey, () => Promise<void>>;
  const want = (k: StationKey) => {
    if (built[k] || !alive) return;
    built[k] = true;
    builders[k]().catch((e) => console.error("[phone stage]", k, e));
  };
  const order: Array<[StationKey, string]> = [
    ["room", ".ph-room"],
    ["mac", ".ph-mac"],
    ["props", ".ph-play"],
    ["podium", ".ph-podium"],
    ["keypad", ".ph-keypad"],
  ];
  const scan = () => {
    for (const [k, sel] of order) if (!built[k] && win(sel).getBoundingClientRect().top < window.innerHeight * 6) want(k);
    if (order.every(([k]) => built[k])) window.removeEventListener("scroll", scan);
  };
  const composed = new Promise<void>((res) => {
    if (!document.documentElement.classList.contains("loading-active")) return res();
    window.addEventListener("hero-composed", () => res(), { once: true });
    setTimeout(res, 6000);
  });
  void composed.then(() => {
    if (!alive) return;
    want("room");
    scan();
    window.addEventListener("scroll", scan, { passive: true });
    offs.push(() => window.removeEventListener("scroll", scan));
    // Warm the Mac while the reader is still on the hero/about.
    const t = setTimeout(() => want("mac"), 900);
    offs.push(() => clearTimeout(t));
  });
  const mountIf = (k: StationKey, impl: StationImpl) => {
    if (alive) mount(k, impl);
  };

  // ── 01 Room: the isometric render on a card that faces the camera, with a
  // soft contact shadow on the floor under it.
  builders.room = async () => {
    const tex = await loadTex("/render.webp");
    tex.colorSpace = THREE.SRGBColorSpace;
    // Crop to the room itself (the render has wide transparent margins).
    const U0 = 0.175;
    const U1 = 0.815;
    const V0 = 0.0;
    const V1 = 0.985;
    tex.repeat.set(U1 - U0, V1 - V0);
    tex.offset.set(U0, 1 - V1);
    tex.anisotropy = 4;
    const img = tex.image as { width: number; height: number };
    const aspect = ((U1 - U0) * img.width) / ((V1 - V0) * img.height);
    const W = 2.25;
    const H = W / aspect;
    const card = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    const group = new THREE.Group();
    const lift = new THREE.Group();
    lift.add(card);
    group.add(lift);
    const sh = contactShadow(W * 0.9, W * 0.32);
    sh.position.set(0, -H / 2 - 0.06, 0.25);
    group.add(sh);
    const hop = { x: 0, v: 0 };
    const tmp = new THREE.Vector3();
    mountIf("room", {
      object: group,
      update(dt, t) {
        // Billboard (yaw + a little pitch) so the render always reads square-on.
        tmp.copy(camera.position);
        group.worldToLocal(tmp);
        lift.rotation.y = Math.atan2(tmp.x, tmp.z);
        lift.rotation.x = -Math.atan2(tmp.y, Math.hypot(tmp.x, tmp.z)) * 0.35;
        const bob = REDUCED ? 0 : Math.sin(t * 1.1) * 0.03;
        const h = Math.max(0, spring(hop, 0, dt, 90, 9));
        lift.position.y = bob + h;
        const k = 1 - (bob + h) * 0.9;
        sh.scale.set(k, k, 1);
        (sh.material as THREE.MeshBasicMaterial).opacity = 0.9 * k;
        return busy(hop, 0);
      },
      tap() {
        hop.v += 3.2;
        return true;
      },
    });
  };

  // ── 02 Mac: the classic CRT; each Mac window shows ITS OWN project (set
  // before that window's draw), scanlines + barrel; a glitch band plays once
  // as that window's arrival settles, and on a tap.
  builders.mac = async () => {
    const [gltf, texs] = await Promise.all([loadGLB("/mac.glb"), Promise.all(MAC_PROJECTS.map((p) => loadTex(p.image!)))]);
    texs.forEach((t) => {
      t.colorSpace = THREE.NoColorSpace;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
    });
    const asp = texs.map((t) => {
      const im = t.image as { width: number; height: number };
      return im.width / im.height;
    });
    const mac = gltf.scene;
    let screen: THREE.Mesh | null = null;
    mac.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      if (m.name === "screen") screen = m;
      else if ((m.material as THREE.MeshStandardMaterial)?.isMeshStandardMaterial) {
        const mt = m.material as THREE.MeshStandardMaterial;
        // The case and bezel ship warm cream: recolour them to the palette's
        // cool page white (the slot stays ink).
        if (mt.name === "MacBody" || mt.name === "MacBezel") {
          mt.color.set("#eef0f3");
          mt.roughness = 0.6;
        }
        mt.roughness = Math.max(0.35, mt.roughness ?? 0.5);
        mt.envMapIntensity = 1.0; // no face clips past white
      }
    });
    if (!screen) throw new Error("mac.glb has no screen mesh");
    const scr = screen as THREE.Mesh;
    scr.geometry.computeBoundingBox();
    const bb = scr.geometry.boundingBox!;
    const crt = new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: texs[0] },
        uAspA: { value: asp[0] },
        uTime: { value: 0 },
        uGlitch: { value: 0 },
        uMin: { value: new THREE.Vector2(bb.min.x, bb.min.y) },
        uSize: { value: new THREE.Vector2(bb.max.x - bb.min.x, bb.max.y - bb.min.y) },
      },
      vertexShader: `uniform vec2 uMin; uniform vec2 uSize; varying vec2 vUv;
        void main(){ vUv = (position.xy - uMin) / uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      // Neutral grade: no warm offset or gain (whites stay white), a light red split.
      fragmentShader: `uniform sampler2D uA; uniform float uAspA;
        uniform float uTime; uniform float uGlitch; uniform vec2 uSize; varying vec2 vUv;
        float h(float n){ return fract(sin(n * 91.345) * 43758.5453); }
        vec3 img(sampler2D t, float a, vec2 uv){
          vec2 u = uv - 0.5; float s = (uSize.x / uSize.y) / a;
          if (s < 1.0) u.x *= s; else u.y /= s;
          return texture2D(t, u * 0.94 + 0.5).rgb;
        }
        void main(){
          vec2 c = vUv * 2.0 - 1.0; c *= 1.0 + 0.07 * dot(c, c); vec2 uv = c * 0.5 + 0.5;
          float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
          float rows = 120.0;
          float r = floor(uv.y * rows);
          float band = uGlitch * step(0.86, h(r + floor(uTime * 24.0)));
          uv.x += band * (h(r * 1.7 + uTime) - 0.5) * 0.12;
          vec3 col = img(uA, uAspA, uv);
          col.r = mix(col.r, img(uA, uAspA, uv + vec2(0.004, 0.0)).r, 0.25);
          col *= 0.84 + 0.16 * sin(uv.y * rows * 3.14159);
          col *= smoothstep(-0.01, 0.09, edge);
          col += band * 0.12;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
    });
    scr.material = crt;
    const group = new THREE.Group();
    const spin = new THREE.Group();
    spin.add(mac);
    group.add(spin);
    // On the grey ground the Mac sits on a soft ink contact shadow (the desktop look).
    const glow = contactShadow(2.3, 1.3, shadowTex("13,14,16", 0.5));
    glow.position.y = -0.16;
    group.add(glow);
    // Each Mac window's own screen: its project (data-ch) and its glitch.
    const screens = new Map<HTMLElement, { ch: number; glitch: number; played: boolean }>();
    root.querySelectorAll<HTMLElement>(".ph-mac").forEach((el, i) => {
      const ch = THREE.MathUtils.clamp(Number(el.dataset.ch ?? i) || 0, 0, texs.length - 1);
      screens.set(el, { ch, glitch: 0, played: false });
    });
    const yaw = { x: 0, v: 0 };
    const hop = { x: 0, v: 0 };
    let yawTarget = 0;
    mountIf("mac", {
      object: group,
      warm: texs,
      update(dt, t, st) {
        // A window's glitch plays once, as its arrival (or orbit) settles.
        for (const { el, p } of st.wins) {
          const s = screens.get(el);
          if (s && !s.played && p >= 1) {
            s.played = true;
            if (!REDUCED) s.glitch = 1;
          }
        }
        let glitching = false;
        for (const s of screens.values()) {
          if (s.glitch <= 0) continue;
          s.glitch = Math.max(0, s.glitch - dt * 2.2);
          glitching = true;
        }
        yawTarget *= Math.exp(-dt * 0.8);
        if (Math.abs(yawTarget) < 1e-3) yawTarget = 0;
        spin.rotation.y = spring(yaw, yawTarget, dt, 40, 9) + (REDUCED ? 0 : Math.sin(t * 0.4) * 0.07);
        spin.position.y = Math.max(0, spring(hop, 0, dt, 90, 8));
        return glitching || yawTarget !== 0 || busy(yaw, yawTarget) || busy(hop, 0);
      },
      prepare(el) {
        const s = screens.get(el);
        const i = s?.ch ?? 0;
        crt.uniforms.uA.value = texs[i];
        crt.uniforms.uAspA.value = asp[i];
        crt.uniforms.uGlitch.value = REDUCED ? 0 : (s?.glitch ?? 0);
        crt.uniforms.uTime.value = performance.now() / 1000;
      },
      drag(dx) {
        yawTarget = THREE.MathUtils.clamp(yawTarget + dx * 4, -1.2, 1.2);
      },
      tap(_ndc, el) {
        const s = screens.get(el);
        if (s && !REDUCED) s.glitch = 1;
        hop.v += 2.4;
        return true;
      },
    });
  };

  // ── 04 Play: the ten props on a slow carousel; scroll through the tall
  // window turns the ring one interest at a time, a horizontal drag spins it.
  builders.props = async () => {
    const gltfs = await Promise.all(HOBBIES.map((h) => loadGLB(`/hobbies/${h.file}`)));
    const group = new THREE.Group();
    const ring = new THREE.Group();
    group.add(ring);
    const N = HOBBIES.length;
    const R = 1.3;
    const STEP = (Math.PI * 2) / N;
    const items = gltfs.map((g, i) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        (Array.isArray(m.material) ? m.material : [m.material]).forEach((mt) => {
          const s = mt as THREE.MeshStandardMaterial;
          if (s.isMeshStandardMaterial) s.roughness = Math.min(s.roughness ?? 0.5, 0.34);
        });
      });
      const body = normalise(g.scene, 0.5);
      body.rotation.set(0.25 * Math.sin(i * 2.1), i * 0.9, 0.2 * Math.cos(i * 1.3));
      // Its lowest point at scale 1 (a spin about y never changes it).
      const bot = new THREE.Box3().setFromObject(body).min.y;
      const pivot = new THREE.Group();
      pivot.add(body);
      const sh = contactShadow(0.95, 0.95);
      sh.position.y = bot - 0.01;
      const slot = new THREE.Group();
      slot.add(pivot, sh);
      slot.position.set(Math.sin(i * STEP) * R, 0, Math.cos(i * STEP) * R);
      ring.add(slot);
      body.userData.i = i;
      return { pivot, body, sh, bot, pop: { x: 1, v: 0 }, extra: 0, lastRing: 0 };
    });
    const playWin = win(".ph-play");
    const nameEl = playWin.querySelector<HTMLElement>(".ph-play-name")!;
    let top = 0;
    let span = 1;
    let front = -1;
    let dragRot = 0;
    let dragV = 0;
    const measure = (_vw: number, vh: number) => {
      top = docTop(playWin);
      span = Math.max(1, playWin.offsetHeight - vh);
    };
    measure(window.innerWidth, window.innerHeight);
    const ringRot = { x: 0, v: 0 };
    let lastRot = NaN;
    // Scroll -> ring position u (in slots): each slot holds through the middle
    // of its stretch of scroll and turns between. When scrolling stops between
    // two slots, the ring settles on the nearer one (held until the scroll
    // passes it, so resuming never turns the ring backwards).
    const slotOf = (p: number) => {
      const v = p * (N - 1);
      const k = Math.min(N - 2, Math.floor(v));
      const x = THREE.MathUtils.clamp((v - k - 0.2) / 0.6, 0, 1);
      return k + x * x * (3 - 2 * x);
    };
    let held: number | null = null;
    let lastY = NaN;
    let still = 0;
    let pinned = false;
    const _c = new THREE.Vector3();
    const _g = new THREE.Vector3();
    const replayTick = () => {
      nameEl.classList.remove("ph-tick");
      void nameEl.offsetWidth;
      nameEl.classList.add("ph-tick");
    };
    mountIf("props", {
      object: group,
      measure,
      update(dt: number, t: number, st: StageState) {
        const p = THREE.MathUtils.clamp((st.y - top) / span, 0, 1);
        // The name shows once the pin has stuck (above that it rides under the dock).
        const pin = st.y >= top - 1;
        if (pin !== pinned) {
          pinned = pin;
          nameEl.classList.toggle("ph-pinned", pin);
          if (pin) replayTick();
        }
        const u = slotOf(p);
        const dy = st.y - lastY;
        if (dy) {
          still = 0;
          if (held !== null && !((dy > 0 && held > u) || (dy < 0 && held < u))) held = null;
        } else still += dt;
        lastY = st.y;
        // Scroll at rest between slots: settle on the nearer one.
        const waiting = held === null && Math.abs(u - Math.round(u)) > 1e-3;
        if (waiting && still > 0.15) held = Math.round(u);
        dragRot += dragV * dt;
        dragV *= Math.exp(-dt * 3);
        // Ease toward the nearest whole slot when nobody is dragging.
        if (Math.abs(dragV) < 0.05) {
          dragV = 0;
          const slot = Math.round(dragRot / STEP) * STEP;
          dragRot += (slot - dragRot) * (1 - Math.exp(-dt * 4));
          if (Math.abs(slot - dragRot) < 1e-4) dragRot = slot;
        }
        // The scroll turns the ring almost directly (a stiff, critically damped
        // spring), so it stops when the finger does.
        const target = -(held ?? u) * STEP + dragRot;
        const rot = REDUCED ? target : spring(ringRot, target, dt, 200, 28);
        const turned = rot !== lastRot;
        lastRot = rot;
        ring.rotation.y = rot;
        // The camera's yaw about the ring (it is posed for this window before
        // update): the slot facing it is the front one, drawn biggest.
        group.updateWorldMatrix(true, false);
        group.getWorldPosition(_g);
        _c.copy(camera.position).sub(_g);
        const yaw = Math.atan2(_c.x, _c.z);
        const f = ((Math.round((yaw - rot) / STEP) % N) + N) % N;
        if (f !== front) {
          front = f;
          nameEl.textContent = HOBBIES[f].label;
          replayTick();
        }
        let popping = false;
        items.forEach((it, i) => {
          it.extra *= Math.exp(-dt * 2.5);
          if (it.extra < 0.01) it.extra = 0;
          it.pivot.rotation.y += (REDUCED ? 0 : 0.35) * st.amb + it.extra * dt - (rot - it.lastRing);
          it.lastRing = rot;
          const bob = REDUCED ? 0 : Math.sin(t * 1.2 + i * 1.7) * 0.05;
          // Front-ness: the slot facing the camera reads big, the back row small.
          const a = i * STEP + rot - yaw;
          const fr = Math.pow((Math.cos(a) + 1) / 2, 4);
          const s = spring(it.pop, 1, dt, 160, 10) * (0.46 + 0.54 * fr);
          if (it.extra || busy(it.pop, 1)) popping = true;
          it.pivot.position.y = bob;
          it.pivot.scale.setScalar(s);
          // The shadow sits just under the scaled prop; only the front ones cast one.
          it.sh.position.y = bob + it.bot * s - 0.01;
          it.sh.scale.setScalar(s);
          (it.sh.material as THREE.MeshBasicMaterial).opacity = fr;
        });
        return turned || popping || dragV !== 0 || (waiting && still <= 0.15);
      },
      drag(dx) {
        dragRot += dx * 3.2;
        dragV = dx * 60;
      },
      tap(ndc) {
        ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
        let o: THREE.Object3D | null = ray.intersectObjects(items.map((it) => it.body), true)[0]?.object ?? null;
        while (o && o.userData.i == null) o = o.parent;
        if (!o) return false;
        const it = items[o.userData.i as number];
        it.extra += 9;
        it.pop.v += 5;
        return true;
      },
    });
  };

  // ── 05 Honours: a voxel podium of three plinths (#25 / Finalist / Top 50)
  // that builds itself layer by layer as the camera dollies in.
  builders.podium = async () => {
    await document.fonts.load('700 80px "Offbit"').catch(() => {});
    const VX = 0.13;
    const N = 5;
    const PL = [
      { x: -0.74, h: 6, color: "white", big: "Finalist", small: "Hack The 6ix", note: "top 1% · 400+", label: null as THREE.Mesh | null },
      { x: 0, h: 9, color: "orange", big: "#25", small: "Product Hunt", note: "oct 4, 2026", label: null as THREE.Mesh | null },
      { x: 0.74, h: 4, color: "white", big: "Top 50", small: "IBM Watsonx", note: "of 2000+", label: null as THREE.Mesh | null },
    ];
    interface Cell {
      pi: number;
      s: number;
      p: THREE.Vector3;
      layer: number;
    }
    const cells: Record<string, Cell[]> = { white: [], orange: [] };
    PL.forEach((pl, pi) => {
      for (let y = 0; y < pl.h; y++)
        for (let x = 0; x < N; x++)
          for (let z = 0; z < N; z++) {
            const shell = x === 0 || z === 0 || x === N - 1 || z === N - 1 || y === pl.h - 1;
            if (!shell) continue;
            cells[pl.color].push({ pi, s: VX, p: new THREE.Vector3(pl.x + (x - (N - 1) / 2) * VX, (y + 0.5) * VX, (z - (N - 1) / 2) * VX), layer: y });
          }
      // A little voxel trophy on top (cup on a stem on a base).
      const tv = 0.045;
      const ty = pl.h * VX;
      const tc = pl.color === "orange" ? "white" : "orange";
      const T: Array<[number, number, number]> = [];
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) T.push([x, 0, z]);
      T.push([0, 1, 0], [0, 2, 0]);
      for (let y = 3; y <= 5; y++)
        for (let x = -2; x <= 2; x++)
          for (let z = -2; z <= 2; z++) {
            const ring = Math.max(Math.abs(x), Math.abs(z));
            if (y === 3 ? ring <= 1 : ring === 2) T.push([x, y, z]);
          }
      T.push([-3, 4, 0], [3, 4, 0]);
      for (const [x, y, z] of T) cells[tc].push({ pi, s: tv, p: new THREE.Vector3(pl.x + x * tv, ty + (y + 0.5) * tv, z * tv), layer: pl.h + 1 + y * 0.3 });
    });
    const maxLayer = 9 + 3;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mats: Record<string, THREE.Material> = {
      white: new THREE.MeshStandardMaterial({ color: "#f4f5f7", roughness: 0.55 }),
      // No specular sheen (it greyed the orange) and a touch of self-light, so
      // the lit front face reads as the palette #ff4f00 and the sides go darker.
      orange: new THREE.MeshPhysicalMaterial({ color: "#ff4f00", roughness: 0.5, specularIntensity: 0, emissive: "#ff4f00", emissiveIntensity: 0.2 }),
    };
    const group = new THREE.Group();
    const meshes: Record<string, THREE.InstancedMesh> = {};
    for (const k of ["white", "orange"]) {
      const m = new THREE.InstancedMesh(geo, mats[k], cells[k].length);
      m.userData.cells = cells[k];
      meshes[k] = m;
      group.add(m);
    }
    // Front labels, drawn after Offbit has loaded.
    PL.forEach((pl) => {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = 256;
      const g = c.getContext("2d")!;
      g.fillStyle = pl.color === "orange" ? "#ffffff" : "#ff4f00";
      g.textAlign = "center";
      g.textBaseline = "alphabetic";
      g.font = `700 ${pl.big.length > 4 ? 64 : 96}px Offbit`;
      g.fillText(pl.big, 128, 120);
      g.font = "700 30px Offbit";
      g.fillStyle = pl.color === "orange" ? "rgba(255,255,255,.85)" : "rgba(13,14,16,.6)";
      g.fillText(pl.small.toLowerCase(), 128, 166);
      // Each placement's context lives here, not in a card that repeats the podium.
      g.font = "700 24px Offbit";
      g.fillText(pl.note, 128, 202);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      const w = N * VX;
      const lab = new THREE.Mesh(new THREE.PlaneGeometry(w, w), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
      lab.position.set(pl.x, Math.min(pl.h * VX - w / 2 - 0.02, 0.62), (N * VX) / 2 + 0.004);
      pl.label = lab;
      group.add(lab);
    });
    const sh = contactShadow(3.0, 1.5);
    sh.position.y = 0.002;
    group.add(sh);
    const hops = PL.map(() => ({ x: 0, v: 0 }));
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    let builtLv = -1;
    const yaw = { x: 0, v: 0 };
    let yawTarget = 0;
    mountIf("podium", {
      object: group,
      update(dt, t, st) {
        // Its window's arrival: 0 as the window enters -> 1 once the camera has settled.
        const prog = st.arrive.podium;
        const lv = REDUCED ? maxLayer + 1 : prog * (maxLayer + 2);
        const hy = hops.map((h) => Math.max(0, spring(h, 0, dt, 110, 9)));
        const moving = hops.some((h) => busy(h, 0)) || Math.abs(lv - builtLv) > 1e-3;
        if (moving) {
          for (const k of ["white", "orange"]) {
            const m = meshes[k];
            (m.userData.cells as Cell[]).forEach((c, i) => {
              const f = THREE.MathUtils.clamp(lv - c.layer, 0, 1);
              const stepped = Math.floor(f * 4) / 4; // chrome-stepped drop
              pos.copy(c.p);
              pos.y += (1 - stepped) * 0.9 + hy[c.pi];
              sc.setScalar(c.s * 0.94 * (f > 0 ? 1 : 0));
              m.setMatrixAt(i, m4.compose(pos, q, sc));
            });
            m.instanceMatrix.needsUpdate = true;
          }
          PL.forEach((pl, i) => {
            // Only once its plinth is complete (never over a half-built one).
            pl.label!.visible = lv >= pl.h + 0.5;
            pl.label!.position.y = Math.min(pl.h * VX - (N * VX) / 2 - 0.02, 0.62) + hy[i];
          });
          builtLv = lv;
        }
        yawTarget *= Math.exp(-dt * 0.8);
        if (Math.abs(yawTarget) < 1e-3) yawTarget = 0;
        group.rotation.y = spring(yaw, yawTarget, dt, 40, 9) + (REDUCED ? 0 : Math.sin(t * 0.35) * 0.05);
        return moving || yawTarget !== 0 || busy(yaw, yawTarget);
      },
      drag(dx) {
        yawTarget = THREE.MathUtils.clamp(yawTarget + dx * 3, -0.9, 0.9);
      },
      tap(ndc) {
        ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
        const hit = ray.intersectObjects([meshes.white, meshes.orange], false)[0];
        if (!hit || hit.instanceId == null) return false;
        hops[(hit.object.userData.cells as Cell[])[hit.instanceId].pi].v += 2.6;
        return true;
      },
    });
  };

  // ── 07 Contact: the keypad upright on the orange wall. Keys press and open
  // the real links; the OLED opens mail; the dial spins.
  builders.keypad = async () => {
    const gltf = await loadGLB(keypadUrl);
    const pad = gltf.scene;
    const LINKS: Record<string, string> = Object.fromEntries(SOCIALS.map((s) => [s.node, s.href]));
    LINKS.display = `mailto:${EMAIL}`;
    const parts: Record<string, THREE.Object3D> = {};
    pad.traverse((o) => {
      if (o.name in LINKS || o.name === "knob") parts[o.name] = o;
      const m = o as THREE.Mesh;
      const mt = m.material as THREE.MeshStandardMaterial | undefined;
      if (m.isMesh && mt?.isMeshStandardMaterial && mt.name === "keycap") mt.roughness = 0.4;
    });
    for (const k in parts) {
      parts[k].userData.key = k;
      parts[k].userData.y0 = parts[k].position.y;
      parts[k].userData.press = { x: 0, v: 0 };
    }
    const group = new THREE.Group();
    // Stood up against a wall, keys facing the camera (the OLED on top).
    const stand = new THREE.Group();
    stand.add(pad);
    stand.rotation.x = Math.PI / 2;
    const body = new THREE.Group();
    body.add(stand);
    body.scale.setScalar(0.68);
    group.add(body);
    // Centred on the station, its back flat on the wall plane (z = 0).
    const box = new THREE.Box3().setFromObject(body);
    const size = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());
    body.position.set(-mid.x, -mid.y, -box.min.z);
    // No wall of its own: the window's CSS orange shows through the
    // transparent canvas; an ink contact shadow on the wall seats it.
    const sh = contactShadow(size.x * 1.2, size.y * 1.2, shadowTex("13,14,16", 0.32));
    sh.rotation.x = 0;
    sh.position.set(0.18, -0.28, 0.005);
    group.add(sh);
    const tilt = { x: 0, v: 0 };
    let knobV = 0;
    mountIf("keypad", {
      object: group,
      update(dt, t, st) {
        let pressing = false;
        for (const k in parts) {
          if (k === "knob") continue;
          const p = parts[k];
          const s = p.userData.press as Spring;
          p.position.y = p.userData.y0 - Math.max(0, spring(s, 0, dt, 140, 10));
          if (busy(s, 0)) pressing = true;
        }
        knobV *= Math.exp(-dt * 1.5);
        if (Math.abs(knobV) < 0.01) knobV = 0;
        if (parts.knob) parts.knob.rotation.y += (REDUCED ? 0 : 0.25) * st.amb + knobV * dt;
        // A press rocks it back on the wall; otherwise a slight sway.
        body.rotation.y = spring(tilt, 0, dt, 60, 7) + (REDUCED ? 0 : Math.sin(t * 0.5) * 0.02);
        body.rotation.x = REDUCED ? 0 : Math.sin(t * 0.37) * 0.015;
        return pressing || knobV !== 0 || busy(tilt, 0);
      },
      tap(ndc) {
        ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
        let o: THREE.Object3D | null = ray.intersectObject(pad, true)[0]?.object ?? null;
        while (o && !o.userData.key) o = o.parent;
        if (!o) return false;
        const k = o.userData.key as string;
        if (k === "knob") {
          knobV += 9;
          return true;
        }
        (o.userData.press as Spring).v += 1.6;
        tilt.v += (o.position.x > 0 ? 1 : -1) * 0.6;
        if (k === "display") {
          track("contact_email", { context: "keypad" });
          location.href = LINKS.display;
        } else {
          track("outbound_link", { url: LINKS[k], context: "keypad" });
          window.open(LINKS[k], "_blank", "noopener");
        }
        return true;
      },
    });
  };

  return () => {
    alive = false;
    offs.forEach((f) => f());
    env.dispose();
  };
}
