import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { SECTION_REGISTRY, findSectionElements } from "./sectionRegistry";
import { scrollToSection } from "./portfolio/Keypad";
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

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// One geometry per section (assorted shapes), + scattered rest pose.
interface Spec {
  geom: () => THREE.BufferGeometry;
  size: number;
  target: [number, number, number];
  spin: [number, number, number];
}
// The arrangement is CENTRED at the origin and framed by a contained
// top-right canvas region, so it always fits regardless of page aspect
// (positioning it in the corner of a full-screen frustum overflowed on
// narrow/short windows). The group rotates toward the cursor (parallax);
// targets are compact offsets around the centre.
const CLUSTER_CENTER = new THREE.Vector3(0, 0, 0);
const SPECS: Spec[] = [
  { geom: () => new THREE.IcosahedronGeometry(1, 0), size: 0.76, target: [-1.5, 1.15, 0.3], spin: [0.4, 0.5, 0.0] },
  { geom: () => new THREE.BoxGeometry(1.4, 1.4, 1.4), size: 0.62, target: [0.3, 1.6, -0.4], spin: [0.45, -0.4, 0.2] },
  { geom: () => new THREE.SphereGeometry(1, 24, 18), size: 0.7, target: [1.6, 0.55, 0.5], spin: [0.35, 0.5, 0.25] },
  { geom: () => new THREE.OctahedronGeometry(1, 0), size: 0.76, target: [-0.3, -0.3, 0.8], spin: [-0.5, 0.4, 0.0] },
  { geom: () => new THREE.TorusGeometry(0.72, 0.3, 16, 32), size: 0.7, target: [1.25, -1.3, -0.1], spin: [0.5, 0.35, 0.2] },
  { geom: () => new THREE.DodecahedronGeometry(1, 0), size: 0.7, target: [-1.45, -1.25, 0.3], spin: [0.4, -0.45, 0.0] },
  { geom: () => new THREE.ConeGeometry(0.9, 1.5, 18), size: 0.7, target: [0.7, 0.2, 1.2], spin: [0.32, 0.55, 0.1] },
];
// Corner of the region the objects spill OUT from (offset from centre).
const SPILL_ORIGIN = new THREE.Vector3(2.2, 2.2, 1.2);

function SpillObject({
  index,
  label,
  active,
  armed,
  startMs,
  reduced,
  onSelect,
  onArm,
}: {
  index: number;
  label: string;
  active: boolean;
  armed: boolean;
  startMs: number;
  reduced: boolean;
  onSelect: () => void;
  onArm: () => void;
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
    () => new THREE.Vector3(...spec.target),
    [spec],
  );
  const start = useMemo(
    () =>
      SPILL_ORIGIN.clone().add(
        new THREE.Vector3(
          (index % 3) * 0.12,
          (index % 2) * 0.1,
          index * 0.05,
        ),
      ),
    [index],
  );
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
      const e = (now - startMs) / 1000 - index * 0.1;
      p = easeOutCubic(clamp01(e / 0.95));
    }

    // Spill position = lerp start->target + a perpendicular ARC bump (peaks
    // mid-flight) so each object tosses out on a curve, not a straight line.
    const sx = start.x + (target.x - start.x) * p;
    const sy = start.y + (target.y - start.y) * p;
    const sz = start.z + (target.z - start.z) * p;
    const dxT = target.x - start.x;
    const dyT = target.y - start.y;
    const lenT = Math.hypot(dxT, dyT) || 1;
    const arc = Math.sin(clamp01(p) * Math.PI) * 0.55;
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

    // Idle tumble.
    if (!reduced) {
      m.rotation.x += dtc * spec.spin[0];
      m.rotation.y += dtc * spec.spin[1];
      m.rotation.z += dtc * spec.spin[2];
    }
    // Scale: SHRINK -> full (so each emerges small) * hover lift.
    const hoverMul = armRef.current ? 1.28 : 1.0;
    const targetScale = spec.size * clamp01(p) * hoverMul;
    scaleRef.current += (targetScale - scaleRef.current) * (1 - Math.exp(-dtc * 14));
    m.scale.setScalar(scaleRef.current);

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
}: {
  activeIdx: number;
  armed: number;
  setArmed: (i: number) => void;
  startMs: number;
  reduced: boolean;
  pointer: React.MutableRefObject<{ x: number; y: number }>;
  select: (i: number) => void;
}) {
  const fieldRef = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    const g = fieldRef.current;
    if (!g || reduced) return;
    const ty = pointer.current.x * 0.1;
    const tx = -pointer.current.y * 0.08;
    const k = 1 - Math.exp(-dt * 5);
    g.rotation.y += (ty - g.rotation.y) * k;
    g.rotation.x += (tx - g.rotation.x) * k;
  });
  return (
    <group ref={fieldRef} position={CLUSTER_CENTER}>
      {SECTION_REGISTRY.map((s, i) => (
        <SpillObject
          key={s.number}
          index={i}
          label={s.label}
          active={i === activeIdx}
          armed={i === armed}
          startMs={startMs}
          reduced={reduced}
          onSelect={() => select(i)}
          onArm={() => setArmed(i)}
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
  const pointer = useRef({ x: 0, y: 0 });
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    if (open) {
      startMsRef.current = performance.now();
      setArmed(activeIdx);
      setMounted(true);
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    if (mounted) {
      setShown(false);
      const t = window.setTimeout(() => setMounted(false), 240);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Cursor parallax + Escape.
  useEffect(() => {
    if (!mounted) return;
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
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
    const el = (findSectionElements()[i]?.el as HTMLElement | null) ?? null;
    if (el) scrollToSection(el, reduced ? { immediate: true } : { duration: 1.1 });
    onClose();
  };

  if (!mounted) return null;

  return (
    <div className="navx-spill-root" data-open={shown ? "true" : "false"}>
      <div className="navx-spill-scrim" onClick={onClose} aria-hidden />
      <div className="navx-spill-stage">
        <Canvas
          className="navx-spill-canvas"
          camera={{ position: [0, 0, 8.2], fov: 40 }}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true }}
          onPointerMissed={onClose}
        >
          <SpillField
            activeIdx={activeIdx}
            armed={armed}
            setArmed={setArmed}
            startMs={startMsRef.current}
            reduced={reduced}
            pointer={pointer}
            select={select}
          />
        </Canvas>
      </div>
    </div>
  );
}
