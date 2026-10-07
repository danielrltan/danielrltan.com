import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { track } from "../analytics";
import { SOCIALS } from "../socials";
import { knobAnchor } from "./KnobSparks";
import { COPIED, copiedVisible, loadCopiedFont, makeCopiedTexture } from "./copiedScreen";
import { makeHoverScreen, type HoverScreen } from "./hoverScreen";
import { reducedMotion } from "../motion";
// keypad.glb is imported as a Vite asset so the build gives it a content-
// hashed URL under /assets/ (cached immutably; a new model gets a new URL).
// From public/ it was /keypad.glb with a 24 h cache, so browsers kept showing
// the old model for a day after each change (owner: "the keypad didnt change
// at all").
import keypadUrl from "./keypad.glb?url";

/**
 * Loads keypad.glb and wires up four social keycaps + the spinnable
 * dial. Other meshes render unchanged.
 *
 * GLB nodes (built by scripts/build-keypad-model.py from
 * src/keypad/keypadSpec.json; `npm run model:keypad`):
 *   x, linkedin, github, pinterest  - social keycaps (clickable), origin at
 *                                       each cap's centre, pressed along Y
 *   knob                              - spinnable cat dial, origin on its
 *                                       spin axis (rotation.y)
 *   frame                             - body, well floor, dial collar and
 *                                       side buttons (static)
 *   display                           - the screen (flashes on presses;
 *                                       hover turns the email orange, see
 *                                       hoverScreen.ts; a click copies it,
 *                                       see copiedScreen.ts)
 *
 * Animations driven from useFrame with fixed-rate damping
 * (per the project's scroll-animations-fixed-rate rule): no spring
 * library, no per-frame React re-renders.
 */

useGLTF.preload(keypadUrl);


// Keycap NODE name → URL (src/socials.ts owns the list).
const SOCIAL_URLS: Record<string, string> = Object.fromEntries(
  SOCIALS.map((s) => [s.node, s.href]),
);

const SOCIAL_KEYS = Object.keys(SOCIAL_URLS);

const HOVER_DIP = 0.1045; // +10% (owner: keys go down a bit more on hover)
const PRESS_DIP = 0.19;
const PRESS_HOLD_MS = 110;
const PRESS_LERP_RATE = 18;

/** Dispatched whenever the keypad's hover state changes (over an
 *  interactive cap / dial / sidebtn). App.tsx listens and mirrors
 *  into the MoveableCursor `hot` state so the cursor reacts. */
function emitCursorHover(hot: boolean) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("keypad-cursor-hover", { detail: { hot } }),
  );
}

// Each click adds this much angular velocity (rad/s) to the dial.
// Velocity decays exponentially via DIAL_DAMP; rapid clicking
// accumulates, so the user can spin the dial increasingly fast by
// hammering on it.
const DIAL_KICK = Math.PI * 2 * 1.1;
// Slow decay so accumulated velocity persists long enough that a
// rapid click stack actually reaches "spinning hard" before fading.
// At 0.9, velocity halves every ~0.77s.
export const DIAL_DAMP = 0.9;
// Reflection strength of the studio environment on the metal parts only.
const METAL_ENV_INTENSITY = 0.75; // 0.85 read overexposed (owner)
// World units the dial rises per unit of scale growth: hover +0.12 lifts it
// ~0.07 (owner: 1.4 / ~0.17 "goes up too much").
const DIAL_LIFT = 0.6;
// Hard cap so a determined spammer can't push velocity into the
// 'spinning so fast it looks frozen' territory.
const DIAL_MAX_VEL = Math.PI * 2 * 12; // 12 revs/sec ceiling

export interface KeypadModelApi {
  /** Add the given angular velocity (rad/s) to the dial. */
  kickDial: (radPerSec: number) => void;
}

interface CapState {
  obj: THREE.Object3D;
  baseY: number;
  /** Hit-volume centre in the cloned-root local frame, derived from the cap's
   *  GEOMETRY (Box3) — NOT obj.position. A re-exported keypad.glb can bake the
   *  cap node transforms into their meshes and zero the node translations, in
   *  which case obj.position is (0,0,0) and a hit-box placed there collapses onto
   *  the model origin (caps stop receiving onPointerOver → no hover-sink AND no
   *  spark cursor, since one handler drives both). Geometry-centre tracks where
   *  the cap actually renders regardless of baked transforms. */
  hitPos: THREE.Vector3;
  /** Hit-volume size: the cap's own footprint (a fixed 0.55 box covered only
   *  the middle of each cap, so clicks near a cap's edge missed it). */
  hitSize: THREE.Vector3;
  pressT: number;
  hovered: boolean;
  pressedAt: number | null;
}

// Fit policy: model's bounding-sphere radius (rotation-invariant)
// should equal this fraction of the visible camera HALF-HEIGHT at
// world z=0. The bounding SPHERE circumscribes the tilted slab PLUS
// the protruding dial, so its top/bottom reach further up the frame
// than the keypad body does; 0.92 left the body kissing (and the idle
// bob + knob wobble pushing it past) the bottom edge - the keypad read
// as cut off. 0.80 keeps the full keypad on-screen with a comfortable
// vertical margin (~20% of the half-height) that absorbs the base tilt,
// bob, and wobble. (Bump up toward 0.85 to fill more; below that the
// cutoff returns.)
const TARGET_FILL_RATIO = 0.8;
// PORTRAIT (phones): the fit clamps to the TIGHTER axis, which in
// portrait is the half-WIDTH, and the bounding SPHERE circumscribes the
// tilted slab PLUS the protruding dial, so a 0.92 sphere-fit left the
// actual keypad body reading small with wide side margins (user: "looks
// kinda small"). Portrait has ample VERTICAL room, so we let the sphere
// overshoot the width (its corners are empty) and fill a larger fraction
// The keypad BODY then reads big and fills the frame. Tuned by eye on
// a ~390px phone; the dial corner still stays clear of the edges.
const TARGET_FILL_RATIO_PORTRAIT = 1.28;

interface KeypadModelProps {
  /** Called once at mount with an imperative API. Used by parent to
   *  trigger automatic dial-spins (e.g. on scroll drop-in). */
  onReady?: (api: KeypadModelApi) => void;
}

export function KeypadModel({ onReady }: KeypadModelProps = {}) {
  const { scene } = useGLTF(keypadUrl);
  const { camera, size, gl } = useThree();
  // Studio reflections for the METAL parts only (body, casing, dial side):
  // owner wanted the body "more shiny and metallic", and metal with nothing to
  // reflect renders black and streaky (the old model's "wonky" look). The
  // keycaps, screen and icons keep the direct key/fill lighting; a scene-wide
  // environment was tried before and made everything read flat.
  const metalEnv = useMemo(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const tex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    return tex;
  }, [gl]);
  useEffect(() => () => metalEnv.dispose(), [metalEnv]);

  // Clone + traverse synchronously so caps & dial are known before
  // the first render returns. Hit-volume meshes need their world
  // positions on mount.
  const { cloned, recenterOffset, sphereRadius, caps, dial, dialHitPos, dialHitSize, screenMat, screenHit } = useMemo(() => {
    const cl = scene.clone(true);
    const capMap: Record<string, CapState> = {};
    let dialObj: THREE.Object3D | null = null;
    let screenMaterial: THREE.Material | null = null;
    let screenObj: THREE.Object3D | null = null;
    // Find the caps / dial / display, sharpen texture sampling, and turn on
    // shadows. Geometry and normals are used exactly as the build exported them.
    cl.traverse((obj) => {
      const name = obj.name;
      if (SOCIAL_KEYS.includes(name)) {
        capMap[name] = {
          obj,
          baseY: obj.position.y,
          // Filled below from geometry centre once world matrices are current.
          hitPos: new THREE.Vector3(),
          hitSize: new THREE.Vector3(0.55, 0.4, 0.55),
          pressT: 0,
          hovered: false,
          pressedAt: null,
        };
      } else if (name === "knob") {
        // Dial / spinnable knob. Parent group containing both the
        // cylinder body and cat-face decal as child meshes. We
        // rotate the parent so both spin together. If the dial node
        // gets renamed again, console will warn and list available
        // node names (see warning block below).
        dialObj = obj;
      } else if (name === "display") {
        // Display screen: captured (and its material CLONED so the
        // useGLTF cache stays pristine) for the interaction flash —
        // the OLED blips brighter on cap/dial presses.
        screenObj = obj;
        const sm = obj as THREE.Mesh;
        if (sm.isMesh && sm.material && !Array.isArray(sm.material)) {
          sm.material = (sm.material as THREE.Material).clone();
          screenMaterial = sm.material;
        }
      }
      const m = obj as THREE.Mesh;
      if (m.isMesh) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const maxAniso = gl.capabilities.getMaxAnisotropy();
        for (const mat of mats) {
          if (!mat) continue;
          const stdMat = mat as THREE.MeshStandardMaterial;
          stdMat.flatShading = false;
          if (mat.name === "BrushedMetal") {
            stdMat.envMap = metalEnv;
            stdMat.envMapIntensity = METAL_ENV_INTENSITY;
          }
          // Anisotropic filtering on every texture map on the
          // material. Default anisotropy is 1, which makes textures
          // look fuzzy/dithered when sampled at oblique angles. The
          // icon decals on the cap top faces (which sit at ~32° to
          // the camera) hit this hardest. Max anisotropy on modern
          // GPUs is 16; samples the texture along the projected
          // direction, recovering sharp edges.
          const TEX_KEYS = [
            "map",
            "normalMap",
            "roughnessMap",
            "metalnessMap",
            "emissiveMap",
            "aoMap",
          ] as const;
          for (const key of TEX_KEYS) {
            const tex = stdMat[key] as THREE.Texture | null;
            if (!tex) continue;
            tex.anisotropy = maxAniso;
            tex.needsUpdate = true;
          }
          mat.needsUpdate = true;
        }
        // Normals come from the model build (bevels with hardened normals,
        // smooth-by-angle), so they are used as exported. The old runtime
        // averaging across shared positions would round off the new edges.
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    // Dev-only diagnostics: these guard against a re-exported GLB
    // renaming nodes. In prod they'd just be devtools noise.
    if (import.meta.env.DEV) {
      if (Object.keys(capMap).length < SOCIAL_KEYS.length) {
        const missing = SOCIAL_KEYS.filter((k) => !capMap[k]);
        console.warn("[keypad] expected social keycap nodes missing:", missing);
      }
      if (!dialObj) {
        const names: string[] = [];
        cl.traverse((o) => {
          if (o.name) names.push(o.name);
        });
        console.warn(
          "[keypad] dial node 'knob' not found in GLB. Available nodes:",
          names,
        );
      }
    }
    // Bring all world matrices current before any Box3 reads (clone() can leave
    // matrixWorld stale, and the hit-volume placement below reads geometry
    // bounds in the cloned-root frame).
    cl.updateMatrixWorld(true);

    // Hit-volume centres from GEOMETRY, not node.position — see CapState.hitPos.
    // This is what makes the four social caps clickable again after a GLB
    // re-export baked their node translations to zero.
    const hb = new THREE.Box3();
    for (const key of Object.keys(capMap)) {
      const c = capMap[key]!;
      hb.setFromObject(c.obj).getCenter(c.hitPos);
      // Footprint of the cap, a hair inside its edges so neighbours never
      // overlap; height covers the cap above the hover/press dip.
      const sz = hb.getSize(new THREE.Vector3());
      c.hitSize.set(sz.x * 0.96, Math.max(0.4, sz.y), sz.z * 0.96);
    }
    const dialHitPos = dialObj
      ? hb.setFromObject(dialObj).getCenter(new THREE.Vector3())
      : null;
    // Dial hit volume sized from the dial itself: radius a hair past its edge
    // (inside the casing ring), height covering the lift on hover. The old
    // fixed 1.1-radius cylinder was 2.4x the dial and reached over the screen
    // and the LinkedIn cap (owner: the hover boundary "feels too big").
    const dialHitSize = dialObj
      ? (() => {
          const sz = hb.setFromObject(dialObj).getSize(new THREE.Vector3());
          return { r: (Math.max(sz.x, sz.z) / 2) * 1.12, h: sz.y * 1.6 };
        })()
      : null;
    // Screen hit volume: the glass footprint, standing a little proud of it
    // so a click lands before the recess walls.
    const screenHit = screenObj
      ? (() => {
          hb.setFromObject(screenObj);
          const pos = hb.getCenter(new THREE.Vector3());
          const sz = hb.getSize(new THREE.Vector3());
          pos.y = hb.max.y;
          return { pos, size: new THREE.Vector3(sz.x, 0.12, sz.z) };
        })()
      : null;

    const box = new THREE.Box3().setFromObject(cl);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    return {
      cloned: cl,
      recenterOffset: center.clone().multiplyScalar(-1),
      sphereRadius: sphere.radius,
      caps: capMap,
      dial: dialObj as THREE.Object3D | null,
      dialHitPos,
      dialHitSize,
      screenMat: screenMaterial as THREE.Material | null,
      screenHit,
    };
  }, [scene, metalEnv]);

  // Camera-aware fit. Re-runs on resize so portrait/landscape both
  // get a sensible scale. Uses visible camera HEIGHT at world z=0
  // as the target dimension. Height is the smaller dim on most
  // landscape canvases, so fitting the sphere to height-fraction
  // guarantees the model stays inside both axes.
  const fitScale = useMemo(() => {
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return 1;
    const pc = camera as THREE.PerspectiveCamera;
    // Real cam→lookAt distance (the model centroid is at world
    // origin after recenterOffset). Using camera.position.z would be
    // wrong now that the camera is off-axis (above + in front).
    const distToTarget = pc.position.length();
    const visibleHalfHeight =
      Math.tan(THREE.MathUtils.degToRad(pc.fov / 2)) * distToTarget;
    // Clamp against width too. On portrait viewports the height
    // isn't the tighter axis.
    const visibleHalfWidth = visibleHalfHeight * (size.width / size.height);
    const tighter = Math.min(visibleHalfHeight, visibleHalfWidth);
    // Portrait fills more of the frame (see TARGET_FILL_RATIO_PORTRAIT).
    const portrait = size.height > size.width;
    const fill = portrait ? TARGET_FILL_RATIO_PORTRAIT : TARGET_FILL_RATIO;
    return (tighter * fill) / sphereRadius;
  }, [camera, size.width, size.height, sphereRadius]);

  const capsRef = useRef(caps);
  capsRef.current = caps;
  const dialVelRef = useRef(0);
  // Dial scale feedback: grows slightly on hover, pops a touch more on
  // click then settles. Eased in useFrame (never bound to the event).
  const dialHoveredRef = useRef(false);
  const dialPressedAtRef = useRef<number | null>(null);
  const dialScaleRef = useRef(1);
  const dialBaseScaleRef = useRef<THREE.Vector3 | null>(null);
  const dialBaseYRef = useRef<number | null>(null);
  // Dial hit volume: its frame rides the device (tilt, float, wobble), so
  // projecting it each frame gives KnobSparks the knob's live screen anchor.
  const dialHitRef = useRef<THREE.Mesh>(null);
  const anchorVecs = useMemo(() => ({ c: new THREE.Vector3(), e: new THREE.Vector3() }), []);

  // Expose imperative API for parent-driven dial kicks (e.g. spin
  // automatically when the drop-in animation completes).
  useEffect(() => {
    if (!onReady) return;
    onReady({
      kickDial: (rad) => {
        const next = dialVelRef.current + rad;
        dialVelRef.current = Math.min(next, DIAL_MAX_VEL);
      },
    });
  }, [onReady]);

  // OLED interaction flash: presses blip the display brighter, then
  // decay (~7/s). Works on standard (emissive lift) and basic (color
  // scale) materials; the screen material is a private clone, so the
  // cache and siblings are untouched.
  const screenFlashRef = useRef(0);
  // "copied!" on the screen: click time (-1 = idle), the copied frame, and
  // the material's own art to swap back to.
  const copiedAtRef = useRef(-1);
  const copiedTexRef = useRef<THREE.CanvasTexture | null>(null);
  const screenArtRef = useRef<THREE.Texture | null>(null);
  // Hover: the email fades to orange (hoverK 0..1, built on first hover).
  const screenHotRef = useRef(false);
  const hoverKRef = useRef(0);
  const hoverScreenRef = useRef<HoverScreen | null>(null);
  useEffect(() => {
    const sm = screenMat as THREE.MeshStandardMaterial | null;
    if (sm) screenArtRef.current = sm.map;
    return () => {
      if (sm && screenArtRef.current) sm.map = screenArtRef.current;
      copiedTexRef.current?.dispose();
      copiedTexRef.current = null;
      hoverScreenRef.current?.dispose();
      hoverScreenRef.current = null;
    };
  }, [screenMat]);

  useFrame((_, dt) => {
    const map = capsRef.current;
    const now = performance.now();
    const k = 1 - Math.exp(-dt * PRESS_LERP_RATE);

    const sm = screenMat as THREE.MeshStandardMaterial | null;
    if (sm) {
      // hover fades in fast and out a touch slower; reduced motion snaps
      const hot = screenHotRef.current ? 1 : 0;
      const hk = hoverKRef.current;
      if (hk !== hot) {
        const next = reducedMotion.value ? hot : hk + (hot - hk) * (1 - Math.exp(-dt * (hot ? 22 : 12)));
        hoverKRef.current = Math.abs(hot - next) < 0.004 ? hot : next;
        if (!hoverScreenRef.current && screenArtRef.current) hoverScreenRef.current = makeHoverScreen(screenArtRef.current);
        hoverScreenRef.current?.draw(hoverKRef.current);
      }
      const plain = hoverKRef.current > 0 && hoverScreenRef.current ? hoverScreenRef.current.tex : screenArtRef.current;
      let next = plain;
      if (copiedAtRef.current >= 0 && copiedTexRef.current) {
        const show = copiedVisible((now - copiedAtRef.current) / 1000, reducedMotion.value);
        if (show == null) copiedAtRef.current = -1;
        if (show) next = copiedTexRef.current;
      }
      if (next && sm.map !== next) sm.map = next;
    }

    if (screenMat && screenFlashRef.current > 0) {
      screenFlashRef.current =
        screenFlashRef.current < 0.004
          ? 0
          : screenFlashRef.current * Math.exp(-dt * 7);
      const f = screenFlashRef.current;
      const sm = screenMat as THREE.MeshStandardMaterial;
      if (sm.emissive) sm.emissive.setScalar(f * 0.85);
      else (screenMat as THREE.MeshBasicMaterial).color.setScalar(1 + f * 0.8);
    }
    for (const name in map) {
      const c = map[name]!;
      let target = c.hovered ? 0.45 : 0;
      if (c.pressedAt != null && now - c.pressedAt < PRESS_HOLD_MS) {
        target = 1;
      }
      c.pressT += (target - c.pressT) * k;
      // Map pressT [0..0.45..1] → dip [0..HOVER_DIP..PRESS_DIP] piecewise.
      let dip: number;
      if (c.pressT <= 0.45) {
        dip = (c.pressT / 0.45) * HOVER_DIP;
      } else {
        const t = (c.pressT - 0.45) / 0.55;
        dip = HOVER_DIP + t * (PRESS_DIP - HOVER_DIP);
      }
      c.obj.position.y = c.baseY - dip;
    }

    if (dial && Math.abs(dialVelRef.current) > 1e-4) {
      dial.rotation.y += dialVelRef.current * dt;
      dialVelRef.current *= Math.exp(-dt * DIAL_DAMP);
    }

    // Dial scale feedback: 1.0 at rest, +10.8% on hover, a decaying extra
    // +14.4% pop on click that eases back down (owner: "make the knob increase
    // in size bigger", then 10% less of that; originally +5% / +8%). The dial
    // sits in a casing ring, so it
    // also LIFTS out of it as it grows (DIAL_LIFT per unit of growth) instead
    // of swelling into the ring. Independent of the spin rotation above.
    if (dial) {
      if (!dialBaseScaleRef.current) dialBaseScaleRef.current = dial.scale.clone();
      if (dialBaseYRef.current == null) dialBaseYRef.current = dial.position.y;
      const base = dialBaseScaleRef.current;
      let target = dialHoveredRef.current ? 1.108 : 1.0;
      const pAt = dialPressedAtRef.current;
      if (pAt != null) {
        const since = (now - pAt) / 1000;
        if (since < 0.32) {
          target += (1 - since / 0.32) * 0.144; // up to ~+0.25 at the click instant
        } else {
          dialPressedAtRef.current = null;
        }
      }
      dialScaleRef.current += (target - dialScaleRef.current) * (1 - Math.exp(-dt * 11));
      const s = dialScaleRef.current;
      dial.scale.set(base.x * s, base.y * s, base.z * s);
      dial.position.y = dialBaseYRef.current + (s - 1) * DIAL_LIFT;
    }

    // KnobSparks anchor: the dial's top-face centre and radius in canvas px.
    // The hit volume is 1.6x the dial's height and 1.12x its radius (see
    // dialHitSize), centred on it; the hover/press growth is folded into r.
    const hit = dialHitRef.current;
    if (hit && dialHitSize) {
      const top = dialHitSize.h / 3.2;
      const rLocal = dialHitSize.r / 1.12;
      const { c, e } = anchorVecs;
      c.set(0, top, 0);
      hit.localToWorld(c).project(camera);
      let r = 0;
      for (const [dx, dz] of [[rLocal, 0], [0, rLocal]]) {
        e.set(dx, top, dz);
        hit.localToWorld(e).project(camera);
        r = Math.max(r, Math.hypot(((e.x - c.x) / 2) * size.width, ((e.y - c.y) / 2) * size.height));
      }
      knobAnchor.x = ((c.x + 1) / 2) * size.width;
      knobAnchor.y = ((1 - c.y) / 2) * size.height;
      knobAnchor.r = r * dialScaleRef.current;
    }
  });

  // Site uses `cursor: none` globally + a custom MoveableCursor ring;
  // setting document.body.style.cursor here would be overridden.
  // Every interactive element fires a `keypad-cursor-hover` window
  // CustomEvent so App.tsx can flip the MoveableCursor `hot` state.
  const handleCapEnter = (name: string) => (e: any) => {
    e.stopPropagation();
    const c = capsRef.current[name];
    if (c) c.hovered = true;
    emitCursorHover(true);
  };
  const handleCapLeave = (name: string) => (e: any) => {
    e.stopPropagation();
    const c = capsRef.current[name];
    if (c) c.hovered = false;
    emitCursorHover(false);
  };
  // Interaction pulse out to the scene (RiceBlob shockwave ring) —
  // same window-event pattern as keypad-cursor-hover.
  const emitInteract = (strength: number) => {
    window.dispatchEvent(
      new CustomEvent("keypad-interact", { detail: { strength } }),
    );
  };

  // Screen click: copy the email and flip the OLED to "copied!" (a second
  // click restarts it). No clipboard, or it refused: open mailto instead.
  const handleScreenEnter = (e: any) => {
    e.stopPropagation();
    // a tap fires over but no out, so touch would leave it stuck orange
    if (e.pointerType !== "touch") screenHotRef.current = true;
    emitCursorHover(true);
  };
  const handleScreenLeave = (e: any) => {
    e.stopPropagation();
    screenHotRef.current = false;
    emitCursorHover(false);
  };
  const handleScreenClick = (e: any) => {
    e.stopPropagation();
    screenFlashRef.current = 0.85;
    emitInteract(0.7);
    track("contact_email", { context: "keypad_copy" });
    const mailto = () => {
      window.location.href = `mailto:${COPIED.email}`;
    };
    if (!navigator.clipboard?.writeText) return mailto();
    navigator.clipboard.writeText(COPIED.email).then(async () => {
      await loadCopiedFont();
      copiedTexRef.current ??= makeCopiedTexture();
      copiedAtRef.current = performance.now();
      window.dispatchEvent(new CustomEvent("keypad-email-copied"));
    }, mailto);
  };

  const handleCapClick = (name: string) => (e: any) => {
    e.stopPropagation();
    const c = capsRef.current[name];
    if (c) c.pressedAt = performance.now();
    screenFlashRef.current = 0.85;
    emitInteract(1.0);
    const url = SOCIAL_URLS[name];
    if (!url) return;
    track("keypad_press", { key: name });
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const handleDialEnter = (e: any) => {
    e.stopPropagation();
    dialHoveredRef.current = true;
    emitCursorHover(true);
  };
  const handleDialLeave = (e: any) => {
    e.stopPropagation();
    dialHoveredRef.current = false;
    emitCursorHover(false);
  };
  const handleDialClick = (e: any) => {
    e.stopPropagation();
    dialPressedAtRef.current = performance.now();
    // Accumulate velocity: each click ADDS to the existing spin,
    // so rapid clicks let the dial reach high speeds while a single
    // click is a gentle nudge. Clamp to ceiling so we don't end up
    // with a strobing dial that visually freezes.
    const next = dialVelRef.current + DIAL_KICK;
    dialVelRef.current = Math.min(next, DIAL_MAX_VEL);
    screenFlashRef.current = Math.min(1, screenFlashRef.current + 0.45);
    emitInteract(0.7);
    // Jiggle the whole device (KeypadScene listens and wobbles the group).
    window.dispatchEvent(new CustomEvent("keypad-knob-press"));
  };

  // Two-level grouping: outer scales the whole keypad to fit the
  // camera frame, inner translates so the (already-scaled) centroid
  // lands at origin. Hit volumes live inside the inner group so
  // their positions are in the same local frame as the cloned model.
  return (
    <group scale={fitScale}>
      <group position={recenterOffset}>
        <primitive object={cloned} />
        {SOCIAL_KEYS.map((name) => {
          const cap = caps[name];
          if (!cap) return null;
          return (
            <mesh
              key={name}
              position={[cap.hitPos.x, cap.hitPos.y, cap.hitPos.z]}
              onPointerOver={handleCapEnter(name)}
              onPointerOut={handleCapLeave(name)}
              onClick={handleCapClick(name)}
            >
              <boxGeometry args={[cap.hitSize.x, cap.hitSize.y, cap.hitSize.z]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          );
        })}
        {screenHit && (
          <mesh
            position={screenHit.pos}
            onPointerOver={handleScreenEnter}
            onPointerOut={handleScreenLeave}
            onClick={handleScreenClick}
          >
            <boxGeometry args={[screenHit.size.x, screenHit.size.y, screenHit.size.z]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )}
        {dial && dialHitPos && dialHitSize && (
          <mesh
            ref={dialHitRef}
            position={[dialHitPos.x, dialHitPos.y, dialHitPos.z]}
            onPointerOver={handleDialEnter}
            onPointerOut={handleDialLeave}
            onClick={handleDialClick}
          >
            {/* Hit volume fitted to the dial (see dialHitSize). Cylinder
                axis is +Y, matching the dial's rotational axis. */}
            <cylinderGeometry args={[dialHitSize.r, dialHitSize.r, dialHitSize.h, 32]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )}
      </group>
    </group>
  );
}
