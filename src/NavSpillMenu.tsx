import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { SECTION_REGISTRY, findSectionElements } from "./sectionRegistry";
import { scrollToSection, setScrollLocked } from "./portfolio/Keypad";
import { MercuryAura, type CursorState, type AuraTarget } from "./MercuryAura";
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
const SPECS: Spec[] = [
  { geom: () => new THREE.IcosahedronGeometry(1, 0), size: 0.82, spin: [0.4, 0.5, 0.0] },
  { geom: () => new THREE.BoxGeometry(1.4, 1.4, 1.4), size: 0.8, spin: [0.45, -0.4, 0.2] },
  { geom: () => new THREE.SphereGeometry(1, 24, 18), size: 0.9, spin: [0.35, 0.5, 0.25] },
  { geom: () => new THREE.OctahedronGeometry(1, 0), size: 0.92, spin: [-0.5, 0.4, 0.0] },
  { geom: () => new THREE.TorusGeometry(0.72, 0.3, 16, 32), size: 0.9, spin: [0.5, 0.35, 0.2] },
  { geom: () => new THREE.DodecahedronGeometry(1, 0), size: 0.9, spin: [0.4, -0.45, 0.0] },
  { geom: () => new THREE.ConeGeometry(0.9, 1.5, 18), size: 0.88, spin: [0.32, 0.55, 0.1] },
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

// Jump-menu label overrides (keyed by section number). The dial/footer keep the
// registry names; the jump page uses these friendlier labels.
const MENU_LABELS: Record<string, string> = {
  "02": "Projects",
  "05": "Photos",
};

// Drag-to-spin bookkeeping: grab the wheel and flick it; vel carries on release.
interface DragState {
  active: boolean;
  lastAng: number;
  lastT: number;
  vel: number; // rad/s, decays after release
  moved: boolean; // true once dragged enough to suppress the click
}

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
}) {
  const groupRef = useRef<THREE.Group>(null);
  const stretchRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
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
    // Staggered deal-out progress (slower + more stagger + smooth ease so it
    // doesn't all spit out at once).
    let p: number;
    if (reduced) {
      p = 1;
    } else {
      // Snappy: short duration + tight stagger + a quart ease-out.
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
      const es = Math.pow(1 - clamp01(p), 1.5);
      const spin = es * 7; // gentle extra spin during entrance (calm, not frantic)
      m.rotation.y += dtc * (spec.spin[1] + spin);
      m.rotation.x += dtc * (spec.spin[0] + spin * 0.5);
      m.rotation.z += dtc * (spec.spin[2] + spin * 0.2);
    }
    // Scale: SHRINK -> full (so each emerges small) * hover lift.
    const hoverMul = armRef.current ? 1.28 : 1.0;
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

    const ua = material.uniforms.uActive!;
    const tgt = active ? 1 : armRef.current ? 0.6 : 0;
    ua.value += (tgt - (ua.value as number)) * (1 - Math.exp(-dtc * 10));
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
  closeMs,
  dragRotRef,
  dragRef,
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
  closeMs: number;
  dragRotRef: React.MutableRefObject<number>;
  dragRef: React.MutableRefObject<DragState>;
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
    // ENTRANCE SPIN: a modest in-plane (Z) whirl with an exponential ease-out
    // — starts close to settled (small amount) and decelerates to rest.
    let spinOff = 0;
    if (!reduced) {
      const e = clamp01(elapsed / 1.1);
      spinOff = Math.pow(1 - e, 3.5) * -Math.PI * 1.3;
    }
    // AMBIENT: a slow, continuous idle drift so the wheel is always gently
    // turning (subtle — slow enough that objects stay easy to click).
    const ambient = reduced ? 0 : elapsed * 0.14;
    // DRAG INERTIA: when not actively dragging, the flick velocity carries the
    // wheel and decays — flick it and it keeps spinning with flow.
    if (!reduced && !dragRef.current.active) {
      dragRotRef.current += dragRef.current.vel * dtc;
      dragRef.current.vel *= Math.exp(-dtc * 1.8);
    }
    // CLOSE: the reverse of the open — the ring spins INWARD and shrinks to a
    // point (spirals into thin air); the scrim then fades (CSS delay).
    let scl = 1;
    let closeSpin = 0;
    if (closing && !reduced) {
      const cp = clamp01((now - closeMs) / 1000 / 0.5);
      const ce = 1 - Math.pow(1 - cp, 2); // ease-out growth (same feel as open)
      scl = Math.max(0.0001, 1 - cp * cp); // shrink to a point at the centre
      closeSpin = ce * Math.PI * 1.3;
    }
    g.position.copy(CLUSTER_CENTER);
    g.scale.setScalar(scl);
    g.rotation.y = rotYRef.current; // cursor parallax only
    g.rotation.x = rotXRef.current; // cursor parallax only
    // In-plane wheel spin: entrance + ambient drift + drag/flick + close.
    g.rotation.z = spinOff + ambient + dragRotRef.current + closeSpin;
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
  // Drag-to-spin: accumulated in-plane wheel rotation + drag bookkeeping so a
  // click that was actually a drag doesn't close/select.
  const dragRotRef = useRef(0);
  const dragRef = useRef<DragState>({
    active: false,
    lastAng: 0,
    lastT: 0,
    vel: 0,
    moved: false,
  });
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (open) {
      startMsRef.current = performance.now();
      setArmed(activeIdx);
      dragRotRef.current = 0;
      dragRef.current.vel = 0;
      dragRef.current.moved = false;
      cursor.current.active = false;
      setMounted(true);
      setScrollLocked(true); // page can't be scrolled under the open menu
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setScrollLocked(false);
    if (mounted) {
      closeMsRef.current = performance.now();
      setShown(false);
      // Hold the mount through the spiral-in exit, then the fade, before
      // unmounting (the scrim fade is delayed in CSS so the spin plays first).
      const t = window.setTimeout(() => setMounted(false), 620);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Safety: always unlock scroll if the menu unmounts while open.
  useEffect(() => () => setScrollLocked(false), []);

  // Pointer: cursor (rice) + parallax + drag-to-spin + Escape.
  useEffect(() => {
    if (!mounted) return;
    const angOf = (x: number, y: number) =>
      // y-up so the drag angle matches what the viewer sees (clientY is y-down)
      Math.atan2(-(y - window.innerHeight / 2), x - window.innerWidth / 2);
    const onDown = (e: PointerEvent) => {
      dragRef.current.active = true;
      dragRef.current.moved = false;
      dragRef.current.vel = 0;
      dragRef.current.lastAng = angOf(e.clientX, e.clientY);
      dragRef.current.lastT = performance.now();
    };
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
      cursor.current.x = e.clientX / window.innerWidth;
      cursor.current.y = e.clientY / window.innerHeight;
      cursor.current.active = true;
      if (dragRef.current.active) {
        const tnow = performance.now();
        const a = angOf(e.clientX, e.clientY);
        let d = a - dragRef.current.lastAng;
        d = (((d + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        dragRotRef.current += d; // grab + spin the wheel
        const dt2 = Math.max(0.001, (tnow - dragRef.current.lastT) / 1000);
        // Smooth the flick velocity so release carries on cleanly (inertia).
        dragRef.current.vel += (d / dt2 - dragRef.current.vel) * 0.4;
        dragRef.current.lastAng = a;
        dragRef.current.lastT = tnow;
        if (Math.abs(d) > 0.002) dragRef.current.moved = true;
      }
    };
    const onUp = () => {
      dragRef.current.active = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("keydown", onKey);
      document.body.style.cursor = "";
    };
  }, [mounted, onClose]);

  // Close / select only on a genuine click, not the end of a drag-spin.
  const handleScrimClose = () => {
    if (dragRef.current.moved) return;
    onClose();
  };
  const select = (i: number) => {
    if (dragRef.current.moved) return;
    const el = (findSectionElements()[i]?.el as HTMLElement | null) ?? null;
    if (el) scrollToSection(el, reduced ? { immediate: true } : { duration: 1.1 });
    onClose();
  };

  if (!mounted) return null;

  return (
    <div className="navx-spill-root" data-open={shown ? "true" : "false"}>
      <div className="navx-spill-scrim" onClick={handleScrimClose} aria-hidden />
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
          onPointerMissed={handleScrimClose}
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
            closeMs={closeMsRef.current}
            dragRotRef={dragRotRef}
            dragRef={dragRef}
          />
        </Canvas>
      </div>
    </div>
  );
}
