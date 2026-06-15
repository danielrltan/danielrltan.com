import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import * as THREE from "three";
import { SECTION_REGISTRY, findSectionElements } from "./sectionRegistry";
import { scrollToSection, setScrollLocked } from "./portfolio/Keypad";
import { MercuryAura, type CursorState, type AuraTarget } from "./MercuryAura";
import {
  houseGeom,
  questionGeom,
  macGeom,
  briefcaseGeom,
  playGeom,
  trophyGeom,
  planeGeom,
} from "./menuGeometries";
import "./crt-channel-menu.css";

/**
 * NAV SPILL MENU — opening the status card spills a small 3D arrangement of
 * assorted objects (icosahedron, cube, sphere, octahedron, torus, ...) into
 * the top-right, each wearing the hero's orange ASCII / glyph-dither filter
 * and carrying a label for the section it jumps to. They tumble out like
 * dice spilled onto a table, idle-float, parallax to the cursor, and lift
 * on hover. Click an object (or its label) to fly the page to that section.
 *
 * Real R3F 3D; the labels are drei <Html> buttons (so interaction + keyboard
 * + a11y ride on clean DOM). Honors prefers-reduced-motion (no tumble/parallax).
 */

const ACCENT = "#e87040";

// Resting 3/4 pose for every spill icon: a gentle yaw (right side face
// visible) + a slight upward pitch (top tipped toward the camera) so the
// extruded silhouettes read as chunky 3D objects, not flat-on stamps.
const REST_YAW = 0.26; // ~15°
const REST_PITCH = 0.16; // ~9° (positive tips the top toward the viewer)

/* House ASCII glyph material (ported from HeroGlyphRing): a screen-space
   glyph-tile dither, shaded by the surface normal, painted in orange — so
   each 3D object reads as the site's ASCII texture. */
const ASCII_VERT = /* glsl */ `
  varying vec3 vNormalW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const ASCII_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vNormalW;
  uniform vec3 uGlow;
  uniform float uCell;
  uniform vec3 uLightDir;
  uniform float uActive;

  float bayer2(vec2 p) {
    float x2 = mod(p.x, 2.0);
    float y2 = mod(p.y, 2.0);
    return 3.0 * y2 + x2 * (2.0 - 4.0 * y2);
  }
  float bayer4(vec2 p) {
    p = floor(p);
    return (4.0 * bayer2(floor(p / 2.0)) + bayer2(p) + 0.5) / 16.0;
  }
  float tileMask(float idx, vec2 p) {
    vec2 a = abs(p - 0.5);
    float box = max(a.x, a.y);
    float d1 = abs(p.x + p.y - 1.0);
    float d2 = abs(p.x - p.y);
    float inT = step(box, 0.42);
    if (idx < 0.5) return 0.0;
    else if (idx < 1.5) return step(box, 0.13);
    else if (idx < 2.5) return step(d1, 0.11) * inT;
    else if (idx < 3.5) return max(step(d1, 0.10), step(d2, 0.10)) * inT;
    else if (idx < 4.5) return step(box, 0.40) - step(box, 0.26);
    else if (idx < 5.5) {
      float f = step(box, 0.40) - step(box, 0.26);
      float s = step(d1, 0.10) * step(box, 0.26);
      return clamp(f + s, 0.0, 1.0);
    } else if (idx < 6.5) return step(box, 0.30);
    return step(box, 0.44);
  }
  void main() {
    float lum = dot(normalize(vNormalW), normalize(uLightDir)) * 0.5 + 0.5;
    lum = clamp(lum * 0.9 + 0.12 + uActive * 0.3, 0.0, 1.0);
    vec2 cell = gl_FragCoord.xy / uCell;
    float dith = bayer4(floor(cell));
    float idx = clamp(floor(lum * 7.0 + dith), 0.0, 7.0);
    float mask = tileMask(idx, fract(cell));
    if (mask < 0.5) discard;
    gl_FragColor = vec4(uGlow, 1.0);
    #include <colorspace_fragment>
  }
`;

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}
// Deterministic per-object pseudo-random in [0,1) for varied paths.
function hashF(n: number): number {
  const s = Math.sin(n * 53.13) * 7891.23;
  return s - Math.floor(s);
}
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// One geometry + size + idle-spin per section (index matches SECTION_REGISTRY).
interface Spec {
  geom: () => THREE.BufferGeometry;
  size: number;
  spin: [number, number, number];
}
const CLUSTER_CENTER = new THREE.Vector3(0, 0, 0);
// Thematic low-poly object per section (index matches SECTION_REGISTRY):
// Hero=house, About=?, Projects=Mac, Work=briefcase, Play=▶, Photos=camera,
// Contact=envelope. Each is a chunky shape the label sits on.
const SPECS: Spec[] = [
  { geom: houseGeom, size: 0.95, spin: [0, 0, 0] }, // Hero
  { geom: questionGeom, size: 0.95, spin: [0, 0, 0] }, // About
  { geom: macGeom, size: 0.95, spin: [0, 0, 0] }, // Projects
  { geom: briefcaseGeom, size: 0.95, spin: [0, 0, 0] }, // Work
  { geom: playGeom, size: 0.95, spin: [0, 0, 0] }, // Play
  { geom: trophyGeom, size: 0.95, spin: [0, 0, 0] }, // Honors (trophy wall)
  { geom: planeGeom, size: 0.95, spin: [0, 0, 0] }, // Contact
];
// A CLOCKWISE ring centred on screen with index 0 (Hero) at top-centre
// (12 o'clock); subsequent sections step clockwise around the circle.
const RING_RADIUS = 2.25;
function ringTarget(i: number, n: number): THREE.Vector3 {
  const ang = Math.PI / 2 - (i / n) * Math.PI * 2; // top, then clockwise
  const z = (hashF(i * 3.7) - 0.5) * 0.7;
  return new THREE.Vector3(
    Math.cos(ang) * RING_RADIUS,
    Math.sin(ang) * RING_RADIUS,
    z,
  );
}
// Objects BURST out from the centre to their ring positions.
const SPILL_ORIGIN = new THREE.Vector3(0, 0, 0.6);

// Jump-menu label overrides (keyed by section number). Empty now that the
// registry itself carries the friendly labels (Projects, Honors, ...).
const MENU_LABELS: Record<string, string> = {};

function SpillObject({
  index,
  label,
  active,
  armed,
  startMs,
  reduced,
  onSelect,
  onArm,
  posEntry,
  closing,
  closeMsRef,
}: {
  index: number;
  label: string;
  active: boolean;
  armed: boolean;
  startMs: number;
  reduced: boolean;
  onSelect: () => void;
  onArm: () => void;
  posEntry: AuraTarget;
  closing: boolean;
  closeMsRef: React.MutableRefObject<number>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const stretchRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const labelRef = useRef<HTMLButtonElement>(null);
  const armRef = useRef(armed);
  armRef.current = armed;
  const scaleRef = useRef(0);
  const smearRef = useRef(0);
  const prevSpRef = useRef({ x: 0, y: 0, init: false });

  const spec = SPECS[index]!;
  const geometry = useMemo(() => spec.geom(), [spec]);
  const target = useMemo(
    () => ringTarget(index, SECTION_REGISTRY.length),
    [index],
  );
  // Per-object varied start (so they don't all launch from the exact same
  // point) and a signed arc amount (so each curves its OWN way, not all the
  // same down-then-up swoop).
  const start = useMemo(
    () =>
      SPILL_ORIGIN.clone().add(
        new THREE.Vector3(
          (hashF(index * 1.7) - 0.5) * 0.9,
          (hashF(index * 2.3 + 1) - 0.5) * 0.8,
          (hashF(index * 3.1 + 2) - 0.5) * 0.7,
        ),
      ),
    [index],
  );
  const arcAmt = useMemo(() => (hashF(index * 4.7 + 3) - 0.5) * 0.7, [index]);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: ASCII_VERT,
        fragmentShader: ASCII_FRAG,
        uniforms: {
          uGlow: { value: new THREE.Color(ACCENT) },
          uCell: { value: 9.0 },
          uLightDir: { value: new THREE.Vector3(0.5, 0.8, 0.6).normalize() },
          uActive: { value: 0 },
        },
        side: THREE.DoubleSide,
        transparent: true,
      }),
    [],
  );

  useFrame((_, dt) => {
    const g = groupRef.current;
    const m = meshRef.current;
    const sgrp = stretchRef.current;
    if (!g || !m || !sgrp) return;
    const now = performance.now();
    const dtc = Math.min(dt, 0.05);
    // Deal-out progress. OPEN: p 0→1 (each object spills out from the centre to
    // its ring slot, staggered + quart ease-out). CLOSE: the SAME animation
    // played backwards — p 1→0 (each retracts to the centre), with reversed
    // stagger + time-reversed ease, so the close is literally the open reversed.
    let p: number;
    if (reduced) {
      p = closing ? 0 : 1;
    } else if (closing) {
      // True time-reverse of the open: reversed stagger + easeOutQuart(1 - τ)
      // (NOT 1 - easeOutQuart(τ), which isn't the reverse). p runs 1 → 0 and
      // ACCELERATES into the centre, exactly mirroring the open's decelerate-out.
      const ce =
        (now - closeMsRef.current) / 1000 -
        (SECTION_REGISTRY.length - 1 - index) * 0.05;
      p = easeOutQuart(1 - clamp01(ce / 0.5));
    } else {
      const e = (now - startMs) / 1000 - index * 0.05;
      p = easeOutQuart(clamp01(e / 0.5));
    }

    // Spill position = lerp start->target + a per-object signed ARC bump, so
    // each curves its own way (not all the same swoop).
    const sx = start.x + (target.x - start.x) * p;
    const sy = start.y + (target.y - start.y) * p;
    const sz = start.z + (target.z - start.z) * p;
    const dxT = target.x - start.x;
    const dyT = target.y - start.y;
    const lenT = Math.hypot(dxT, dyT) || 1;
    const arc = Math.sin(clamp01(p) * Math.PI) * arcAmt;
    const curSx = sx + (-dyT / lenT) * arc;
    const curSy = sy + (dxT / lenT) * arc;

    // Velocity (pre-bob) for the motion-blur smear.
    const prev = prevSpRef.current;
    let vx = 0;
    let vy = 0;
    if (prev.init) {
      vx = (curSx - prev.x) / dtc;
      vy = (curSy - prev.y) / dtc;
    }
    prev.x = curSx;
    prev.y = curSy;
    prev.init = true;

    // Final position + idle float.
    let bobx = 0;
    let boby = 0;
    if (!reduced) {
      const t = now / 1000;
      const ph = index * 1.3;
      bobx = Math.cos(t * 0.7 + ph) * 0.05;
      boby = Math.sin(t * 0.9 + ph) * 0.07;
    }
    g.position.set(curSx + bobx, curSy + boby, sz);

    // Idle tumble + EXAGGERATED entrance spin: while an object is dealing out
    // (p < 1) it spins fast and unwinds to its idle tumble, so each shape
    // visibly whirls into place as it grows. (1-p)^1.5 keeps real angular
    // speed through the visible part of the grow-in, not just the first frame.
    if (!reduced) {
      // Entrance whirl that DECAYS to a gentle 3/4 REST POSE (not flat-on),
      // so each icon ends up readable AND shows its extruded depth — a small
      // yaw reveals the right side face, a small pitch tips the top toward
      // the camera, so it reads as a dimensional object catching light rather
      // than a flat stamp. The whirl is an extra full turn on yaw that decays
      // into REST_YAW. It must spin the SAME rotational direction on open AND
      // close: on open `es` falls 1→0 (yaw winds DOWN to rest); reusing the
      // +whirl on close (es 0→1) would wind yaw back UP — the icons visibly
      // "reorient the opposite direction" on back-out (reported bug). Negate
      // the whirl while closing so the self-spin keeps turning the same way as
      // it retracts (only the spiral/position reverses, not each icon's spin).
      const es = Math.pow(1 - clamp01(p), 1.6);
      const whirlDir = closing ? -1 : 1;
      m.rotation.set(REST_PITCH, REST_YAW + whirlDir * es * Math.PI * 2, 0);
    } else {
      m.rotation.set(REST_PITCH, REST_YAW, 0);
    }
    // Scale: SHRINK -> full (so each emerges small) * hover lift.
    const hoverMul = armRef.current ? 1.54 : 1.0;
    const targetScale = spec.size * clamp01(p) * hoverMul;
    scaleRef.current += (targetScale - scaleRef.current) * (1 - Math.exp(-dtc * 14));
    m.scale.setScalar(scaleRef.current);

    // Report world position + radius so the mercury aura can hug this object.
    g.getWorldPosition(posEntry.pos);
    posEntry.r = scaleRef.current;

    // CARTOON SMEAR (artificial motion blur): stretch along the travel
    // direction + squash perpendicular, scaled by speed — so as it's spat out
    // it streaks like a smear frame, then snaps back round as it settles.
    const speed = Math.hypot(vx, vy);
    const smearTarget = reduced ? 0 : Math.min(0.85, speed * 0.1);
    smearRef.current += (smearTarget - smearRef.current) * (1 - Math.exp(-dtc * 18));
    const s = smearRef.current;
    if (s > 0.004 && speed > 0.001) {
      sgrp.rotation.z = Math.atan2(vy, vx);
    }
    sgrp.scale.set(1 + s * 1.7, 1 / (1 + s * 0.95), 1);

    // Orange glow is reserved for the ACTIVE object (you-are-here). Hover gets
    // only a whisper of glow — the scale + the venom hug are its cue — so it
    // can't be mistaken for the active one.
    const ua = material.uniforms.uActive!;
    const tgt = active ? 1 : armRef.current ? 0.22 : 0;
    ua.value += (tgt - (ua.value as number)) * (1 - Math.exp(-dtc * 10));

    // Label opacity tied to the deal progress: the <Html> label is a fixed-size
    // DOM element, so it can't shrink with the object — if it stayed visible
    // while the objects retract to the centre on close, all the labels would
    // clump into an unreadable pile. So show the label ONLY when its object is
    // out near its ring slot (p high); fade it out well before the object
    // reaches the centre (and fade it in only after it has spread on open).
    const lab = labelRef.current;
    if (lab) {
      const lo = clamp01((p - 0.55) / 0.35);
      lab.style.opacity = lo.toFixed(3);
      lab.style.pointerEvents = lo > 0.5 ? "auto" : "none";
    }
  });

  return (
    <group ref={groupRef}>
      {/* stretch group carries the cartoon smear so the LABEL stays unsmeared. */}
      <group ref={stretchRef}>
        <mesh
          ref={meshRef}
          geometry={geometry}
          material={material}
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          onPointerOver={(e) => {
            e.stopPropagation();
            onArm();
            document.body.style.cursor = "pointer";
          }}
          onPointerOut={() => {
            document.body.style.cursor = "";
          }}
        />
      </group>
      {/* Label sits ON the object (white text, no card). */}
      <Html center position={[0, 0, 0]} distanceFactor={6} zIndexRange={[40, 0]}>
        <button
          ref={labelRef}
          className="navx-spill-label"
          data-active={active ? "true" : "false"}
          data-armed={armed ? "true" : "false"}
          onClick={onSelect}
          onPointerEnter={onArm}
          tabIndex={armed ? 0 : -1}
        >
          {label}
        </button>
      </Html>
    </group>
  );
}

/**
 * The arrangement group: rotates around its centre toward the cursor — a
 * REAL parallax (near objects swing more than far ones, you see different
 * sides) rather than panning the whole thing around the viewport.
 */
function SpillField({
  activeIdx,
  armed,
  setArmed,
  startMs,
  reduced,
  pointer,
  select,
  positionsRef,
  closing,
  closeMsRef,
}: {
  activeIdx: number;
  armed: number;
  setArmed: (i: number) => void;
  startMs: number;
  reduced: boolean;
  pointer: React.MutableRefObject<{ x: number; y: number }>;
  select: (i: number) => void;
  positionsRef: React.MutableRefObject<AuraTarget[]>;
  closing: boolean;
  closeMsRef: React.MutableRefObject<number>;
}) {
  const fieldRef = useRef<THREE.Group>(null);
  // Parallax base, tracked separately from the spin so the two can be summed
  // each frame (lerping the *sum* would fight the decaying spin).
  const rotYRef = useRef(0);
  const rotXRef = useRef(0);
  useFrame((_, dt) => {
    const g = fieldRef.current;
    if (!g) return;
    const dtc = Math.min(dt, 0.05);
    const now = performance.now();
    const elapsed = (now - startMs) / 1000;
    // Parallax target (toward cursor); zero under reduced motion.
    const ty = reduced ? 0 : pointer.current.x * 0.1;
    const tx = reduced ? 0 : -pointer.current.y * 0.08;
    const k = 1 - Math.exp(-dtc * 5);
    rotYRef.current += (ty - rotYRef.current) * k;
    rotXRef.current += (tx - rotXRef.current) * k;
    // ENTRANCE / EXIT SPIN: a modest in-plane (Z) whirl. OPEN eases out
    // (1.3π → 0). CLOSE is the EXACT reverse: it winds back up (0 → 1.3π) over
    // the same curve played backwards. Combined with the per-object retract,
    // the close is literally the open animation in reverse (spirals back in).
    let spinOff = 0;
    if (!reduced) {
      // Same duration + same curve, exactly reversed: open eases 1.3π → 0 over
      // SPIN_DUR; close is pow(t)^3.5 (the time-reverse of pow(1-t)^3.5) over
      // the SAME SPIN_DUR, winding 0 → 1.3π. So the spin mirrors the open.
      const SPIN_DUR = 0.85;
      if (closing) {
        const cp = clamp01((now - closeMsRef.current) / 1000 / SPIN_DUR);
        spinOff = Math.pow(cp, 3.5) * -Math.PI * 1.3;
      } else {
        const e = clamp01(elapsed / SPIN_DUR);
        spinOff = Math.pow(1 - e, 3.5) * -Math.PI * 1.3;
      }
    }
    g.position.copy(CLUSTER_CENTER);
    g.scale.setScalar(1); // the per-object retract handles the shrink on close
    g.rotation.y = rotYRef.current; // cursor parallax only
    g.rotation.x = rotXRef.current; // cursor parallax only
    // In-plane spin = the entrance/exit whirl ONLY (no auto-spin drift, no
    // user drag-to-spin — both removed per request).
    g.rotation.z = spinOff;
  });
  return (
    <group ref={fieldRef} position={CLUSTER_CENTER}>
      {SECTION_REGISTRY.map((s, i) => (
        <SpillObject
          key={s.number}
          index={i}
          label={MENU_LABELS[s.number] ?? s.label}
          active={i === activeIdx}
          armed={i === armed}
          startMs={startMs}
          reduced={reduced}
          onSelect={() => select(i)}
          onArm={() => setArmed(i)}
          posEntry={positionsRef.current[i]!}
          closing={closing}
          closeMsRef={closeMsRef}
        />
      ))}
    </group>
  );
}

interface Props {
  open: boolean;
  activeIdx: number;
  onClose: () => void;
}

export function NavSpillMenu({ open, activeIdx, onClose }: Props) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [armed, setArmed] = useState(activeIdx);
  const startMsRef = useRef(0);
  const closeMsRef = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });
  // Cursor in screen UV (0..1, y-down) for the rice pool that follows it.
  const cursor = useRef<CursorState>({ x: 0.5, y: 0.5, active: false });
  // World position + radius of each object, written per-frame by the spill
  // objects and read by the aura to hug the hovered one.
  const positionsRef = useRef<AuraTarget[]>(
    SECTION_REGISTRY.map(() => ({
      pos: new THREE.Vector3(9999, 9999, 9999),
      r: 0,
    })),
  );
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Stamp the close-start time SYNCHRONOUSLY on the open→close transition,
  // during the SAME render that flips `closing` true for the canvas. The
  // <Canvas> stays mounted through the whole close, so its useFrame loop is
  // already running; if we left the timestamp to the [open] effect below
  // (which runs AFTER commit), the first closing frame could read a STALE
  // closeMsRef from a previous close — that computes a fully-wound spin and
  // SNAPS every object to its end-of-close orientation for a frame before
  // the animation restarts. That one-frame snap is the reported back-out
  // glitch ("objects flip to the opposite orientation, then spin back").
  // Stamping here guarantees the first closing frame reads a fresh start.
  const prevOpenRef = useRef(open);
  if (prevOpenRef.current !== open) {
    if (!open && mounted) closeMsRef.current = performance.now();
    prevOpenRef.current = open;
  }

  useEffect(() => {
    if (open) {
      startMsRef.current = performance.now();
      setArmed(activeIdx);
      cursor.current.active = false;
      setMounted(true);
      setScrollLocked(true); // page can't be scrolled under the open menu
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setScrollLocked(false);
    if (mounted) {
      // closeMsRef is stamped synchronously on the open→close transition
      // (see prevOpenRef above) so the first closing frame never reads a
      // stale timestamp; here we only own the fade/unmount timeouts.
      // Background opacity stays CONSTANT (shown=true) through the entire
      // spin-away — no drop. Only ONCE the objects have spun/retracted away
      // (~0.85s) do we flip shown=false for a single clean fade, then unmount.
      const fadeT = window.setTimeout(() => setShown(false), 850);
      const unmountT = window.setTimeout(() => setMounted(false), 1160);
      return () => {
        window.clearTimeout(fadeT);
        window.clearTimeout(unmountT);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Safety: always unlock scroll if the menu unmounts while open.
  useEffect(() => () => setScrollLocked(false), []);

  // Pointer: cursor (rice) + parallax + Escape.
  useEffect(() => {
    if (!mounted) return;
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
      cursor.current.x = e.clientX / window.innerWidth;
      cursor.current.y = e.clientY / window.innerHeight;
      cursor.current.active = true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
      document.body.style.cursor = "";
    };
  }, [mounted, onClose]);

  const select = (i: number) => {
    const opts = reduced ? { immediate: true } : { duration: 1.1 };
    // Beat-aware jump: if the section parks a sub-beat (Play → the "Some
    // interests" reel inside the Other pin), scroll to that fraction of the
    // named pin instead of the section top, so the jump lands on the right
    // beat. Falls back to the section element if the pin isn't live yet.
    const entry = SECTION_REGISTRY[i];
    if (entry?.pinId && entry.jumpProgress != null) {
      const st = ScrollTrigger.getById(entry.pinId);
      if (st) {
        const y = st.start + entry.jumpProgress * (st.end - st.start);
        scrollToSection(y, opts);
        onClose();
        return;
      }
    }
    const el = (findSectionElements()[i]?.el as HTMLElement | null) ?? null;
    if (el) scrollToSection(el, opts);
    onClose();
  };

  if (!mounted) return null;

  return (
    <div className="navx-spill-root" data-open={shown ? "true" : "false"}>
      <div className="navx-spill-scrim" onClick={onClose} aria-hidden />
      <button
        className="navx-close"
        onClick={onClose}
        aria-label="Close section menu"
      />
      <div className="navx-spill-stage">
        <Canvas
          className="navx-spill-canvas"
          camera={{ position: [0, 0, 10], fov: 40 }}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true }}
          onPointerMissed={onClose}
        >
          <MercuryAura
            cursorRef={cursor}
            positionsRef={positionsRef}
            reduced={reduced}
          />
          <SpillField
            activeIdx={activeIdx}
            armed={armed}
            setArmed={setArmed}
            startMs={startMsRef.current}
            reduced={reduced}
            pointer={pointer}
            select={select}
            positionsRef={positionsRef}
            closing={!open}
            closeMsRef={closeMsRef}
          />
        </Canvas>
      </div>
    </div>
  );
}
