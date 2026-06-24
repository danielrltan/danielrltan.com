import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import * as THREE from "three";
import { SECTION_REGISTRY, findSectionElements } from "./sectionRegistry";
import { useIsMobile } from "./useIsMobile";
import { scrollToSection, setScrollLocked } from "./portfolio/Keypad";
import { MercuryAura, type CursorState, type AuraTarget } from "./MercuryAura";
import {
  houseGeom,
  questionGeom,
  macGeom,
  briefcaseGeom,
  playGeom,
  trophyGeom,
  cameraGeom,
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

const ACCENT = "#ff4f00";

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
// easeOutBack: eases out but OVERSHOOTS past 1 near the end, then settles back
// to exactly 1 at t=1. Used on the spill RADIUS so each icon's own outward
// momentum carries it a few % past its slot and recoils in — the recoil is the
// tail of the spiral, not a separate bounce. `s` tunes the overshoot amount.
function easeOutBack(t: number, s = 1.1): number {
  const c1 = s;
  const c3 = s + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
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
// Scratch vectors for the per-frame hover projection test (module-scope so the
// loop never allocates).
const _c = new THREE.Vector3();
const _up = new THREE.Vector3();
// Thematic low-poly object per section (index matches SECTION_REGISTRY):
// Hero=house, About=?, Projects=Mac, Work=briefcase, Play=▶, Honours=trophy,
// Recents=camera, Contact=paper plane. Each is a chunky shape the label sits on.
const SPECS: Spec[] = [
  { geom: houseGeom, size: 0.95, spin: [0, 0, 0] }, // 00 Hero
  { geom: questionGeom, size: 0.95, spin: [0, 0, 0] }, // 01 About
  { geom: macGeom, size: 0.95, spin: [0, 0, 0] }, // 02 Projects
  { geom: briefcaseGeom, size: 0.95, spin: [0, 0, 0] }, // 03 Work
  { geom: playGeom, size: 0.95, spin: [0, 0, 0] }, // 04 Play
  { geom: trophyGeom, size: 0.95, spin: [0, 0, 0] }, // 05 Honours (trophy wall)
  { geom: cameraGeom, size: 0.95, spin: [0, 0, 0] }, // 06 Recents
  { geom: planeGeom, size: 0.95, spin: [0, 0, 0] }, // 07 Contact
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

// On OPEN, hold the icons at the centre (invisible, scale 0) for this long
// BEFORE the spill begins, so the white background establishes FIRST and the
// icons spiral out against it (instead of bursting in together, which read "too
// instant"). A full mirror of the close would be ~610ms (scrim fade 260 + a
// 350ms hold), but that dead hold felt like too big a gap — so we keep just the
// scrim-establish beat (~260ms) plus a hair, and drop most of the hold. Enough
// to read "background, THEN spiral" without the wait.
const SPILL_LEAD_MS = 340;

// SETTLE DRIFT — after the spill spirals out, the field COASTS a few degrees in
// the SAME rotational direction the spill opened (the objects sweep clockwise
// into their slots, so the residual momentum is clockwise), then eases to a
// stop. This is a pure velocity DECAY — one kick at spill-start, no spring back
// toward 0 — because a spring swings RETURN past its kick, and that return read
// as a recoil spinning the opposite way. Coasting in one direction and stopping
// is the fluid follow-through we want (settles ~0.5s, a few degrees of offset).
const DRIFT_KICK = -1.1; // initial angular velocity (rad/s); negative = clockwise, matching the open sweep
const DRIFT_DECAY = 9; // 1/s velocity decay → coasts to rest in one direction, no recoil

// Jump-menu label overrides (keyed by section number). Empty — the registry
// carries the canonical labels (Projects, Play, Honours, ...) directly.
const MENU_LABELS: Record<string, string> = {};

function SpillObject({
  index,
  label,
  active,
  armed,
  startMs,
  reduced,
  onSelect,
  posEntry,
  closing,
  closeMsRef,
  pointer,
  labelDistance,
  ringScaleX,
  ringScaleY,
  objScale,
}: {
  index: number;
  label: string;
  active: boolean;
  armed: boolean;
  startMs: number;
  reduced: boolean;
  onSelect: () => void;
  posEntry: AuraTarget;
  closing: boolean;
  closeMsRef: React.MutableRefObject<number>;
  pointer: React.MutableRefObject<{ x: number; y: number }>;
  labelDistance: number;
  ringScaleX: number;
  ringScaleY: number;
  objScale: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const labelRef = useRef<HTMLButtonElement>(null);
  const armRef = useRef(armed);
  armRef.current = armed;
  const scaleRef = useRef(0);
  const stretchRef = useRef<THREE.Group>(null);
  const smearRef = useRef(0);
  const prevSpRef = useRef({ x: 0, y: 0, init: false });
  const tiltRef = useRef(0); // eased hover-parallax weight (0 → 1 on hover)

  const spec = SPECS[index]!;
  const geometry = useMemo(() => spec.geom(), [spec]);
  // Generous, forgiving hit area: a sphere sized to the object's bounds (padded)
  // carries the hover/click instead of the detailed, holey mesh. Without it you
  // could only arm an icon while exactly over its geometry — drift into a gap
  // (the @, the trophy handles) and it disarmed, so the reactive zone felt tiny.
  // It's a CHILD of the visible mesh, so it inherits the same scale/rotation and
  // grows with the icon on hover. Radius is in geometry-local units (the parent
  // mesh's scale maps it to the same world size ratio as the art).
  const hitRadius = useMemo(() => {
    geometry.computeBoundingSphere();
    return (geometry.boundingSphere?.radius ?? 1) * 1.5;
  }, [geometry]);
  // Resting ring slot. X is squashed by ringScaleX so portrait phones get a
  // VERTICAL ELLIPSE (side labels stay on-screen); the object itself is NOT
  // scaled, so the shapes stay round — only their positions move inward.
  const target = useMemo(() => {
    const t = ringTarget(index, SECTION_REGISTRY.length);
    t.x *= ringScaleX;
    t.y *= ringScaleY;
    return t;
  }, [index, ringScaleX, ringScaleY]);
  // Every icon launches from — and retracts back to — the SAME single point
  // (SPILL_ORIGIN), so the spill reads as one cohesive burst from the centre
  // rather than each appearing out of a different spot. A per-object signed arc
  // still gives each its OWN curve on the way out so the paths fan instead of
  // overlapping in one straight line, but the ORIGIN is unified.
  const start = useMemo(() => SPILL_ORIGIN.clone(), []);
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
    // its ring slot SIMULTANEOUSLY — no per-object stagger, so the whole ring
    // spirals open at once rather than being drawn clockwise one icon at a time.
    // CLOSE: the same animation time-reversed (p 1→0, all retract together).
    let p: number;
    // radFrac drives the RADIUS only. On open it rides easeOutBack so the icon
    // slips a few % PAST its slot as it arrives and recoils back in — the recoil
    // is the spiral's own deceleration, not a layered-on bounce. Everything else
    // (scale, orientation, label) stays on the monotonic `p` so nothing else
    // overshoots. On close it tracks `p` (clean retract, no recoil).
    let radFrac: number;
    if (reduced) {
      p = closing ? 0 : 1;
      radFrac = clamp01(p);
    } else if (closing) {
      // True time-reverse of the open: easeOutQuart(1 - τ) (NOT 1 -
      // easeOutQuart(τ), which isn't the reverse). p runs 1 → 0 and ACCELERATES
      // into the centre, mirroring the open. No stagger — all retract together.
      const ce = (now - closeMsRef.current) / 1000;
      p = easeOutQuart(1 - clamp01(ce / 0.5));
      radFrac = clamp01(p);
    } else {
      const tRaw = clamp01((now - startMs) / 1000 / 0.5);
      p = easeOutQuart(tRaw);
      radFrac = easeOutBack(tRaw);
    }

    // Spill position = lerp start->target + a per-object signed ARC bump, so
    // each curves its own way (not all the same swoop).
    const sz = start.z + (target.z - start.z) * p;
    const dxT = target.x - start.x;
    const dyT = target.y - start.y;
    // SPIRAL-OUT path: instead of a straight shot, each icon CORKSCREWS out from
    // the centre — its angle winds by `swirl` (which decays to 0 by p=1, so it
    // still lands EXACTLY on its slot) while the radius grows 0→R. `arcAmt` (a
    // small per-object value) just varies the swirl AMOUNT so they don't wind in
    // perfect lockstep; the direction is shared so the burst reads as one vortex.
    const slotAngle = Math.atan2(dyT, dxT);
    const R = Math.hypot(dxT, dyT);
    const cp = clamp01(p);
    const swirl = Math.PI * (0.7 + arcAmt) * (1 - cp); // extra winding, → 0 at p=1
    const rad = R * radFrac; // easeOutBack on open → overshoot the slot, recoil in
    const curSx = start.x + rad * Math.cos(slotAngle + swirl);
    const curSy = start.y + rad * Math.sin(slotAngle + swirl);

    // Frame-delta velocity — drives the motion-blur smear's magnitude/direction.
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

    // IDLE LIFE: once the icon has settled (`idle` ramps 0→1 over the last
    // sliver of the deal, so it never fights the spiral), it gently BREATHES — a
    // soft vertical float here + a subtle scale pulse below — so the menu reads
    // as alive, not a frozen stamp. Bounded + slow; the per-object phase keeps
    // them from pulsing in lockstep. (Unlike the old ungated bob that drifted
    // forever, this only wakes at rest and stays tiny.)
    const idle = reduced ? 0 : clamp01((cp - 0.8) / 0.2);
    const tNow = now / 1000;
    // Gentle Lissajous drift (different x/y frequencies + per-object phase) so
    // each icon floats in place as if suspended, not pinned to a slot. These are
    // BOUNDED sinusoids around the rest position — they never accumulate/drift.
    const floatY = Math.sin(tNow * 0.85 + index * 2.1) * 0.06 * idle;
    const floatX = Math.cos(tNow * 0.7 + index * 1.3) * 0.045 * idle;
    g.position.set(curSx + floatX, curSy + floatY, sz);

    // Rest pose = a gentle 3/4 view. On HOVER the icon tilts toward the cursor —
    // a parallax that "grabs its attention" and tracks your mouse (like the
    // keypad). `tiltRef` eases the hover in/out so the tilt never snaps.
    const wantTilt = armRef.current ? 1 : 0;
    tiltRef.current += (wantTilt - tiltRef.current) * (1 - Math.exp(-dtc * 9));
    // Same sign convention as the keypad (head-follows-hand): rotation.x += y,
    // rotation.y += −x (cursor x right-positive, y down-positive) so the icon
    // leans TOWARD the cursor, not away from it.
    const tiltX = pointer.current.y * 0.42 * tiltRef.current;
    const tiltY = -pointer.current.x * 0.42 * tiltRef.current;
    // Idle sway: a slow rocking once settled, on top of the hover tilt, so each
    // icon feels alive even with the cursor still. Bounded + per-object phase.
    const swayX = Math.sin(tNow * 0.6 + index * 1.7) * 0.05 * idle;
    const swayY = Math.cos(tNow * 0.5 + index * 2.3) * 0.05 * idle;
    m.rotation.set(REST_PITCH + tiltX + swayX, REST_YAW + tiltY + swayY, 0);
    // Scale: SHRINK -> full (so each emerges small) * hover lift * breathing.
    const hoverMul = armRef.current ? 1.54 : 1.0;
    const breath = 1 + Math.sin(tNow * 1.15 + index * 1.7) * 0.035 * idle;
    const targetScale = spec.size * objScale * clamp01(p) * hoverMul * breath;
    scaleRef.current += (targetScale - scaleRef.current) * (1 - Math.exp(-dtc * 14));
    m.scale.setScalar(scaleRef.current);

    // Report world position + radius so the mercury aura can hug this object.
    g.getWorldPosition(posEntry.pos);
    posEntry.r = scaleRef.current;

    // SPIN-OUT smear: the stretch (motion blur) follows the actual speed and
    // fades to nothing as the icon eases into its slot. `sgrp` carries it so the
    // LABEL (a sibling) stays unsmeared.
    const speed = Math.hypot(vx, vy);
    const smearTarget = reduced ? 0 : Math.min(0.85, speed * 0.1);
    smearRef.current += (smearTarget - smearRef.current) * (1 - Math.exp(-dtc * 18));
    const s = smearRef.current;
    // SPIRAL ORIENTATION — driven by the deal progress `p`, NOT the frame
    // velocity. (Velocity-based pointing crammed the whole un-rotation into the
    // last ~20% as speed decayed, which read as an end-of-animation correction.)
    // Here the icon launches leaning FULLY into its travel direction
    // (travelAngle = centre→slot, i.e. nose-first the way it's going), holds that
    // lean through the first third, then rights itself to upright across the
    // whole back portion. The smoothstep `rightWeight` is FLAT (zero slope) at
    // p=1, so the rotation reaches exactly 0 with zero angular velocity — it
    // CONVERGES to the rest orientation throughout, never snaps at the end.
    const travelAngle = Math.atan2(dyT, dxT);
    const rt = clamp01((p - 0.35) / 0.65); // ramp the righting over p ∈ [0.35, 1]
    const rightWeight = rt * rt * (3 - 2 * rt); // smoothstep: C1, flat at both ends
    sgrp.rotation.z = travelAngle * (1 - rightWeight);
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
      {/* stretch group carries the spin-out smear so the LABEL stays unsmeared. */}
      <group ref={stretchRef}>
        <mesh ref={meshRef} geometry={geometry} material={material}>
          {/* Invisible hit-proxy: a padded sphere over the object's bounds is the
              actual hover/click target, so the reactive area is the whole icon,
              not just where a ray happens to strike the holey art. It rides the
              parent's scale/rotation, so it grows with the icon on hover. */}
          <mesh
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
            }}
          >
            {/* CLICK target only. Hover/enlarge is driven by SpillField's
                every-frame screen-space proximity test (see there) — NOT
                onPointerOver/Out, which dropped intermittently as the icons
                floated/tilted under a still cursor and raced with the DOM
                label's own enter/leave (the "sometimes it won't enlarge" bug). */}
            <sphereGeometry args={[hitRadius, 12, 12]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        </mesh>
      </group>
      {/* Label sits ON the object (white text, no card). */}
      <Html center position={[0, 0, 0]} distanceFactor={labelDistance} zIndexRange={[40, 0]}>
        <button
          ref={labelRef}
          className="navx-spill-label"
          data-active={active ? "true" : "false"}
          data-armed={armed ? "true" : "false"}
          onClick={onSelect}
          tabIndex={0}
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
  cursor,
  select,
  positionsRef,
  closing,
  closeMsRef,
  labelDistance,
  ringScaleX,
  ringScaleY,
  objScale,
}: {
  activeIdx: number;
  armed: number;
  setArmed: (i: number) => void;
  startMs: number;
  reduced: boolean;
  pointer: React.MutableRefObject<{ x: number; y: number }>;
  cursor: React.MutableRefObject<CursorState>;
  select: (i: number) => void;
  positionsRef: React.MutableRefObject<AuraTarget[]>;
  closing: boolean;
  closeMsRef: React.MutableRefObject<number>;
  /** drei <Html> distanceFactor for the labels — larger on mobile so the
   *  pulled-back ring's labels stay a comfortable tap size. */
  labelDistance: number;
  /** Horizontal squash of the whole ring (1 = circle; <1 = vertical ellipse
   *  for portrait phones so the side labels don't run off the edges). */
  ringScaleX: number;
  /** Vertical stretch of the ring (>1 = taller ellipse on mobile, using the
   *  portrait viewport's spare height to spread the objects + labels apart). */
  ringScaleY: number;
  /** Per-object size multiplier (shrinks the shapes on mobile so the squashed
   *  ring doesn't merge into one blob). */
  objScale: number;
}) {
  const fieldRef = useRef<THREE.Group>(null);
  const { camera, size } = useThree();
  // Last armed index this loop pushed to React state — so we only setArmed on
  // an actual change, not every frame.
  const armedRef = useRef(-1);
  // Parallax base, tracked separately from the spin so the two can be summed
  // each frame (lerping the *sum* would fight the decaying spin).
  const rotYRef = useRef(0);
  const rotXRef = useRef(0);
  // Settle drift state: z = current drift angle, v = angular velocity, kicked =
  // whether the one-time impulse has fired this open. Fresh each open (the whole
  // menu unmounts between opens), so `kicked` re-arms naturally.
  const driftRef = useRef({ z: 0, v: 0, kicked: false });
  useFrame((_, dt) => {
    const g = fieldRef.current;
    if (!g) return;
    const dtc = Math.min(dt, 0.05);
    const now = performance.now();
    // Parallax target — leans the whole ring TOWARD the cursor, same sign
    // convention as the keypad (rotation.y += −x, rotation.x += y). Zero under
    // reduced motion.
    const ty = reduced ? 0 : -pointer.current.x * 0.1;
    const tx = reduced ? 0 : pointer.current.y * 0.08;
    const k = 1 - Math.exp(-dtc * 5);
    rotYRef.current += (ty - rotYRef.current) * k;
    rotXRef.current += (tx - rotXRef.current) * k;
    g.position.copy(CLUSTER_CENTER);
    g.scale.setScalar(1); // the per-object retract handles the shrink on close
    g.rotation.y = rotYRef.current; // cursor parallax only
    g.rotation.x = rotXRef.current; // cursor parallax only

    // SETTLE DRIFT (rotation.z): the field carries a brief decaying spin so the
    // open doesn't lock instantly. One angular impulse is kicked the moment the
    // spill begins (now ≥ startMs); from there a pure velocity-decay coast
    // carries it a few degrees in the open direction and RESTS there (no spring
    // pull back to 0 — that read as a recoil).
    //
    // It is deliberately NOT zeroed on close. The coast settles at a small
    // NON-zero offset, so forcing rotation.z to 0 on the first closing frame
    // snapped the whole ring back by that offset BEFORE the retract — the "cut
    // back a few positions, then back out" glitch. Instead the drift simply
    // HOLDS its settled value through the close (so the close's first frame
    // matches the open's last frame exactly); the objects retract to centre
    // regardless, and driftRef resets fresh on the next open (the menu unmounts
    // between opens). Only reduced-motion forces it flat.
    const dr = driftRef.current;
    if (reduced) {
      dr.z = 0;
      dr.v = 0;
    } else {
      if (!dr.kicked && now >= startMs) {
        dr.v = DRIFT_KICK;
        dr.kicked = true;
      }
      if (dr.kicked) {
        // Pure coast: velocity decays toward 0 while the angle accumulates in
        // ONE direction — no spring pull back to 0, so it never swings the
        // other way (the recoil we removed). Drifts, then rests + holds.
        dr.v *= Math.exp(-DRIFT_DECAY * dtc);
        dr.z += dr.v * dtc;
      }
    }
    g.rotation.z = dr.z;

    // ── HOVER / ENLARGE — every-frame screen-space proximity ──────────────
    // Drive `armed` from the SAME robust test the aura hug uses (project each
    // object, measure the cursor's screen distance to its disc, arm the
    // nearest one) instead of the per-object R3F pointerOver/Out, which
    // dropped intermittently as the icons floated + tilted under a still
    // cursor and raced with the DOM label's enter/leave. This is why the hug
    // always worked but the enlarge "sometimes wouldn't latch".
    const cur = cursor.current;
    let best = -1;
    let bestDist = 1e9;
    if (cur.active && !closing) {
      const ax = size.width >= size.height ? size.width / size.height : 1;
      const ay = size.width >= size.height ? 1 : size.height / size.width;
      const arr = positionsRef.current;
      for (let i = 0; i < arr.length; i++) {
        const e = arr[i];
        if (!e || e.r < 0.0001) continue;
        _c.copy(e.pos).project(camera);
        const cx = _c.x * 0.5 + 0.5;
        const cy = (1 - _c.y) * 0.5; // y-down 0..1
        _up.copy(e.pos);
        _up.y += e.r;
        _up.project(camera);
        const rad = Math.abs((1 - _up.y) * 0.5 - cy);
        const dist = Math.hypot((cx - cur.x) * ax, (cy - cur.y) * ay);
        // 1.3× the projected radius: a forgiving disc with a touch of
        // hysteresis so an edge-parked cursor doesn't chatter on/off.
        if (dist < rad * 1.3 && dist < bestDist) {
          best = i;
          bestDist = dist;
        }
      }
    }
    if (best !== armedRef.current) {
      armedRef.current = best;
      setArmed(best);
      document.body.style.cursor = best >= 0 ? "pointer" : "";
    }
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
          posEntry={positionsRef.current[i]!}
          closing={closing}
          closeMsRef={closeMsRef}
          pointer={pointer}
          labelDistance={labelDistance}
          ringScaleX={ringScaleX}
          ringScaleY={ringScaleY}
          objScale={objScale}
        />
      ))}
    </group>
  );
}

interface Props {
  open: boolean;
  activeIdx: number;
  onClose: () => void;
  /** Fired when a section is chosen from the menu (for analytics). */
  onJump?: (label: string) => void;
}

export function NavSpillMenu({ open, activeIdx, onClose, onJump }: Props) {
  // MOBILE / touch branch: the WebGL spill ring is hover-driven (enlarge + aim
  // cue ride on an every-frame screen-space proximity test against the cursor),
  // so on a phone its 8 crowded objects are nearly untappable. On coarse
  // pointers we render a plain accessible list overlay instead — large
  // full-width rows, one per section, tap to jump + close. Desktop keeps the
  // ring untouched.
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  // -1 = nothing armed. Hover arms an index (enlarge + select cue); pointer-out
  // releases back to -1. It must NOT default to activeIdx, or the current
  // section spawns permanently enlarged with no way to shrink it.
  const [armed, setArmed] = useState(-1);
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
      // Lead with the background: delay the spill so the scrim establishes
      // first, then the icons spiral out against it (see SPILL_LEAD_MS).
      startMsRef.current = performance.now() + SPILL_LEAD_MS;
      setArmed(-1); // open with nothing enlarged; hover is what arms an object
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
    // Touch has no hovering cursor, so the cursor-driven effects don't apply:
    // skip pointer/parallax tracking entirely on mobile (the ring's icons won't
    // tilt toward a phantom pointer; the mercury blob isn't rendered there).
    if (!isMobile) {
      window.addEventListener("pointermove", onMove, { passive: true });
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
      document.body.style.cursor = "";
    };
  }, [mounted, onClose, isMobile]);

  const select = (i: number) => {
    onJump?.(SECTION_REGISTRY[i]?.label ?? "");
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

  // The 3D spill ring is now the menu on EVERY viewport (the old flat mobile
  // list was replaced at the owner's request). On a phone the ring's labels are
  // real drei <Html> <button>s (tappable + keyboard/AT-reachable), the camera
  // pulls back + the FOV widens so the whole ring fits a portrait screen, and
  // the labels render larger (distanceFactor) so they stay comfortable tap
  // targets. The hover-enlarge cue simply doesn't fire on touch (no hover) —
  // tapping a label still jumps + closes.
  // NARROW-PORTRAIT FIT. The ring's world geometry is FIXED (radius 2.25,
  // camera fov/z), so its on-screen size doesn't shrink with the viewport — on a
  // narrow phone the eight objects + their labels cram into overlap (the "320px
  // squeeze"). Overlap is a RELATIVE-size problem: pulling the camera back is
  // scale-invariant and does nothing for it, so the real lever is shrinking the
  // objects + labels as the viewport narrows. `narrow` ramps 0→1 from a roomy
  // phone (≥400px, where the binary mobile values already read fine) down to the
  // tightest (≤320px). Tuned against 320 / 360 / 390 captures.
  const vw = typeof window !== "undefined" ? window.innerWidth || 390 : 390;
  const narrow = isMobile ? clamp01((400 - vw) / 80) : 0;
  // Camera distance/FOV: desktop unchanged (z=10, fov=40). Mobile pulls back
  // (z=13) and widens (fov=46) so the ring + label margins clear a portrait
  // viewport.
  const camZ = isMobile ? 13 : 10;
  const camFov = isMobile ? 46 : 40;
  // Labels shrink a touch on the tightest phones so they stop colliding, but
  // stay a comfortable tap size (distanceFactor 8 on a roomy phone → ~6.4 @320).
  const labelDistance = isMobile ? 8 - narrow * 1.6 : 6;
  // Portrait phones are tall + narrow, so the ring is squashed into a gentle
  // vertical ellipse (X compressed, Y kept) — otherwise the 3 + 9 o'clock labels
  // run off the side edges. Desktop = true circle.
  const ringScaleX = isMobile ? 0.72 : 1;
  // Stretch the ring TALLER on a phone. A portrait viewport has loads of unused
  // vertical room (the ring fills under half the height), so a vertical ellipse
  // spreads the eight objects + labels apart — separating the top
  // (Contact/Hero/About) and bottom (Honours/Play/Work) triads whose labels
  // otherwise collide. The BOTTOM triad clusters tightest (Play sits at the very
  // bottom flanked by two long labels), so push the 6-o'clock point well down —
  // there's ample room below it — to drop Play clear of its flankers. More on
  // narrow phones. Desktop = 1.
  const ringScaleY = isMobile ? 1.5 + narrow * 0.18 : 1;
  // Shrink the objects so the ring's shapes read as DISTINCT pieces instead of
  // merging into one orange blob — the bottom triad's shapes overlapped even at
  // full mobile width, so this is dialled down across the board, more as the
  // phone narrows (0.78 on a roomy phone → ~0.56 @320). Desktop = full size.
  const objScale = isMobile ? 0.78 - narrow * 0.22 : 1;

  return (
    <div className="navx-spill-root" data-open={shown ? "true" : "false"}>
      <div className="navx-spill-scrim" onClick={onClose} aria-hidden />
      <button
        className="navx-close"
        onClick={onClose}
        aria-label="Close section menu"
      />
      <div className="navx-spill-stage">
        {/* The 3D spill ring is the menu on ALL viewports now. It's an
            ON-DEMAND overlay (the canvas only mounts while the menu is open and
            tears down on close), so it's exempt from the "no persistent section
            WebGL on phones" rule — it never runs in the background. The camera +
            FOV + label scale adapt for mobile (see camZ/camFov/labelDistance
            above) so the ring fits a portrait phone and its labels stay
            tappable. */}
        <Canvas
          className="navx-spill-canvas"
          camera={{ position: [0, 0, camZ], fov: camFov }}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true }}
          onPointerMissed={onClose}
        >
          {/* Mercury cursor blob is a hover/cursor effect — skip it on touch,
              where there's no pointer for it to pool toward. */}
          {!isMobile && (
            <MercuryAura
              cursorRef={cursor}
              positionsRef={positionsRef}
              reduced={reduced}
            />
          )}
          <SpillField
            activeIdx={activeIdx}
            armed={armed}
            setArmed={setArmed}
            startMs={startMsRef.current}
            reduced={reduced}
            pointer={pointer}
            cursor={cursor}
            select={select}
            positionsRef={positionsRef}
            closing={!open}
            closeMsRef={closeMsRef}
            labelDistance={labelDistance}
            ringScaleX={ringScaleX}
            ringScaleY={ringScaleY}
            objScale={objScale}
          />
        </Canvas>
      </div>
    </div>
  );
}
