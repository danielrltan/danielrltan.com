import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { SKILL_LOGOS, liveLinkLabel, type MacProject, type SkillLogo } from "./projects";
import { useMacNarrow } from "./useMacNarrow";

// Visit ?tune=mac to enter a free-camera, slider-driven positioning
// view for re-framing the model.
const TUNE_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("tune") === "mac";

/**
 * 3D scene for the Macintosh section. THREE-BEAT scroll choreography:
 *
 *   BEAT 1: STACK   (pin 0.00 → 0.22)
 *     Mac floats high in empty cool-white space (no floor, no shadow
 *     plate). Tech-stack cards arranged in a volumetric ring around
 *     the Mac's vertical Y axis at radii 1.8-2.25 with per-card
 *     yOffset for depth. Cards are STATIC, locked at their starting
 *     orbital angle. Mac self-spins slowly for dynamism.
 *
 *   BEAT 2: ORBIT   (pin 0.22 → 0.55)
 *     Cards orbit the Mac through a slow partial revolution (ORBIT_SWEEP
 *     ≈ 1.2π). Mac continues to self-spin and stays at hover Y. Camera
 *     is locked; the orbit is the kinetic centerpiece.
 *
 *   BEAT 3: LAND + EXPLORE (pin 0.55 → 1.00)
 *     Cards dissolve (opacity → 0, scale → 0.4, position drift × 1.5
 *     outward) across 0.50 → 0.65. Mac descends from HOVER_Y to REST_Y
 *     across 0.55 → 0.78 and settles to rotation 0 (face-camera). A
 *     shadow plate fades in beneath. CRT boot text types in 0.72 →
 *     0.85 then desktop tile grid appears; click planes engage.
 *
 * Composition mirrors the Keypad scene's framing: the Mac and orbit
 * float in empty space. The wrapper section has cool off-white
 * `var(--bg-page)` underneath; the Canvas is alpha so it composites
 * onto that surface (no in-canvas floor).
 *
 * Pin progress 0..1 is read each frame from `pinProgressRef`. State
 * for the CRT (bootProgress, hoverIndex) lives in React state and is
 * throttled to ~30Hz so the CanvasTexture rebuild isn't per-frame.
 */

interface Props {
  pinProgressRef: React.MutableRefObject<number>;
  projects: MacProject[];
  onSelectProject: (p: MacProject) => void;
  /**
   * The currently-open project (or null for the tile grid). When set,
   * the CRT swaps the tile grid for the project DETAIL view AND the
   * camera dollies further IN past the landed z=2.6 so the screen face
   * fills the viewport. Cleared (→ null) by ESC / the BACK affordance,
   * which pulls the camera back out to the tile grid.
   */
  selected: MacProject | null;
  /** Close the open project (ESC / on-screen BACK). */
  onCloseProject: () => void;
  /**
   * Fires (throttled) with the CRT screen face's on-screen rect in CSS
   * pixels relative to the canvas, plus the detail-zoom progress. The DOM
   * control overlay (Macintosh.tsx) uses this to position the real
   * clickable close + live controls EXACTLY over their painted faces now
   * that the detail-zoom lands dead-on/square. Desktop only; null/0 when
   * no project is open. `vis` is the eased detail-zoom (0..1) so the DOM
   * controls can fade in only once the screen has zoomed in.
   */
  onScreenRect?: (rect: ScreenRect | null) => void;
}

/** CRT screen face projected to on-screen CSS pixels (canvas-relative). */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Eased detail-zoom progress 0..1. */
  vis: number;
}

const THRESHOLDS = {
  // Orbit sweep: cards begin rotating at orbitStart, complete one full
  // revolution by orbitEnd. The window aligns with BEAT 2.
  orbitStart: 0.18,
  orbitEnd: 0.55,
  // Card dissolve window: overlaps the start of BEAT 3 so the cards
  // are already fading as the Mac begins its descent.
  dissolveStart: 0.50,
  dissolveEnd: 0.65,
  // Mac descent: slightly trails the dissolve so the eye reads the
  // cards leaving first, then the Mac coming down to fill the space.
  descentStart: 0.55,
  descentEnd: 0.78,
  // Mac self-spin damps out into BEAT 3 so the screen is stable for
  // the user to read tiles.
  spinSettleStart: 0.50,
  spinSettleEnd: 0.65,
  // Shadow plate fades in as the Mac approaches its rest position.
  shadowStart: 0.62,
  shadowEnd: 0.78,
  // CRT boot text + desktop tile reveal.
  bootStart: 0.72,
  bootEnd: 0.85,
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// FLOAT FRAMING (BEATs 1-2): the Mac + orbit ring must sit in the
// VERTICAL CENTER of the viewport, not the top third. The composition's
// visual center of mass is the orbit-ring center (HOVER_Y + ORBIT_GROUP_Y
// offset). We keep HOVER_Y modest so the Mac housing + ring fit centered
// in the frame once the camera lookAt is parked at that same center
// (DOLLY_LOOK_Y_WIDE below). Previously HOVER_Y=0.7 + a high camera
// lookAt biased everything into the upper third of frame, leaving the
// bottom half dead-empty. HOVER_Y=0.15 drops the float so that, with the
// camera looking at the composition center (~0.45), the Mac + ring read
// centered top-to-bottom.
const MAC_HOVER_Y = 0.15;
const MAC_REST_Y = -0.2;
// Mac self-spin during BEATs 1-2. Changed from a continuous full
// revolution to a slow Y-axis SWAY around the front-facing orientation.
// Rationale: directive (2) is "spin LESS" and directive (3) is "screen
// facing the viewer (tipped up, not down/away)". A continuous spin,
// even slow, turns the screen fully away from the camera for half of
// every revolution, which fights (3) (the user would stare at the blank
// grey back of a featureless box). A gentle sway is strictly "less spin"
// (it never even completes a turn), reads as a dignified hover, and keeps
// the tipped-up screen toward the viewer at ALL times. MAC_SPIN_RATE is
// now the sway's angular FREQUENCY (rad/s of the sine phase); the sway
// amplitude caps the deviation from front-facing at ±MAC_SPIN_AMP.
const MAC_SPIN_RATE = 0.5;
// Peak yaw deviation of the sway from front-facing (radians). ~0.42 rad
// ≈ 24° each way, enough to give the float life + parallax on the cards
// behind, without ever hiding the screen.
const MAC_SPIN_AMP = 0.42;
// Total orbital sweep across the orbit window (radians). The cards
// advance linearly from 0 → ORBIT_SWEEP over the orbit window
// (THRESHOLDS.orbitStart..orbitEnd), so this value IS the orbit's
// angular velocity per unit scroll. Lowered in stages per repeated user
// notes that the sweep still felt fast: 2π → 1.2π → now 0.8π (~144°)
// over a slightly wider window (orbitStart 0.22 → 0.18). Combined with
// the per-frame lerp smoothing on the applied rotation (LogoOrbit), the
// ring rotates calmly, enough to read the spec-tags from several faces
// without whipping around or tracking raw wheel steps 1:1.
const ORBIT_SWEEP = Math.PI * 0.8;

// CURSOR PARALLAX (float beats). Replaces the old fixed Y-axis sine sway:
// during BEATs 1-2 the Mac TURNS TOWARD the cursor — yaw tracks the
// horizontal cursor position, pitch the vertical — so it reads as the
// object "watching" the pointer (parallax), not idly oscillating on one
// axis. The applied rotation eases toward the target (PARALLAX_RATE) so a
// fast flick glides instead of snapping, and the whole effect is scaled by
// `spinFactor` so it damps to 0 across the settle window (square to camera
// before the descent + CRT boot). Amplitudes are modest so the tipped-up
// screen never turns away from the viewer.
const PARALLAX_YAW = THREE.MathUtils.degToRad(27);
const PARALLAX_PITCH = THREE.MathUtils.degToRad(15);
const PARALLAX_RATE = 4.0;

// Uniform up-scale on the whole Mac group (model + screen click planes
// together, so tile hit-testing + the detail-zoom solve stay aligned). A
// "tiny bit bigger" per the user — the landed CRT fills a touch more of
// the frame without overflowing the close dolly framing.
const MAC_GROUP_SCALE = 1.07;

// Float pose for BEATs 1-2: a 3/4 product-shot view of the Mac's cube
// housing with the SCREEN FACE TIPPED UP toward the viewer/camera.
//
// X-pitch sign convention: the screen is the model's front (+Z) face.
// A POSITIVE rotation.x pitches +Z toward −Y (screen tips DOWN, away
// from the camera); that was the old +32.7° pose the user flagged as
// "screen facing downwards". A NEGATIVE rotation.x pitches +Z toward +Y
// (screen tips UP toward the camera), which is what we want. So X is now
// −20°. A modest +Y yaw + small −Z roll keep the 3/4 product-shot read
// (so it still pairs with the keypad scene) without burying the screen.
// Tilt blends back to 0 across the descent window so the screen face
// squares up to camera by the time the CRT boot starts (LAND beat must
// still land flat (verified).
const MAC_FLOAT_TILT_X = THREE.MathUtils.degToRad(-20);
const MAC_FLOAT_TILT_Y = THREE.MathUtils.degToRad(11.1);
const MAC_FLOAT_TILT_Z = THREE.MathUtils.degToRad(-9);
// Float-pose tilt unwinds in lockstep with the descent so the screen
// is dead-flat to camera by the time the CRT lights up.
const TILT_UNWIND_START = 0.55;
const TILT_UNWIND_END = 0.78;

/* ─────────────────────────────────────────────────────────────────
 * CAMERA DOLLY-IN (wide layout only).
 *
 * Through BEATs 1-2 the camera holds the wide orbit framing
 * (z=DOLLY_Z_WIDE) so the full ~2.95-radius card ring + Mac fit with
 * margin. During BEAT 3 the camera travels IN toward the landed Mac so
 * the CRT face dominates the frame and the project tiles become
 * readable. The dolly window is pin DOLLY_START→DOLLY_END (overlaps the
 * descent + tilt-unwind + CRT boot) eased easeInOutCubic, so the zoom
 * feels like one continuous landing motion with the Mac.
 *
 * GEOMETRY (FOV 28 → vertical half-angle 14°, tan≈0.2493):
 *   At the landed state the CRT screen plane (0.72 world tall) sits
 *   centered at world y ≈ REST_Y + 1.0 = 0.8 (ScreenClickPlane is at
 *   local y=1.0 inside macGroupRef which rests at REST_Y=-0.2).
 *   Visible viewport height at distance d = 2·d·tan(14°) = 0.4986·d.
 *   At z=DOLLY_Z_CLOSE=2.6 → visible height ≈ 1.30 → screen fills
 *   0.72/1.30 ≈ 55% of height (the brief's lower target); the housing
 *   fills the rest of the frame so the CRT dominates and the project
 *   tiles read clearly. lookAt rises from y=0.45 (wide, centers the
 *   float composition) to y=0.8 (close, centers the screen) so the CRT
 *   stays dead-center as the camera pulls in.
 *
 * Driven per-frame from pinProgressRef (NOT a one-shot effect) so it
 * tracks scrub scrolling smoothly. CameraFramer owns the narrow path
 * (no scroll there); this dolly owns the wide path.
 * ──────────────────────────────────────────────────────────────── */
const DOLLY_START = 0.55;
const DOLLY_END = 0.9;
// Wide framing 9.5 → 8.5 so the centered Mac + the widened ~2.95 ring
// fill more of the viewport (less dead margin) while still leaving
// horizontal room for the rightmost card to clear the editorial rail
// (the rail sits high-right, the ring cards ride the vertical center, so
// they don't actually collide (verified). CLOSE held at 2.6 (the
// dolly-in win; tiles must read at land).
const DOLLY_Z_WIDE = 8.5;
const DOLLY_Z_CLOSE = 2.6;
// Wide camera Y + lookAt parked just ABOVE the FLOAT composition's
// center of mass so the Mac + ring read dead-centered top-to-bottom (no
// dead empty bottom half). The ring center sits at MAC_HOVER_Y +
// ORBIT_GROUP_Y (0.15 + 0.30 = 0.45); raising the lookAt to 0.58 drops
// the whole composition ~80px in a 1080-tall frame so it sits centered
// rather than slightly high. Level the camera (Y == lookAt) so the view
// is straight-on, not looking down from above. CLOSE keeps the landed-CRT
// framing (camera y 0.8, lookAt 0.8 centers the screen plane).
const DOLLY_Y_WIDE = 0.58;
const DOLLY_Y_CLOSE = 0.8;
const DOLLY_LOOK_Y_WIDE = 0.58;
const DOLLY_LOOK_Y_CLOSE = 0.8;
// Base orbit radius: used as a fallback when a SkillLogo doesn't
// supply its own per-card radius. Matches the widened ring (~2.6).
const ORBIT_BASE_RADIUS = 2.65;

/* ─────────────────────────────────────────────────────────────────
 * CAMERA DETAIL-ZOOM (project open).
 *
 * An ADDITIONAL camera state layered ON TOP of the landed dolly. When a
 * project is selected the camera travels further IN, past the landed
 * z=2.6, until the CRT screen face fills the viewport, and the screen
 * texture swaps from the tile grid to the project DETAIL view. ESC / the
 * on-screen BACK affordance pulls it back out.
 *
 * Unlike the scroll-bound dolly (which reads pinProgress directly), this
 * zoom is driven by a 0..1 `detailZoom` value that is LERPED toward its
 * target (1 when open, 0 when closed) in the useFrame loop at a fixed
 * rate, never bound straight to a discrete open/closed flag, so the
 * transition is smooth on open AND close regardless of frame timing
 * (matches the project's fixed-rate-animation rule).
 *
 * GEOMETRY (FOV 28 → vertical half-angle 14°, tan≈0.2493):
 *   The CRT screen plane is 0.72 world tall, centered at world y≈0.8.
 *   Visible viewport height at distance d = 2·d·tan(14°) = 0.4986·d.
 *   At z=DETAIL_Z=1.55 → visible height ≈ 0.773 → the 0.72-tall screen
 *   fills ~93% of the viewport height; the screen face dominates the
 *   frame, the housing falls away to the edges, and the detail text is
 *   legible. lookAt holds the screen center (y=0.8) so the screen stays
 *   dead-centered as the camera pushes in from the landed pose.
 * ──────────────────────────────────────────────────────────────── */
// Detail-zoom ease rate per SECOND (frame-rate independent: applied as
// 1 - exp(-dt * rate); ≈ the old 0.12/frame at 60Hz, which ran ~2x
// faster on 120Hz displays). ~0.4s settle.
const DETAIL_RATE = 7.7;
// How much of the viewport HEIGHT the screen face should fill in the
// dead-on detail view. <1 leaves a sliver of PC bezel around the screen
// (desirable, it reads as "looking at the device"). The camera distance
// along the face normal is solved from this + the screen's real world
// height each frame, so it self-corrects to the actual mesh size.
const DETAIL_FILL = 0.9;

/**
 * Live geometry of the CRT screen face, populated by MacBody once the
 * GLB clone + overlay exist. Holds a handle to the screen mesh plus the
 * face's LOCAL center + LOCAL outward normal (in the screen mesh's own
 * object space) and the face aspect (w/h). The detail-zoom camera reads
 * this each frame and derives the screen's WORLD center + WORLD normal
 * from the mesh's live world matrix, so it aims DEAD-ON down the face
 * normal regardless of the angle the screen sits at in the GLB. Null
 * until the overlay is built; consumers must guard.
 */
interface ScreenInfo {
  mesh: THREE.Mesh;
  /** The overlay plane mesh; its world matrix gives the face's screen rect. */
  overlay: THREE.Mesh;
  localCenter: THREE.Vector3;
  localNormal: THREE.Vector3;
  /** Face aspect ratio (width / height) of the screen plane. */
  aspect: number;
  /** Face height in the mesh's LOCAL units (before world scale). */
  faceH: number;
}

useGLTF.preload("/mac.glb");

// Reusable scratch vectors for the per-frame dead-on detail-zoom math
// (avoids allocating Vector3s every frame in the useFrame loop).
const _scrCenter = new THREE.Vector3();
const _scrNormal = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _normalMat = new THREE.Matrix3();
// Scratch for projecting the screen-face corners to on-screen pixels.
const _corner = new THREE.Vector3();
const _planeCorners: [number, number][] = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

/* ─────────────────────────────────────────────────────────────────
 * Logo orbit: volumetric ring of CanvasTexture plane meshes around
 * the Mac. Refs-only animation: orbitGroup rotates, each LogoSprite
 * applies its dissolve offset/scale/opacity from a ref read in
 * useFrame (no setState per frame).
 * ──────────────────────────────────────────────────────────────── */

// Per-card animation state, computed once at mount. Held in a plain
// array (not React state) so the single parent useFrame can iterate it
// without any allocation or reconciliation per frame.
interface OrbitCard {
  mesh: THREE.Mesh | null;
  mat: THREE.MeshBasicMaterial | null;
  basePos: THREE.Vector3;
  driftDir: THREE.Vector3;
}

function LogoOrbit({
  logos,
  orbitAngleRef,
  dissolveRef,
}: {
  logos: SkillLogo[];
  orbitAngleRef: React.MutableRefObject<number>;
  dissolveRef: React.MutableRefObject<number>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  // Pre-compute every card's resting position + per-card drift vector
  // once. Refs (mesh/mat) are filled in by each LogoSprite via the
  // register callback below as they mount.
  const cards = useMemo<OrbitCard[]>(
    () =>
      logos.map((logo, i) => {
        // Half-step phase offset (π/N) so NO card sits dead-front-center
        // at the start of the float (orbitAngle=0). A dead-front card
        // projects right onto the Mac's screen face and reads as "stuck to
        // the glass"; straddling the front with the gap between two cards
        // keeps the screen clear. Cards still step evenly by 2π/N.
        const baseAngle =
          (i / logos.length) * Math.PI * 2 + Math.PI / logos.length;
        const radius = logo.radius ?? ORBIT_BASE_RADIUS;
        const yOffset = logo.yOffset ?? 0;
        const a = i * 1.61803;
        return {
          mesh: null,
          mat: null,
          basePos: new THREE.Vector3(
            Math.sin(baseAngle) * radius,
            yOffset,
            Math.cos(baseAngle) * radius,
          ),
          driftDir: new THREE.Vector3(
            Math.cos(a) * 0.8,
            Math.sin(a * 1.7) * 0.5,
            Math.sin(a * 0.9) * 0.7,
          ),
        };
      }),
    [logos],
  );

  // PERF: ONE useFrame drives the orbit rotation AND all 12 cards.
  // Previously each LogoSprite ran its own useFrame (13 frame-loop
  // subscriptions total); each subscription has per-frame iteration
  // + closure overhead in R3F's loop. Consolidating to a single loop
  // that walks the `cards` array drops that to 1 subscription and lets
  // the dissolve / billboard math share one camera-position read.
  useFrame((_, dt) => {
    if (groupRef.current) {
      // Ease the ring toward its scroll-driven target angle instead of
      // binding rotation 1:1 to scroll. Exponential smoothing (frame-rate
      // independent) so discrete wheel/trackpad steps glide rather than
      // snap (the "smoothen" half of the user note).
      const target = orbitAngleRef.current;
      const a = 1 - Math.exp(-6 * Math.min(dt, 0.05));
      groupRef.current.rotation.y +=
        (target - groupRef.current.rotation.y) * a;
    }
    const d = dissolveRef.current; // 0..1
    const drift = 0.5 * d;
    const scale = 1 - d * 0.6; // 1 → 0.4
    const opacity = Math.max(0, 1 - d * 1.1);
    const camPos = camera.position;
    // PERF: once a card has fully dissolved (d≈1 → opacity 0) the lookAt +
    // position/scale writes are wasted on an invisible mesh.
    //   OLD: 12 lookAt + position.set + scale per frame, ALWAYS.
    //   NEW: skip fully-invisible cards (hide + continue) → O(visible cards)
    //        per frame instead of O(12). Visible-phase motion is unchanged.
    const allHidden = opacity <= 0;
    for (let i = 0; i < cards.length; i++) {
      const c = cards[i]!;
      const m = c.mesh;
      if (!m) continue;
      if (allHidden) {
        if (m.visible) m.visible = false;
        continue;
      }
      if (!m.visible) m.visible = true;
      // Drift outward so cards visibly leave the ring before fading out.
      m.position.set(
        c.basePos.x + c.driftDir.x * drift,
        c.basePos.y + c.driftDir.y * drift,
        c.basePos.z + c.driftDir.z * drift,
      );
      m.scale.setScalar(scale);
      if (c.mat) c.mat.opacity = opacity;
      // Billboard to camera (counter-rotates the parent group's Y spin
      // so each label always reads forward, never mirrored).
      m.lookAt(camPos);
    }
  });

  return (
    <group ref={groupRef}>
      {logos.map((logo, i) => (
        <LogoSprite
          key={logo.label}
          logo={logo}
          index={i}
          position={cards[i]!.basePos}
          register={(mesh, mat) => {
            cards[i]!.mesh = mesh;
            cards[i]!.mat = mat;
          }}
        />
      ))}
    </group>
  );
}

function LogoSprite({
  logo,
  index,
  position,
  register,
}: {
  logo: SkillLogo;
  index: number;
  position: THREE.Vector3;
  register: (mesh: THREE.Mesh | null, mat: THREE.MeshBasicMaterial | null) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  // CanvasTexture is generated ONCE per logo (a canvas paint + GPU
  // upload), memoised on the logo identity so it never rebuilds on
  // re-render. The parent's single useFrame owns the per-frame motion.
  // fontReady: rebuilds once when VT323 lands so the card never keeps
  // a fallback-font bake (see usePixelFontReady).
  const fontReady = usePixelFontReady();
  const texture = useMemo(
    () => makeLogoTexture(logo, index),
    [logo, index, fontReady],
  );

  // Hand the live mesh + material refs up to the parent orbit so its
  // consolidated useFrame can animate this card. Re-registers only if
  // the texture (i.e. the logo) changes.
  useEffect(() => {
    register(meshRef.current, matRef.current);
    return () => register(null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texture]);

  return (
    <mesh ref={meshRef} position={position}>
      {/* Cards trimmed 0.78×0.42 → 0.66×0.355 so neighbours on the wider
          ring keep clear air between them (no text clipping / overlap)
          and a front-of-ring card never blankets the Mac's screen. */}
      <planeGeometry args={[0.66, 0.355]} />
      <meshBasicMaterial
        ref={matRef}
        map={texture}
        transparent
        toneMapped={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

// Palette constants for the canvas texture. The canvas can't read CSS
// vars, so these mirror the design-system tokens (--bg-surface,
// --bg-elevated, --ink, --ink-muted, --ink-hairline, --accent).
const CARD_INK = "#0d0e10";
const CARD_INK_FAINT = "rgba(13, 14, 16, 0.34)";
const CARD_ACCENT = "#e87040";

/* Pixel face for EVERYTHING rasterized into this section's 3D canvas
   textures: the CRT screen UI, the boot type-in, and the orbiting
   skill cards. VT323 (terminal classic): single 400 weight, so no
   weight prefixes anywhere — canvas would synthesize a smeared
   faux-bold over pixel glyphs. Hierarchy is carried by size + ink.
   Sizes at call sites run ~15-25% larger than the old Geist values:
   VT323 is narrow, so equal px reads lighter. */
const PIXEL_FONT = "'VT323', 'Courier New', monospace";
/* Reading-body face for PARAGRAPHS on the CRT (the project blurb).
   VT323 at ~17px was genuinely hard to read (user) — pixel faces are
   display/label voices, not body voices. Geist is already loaded
   site-wide, so the canvas can rasterize it; labels/meta/chips stay
   pixel for the system-voice contrast. */
const BODY_FONT = "'Geist', 'Inter', system-ui, sans-serif";

/* Canvas rasterizes whatever font is AVAILABLE at draw time, so a
   texture painted before the VT323 webfont arrives bakes the fallback
   permanently. Texture builders include this in their memo deps to
   rebuild once the font lands. The CRT screen painter needs no guard:
   it repaints continuously through the boot beat, long after fonts
   settle. */
let pixelFontLoaded = false;
function usePixelFontReady(): boolean {
  const [ready, setReady] = useState(pixelFontLoaded);
  useEffect(() => {
    if (pixelFontLoaded) return;
    let alive = true;
    document.fonts.load(`16px ${PIXEL_FONT}`).then(() => {
      pixelFontLoaded = true;
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return ready;
}

/**
 * Orbit card texture: a calm, restrained name plate.
 *
 * The previous design stacked ten competing marks on a card that is
 * only ever seen small, tilted and drifting in the orbit ring (orange
 * top rule, elevated header band, index, orange category, hairline
 * divider, big name, brand status dot + ink ring, two mono footer
 * lines, four L-shaped corner ticks, a full frame border). At orbit
 * distance the 1px filigree turned to mush and the orange category
 * fought the name for attention — it read as "too detailed / busy".
 *
 * Current design: a white field with the large tech NAME as the single
 * hero (vertically centred so it stays anchored when the card tilts
 * off-axis, auto-shrunk so the longest label never clips), a faint tracked
 * index top-left, a QUIET neutral hairline edge, and a single orange
 * L-bracket tick in the top-left corner as the sole accent. Earlier passes
 * tried a per-brand colour bar under the name (read as arbitrary) and a
 * bold full orange frame (too heavy small + tilted) — both rejected. The
 * hairline gives the card just enough edge to read as an object; the
 * corner tick carries the orange without the weight of a full line.
 *
 * Drawn at 768×412 (same 1.86:1 ratio as the 0.66×0.355 plane, higher res
 * than before) so type stays crisp under anisotropic filtering.
 */
function makeLogoTexture(logo: SkillLogo, index: number): THREE.CanvasTexture {
  // 1.86:1 ratio (matches the 0.66 x 0.355 plane), rendered higher-res than
  // the plane so type stays crisp when the card is small, tilted and drifting.
  const w = 768;
  const h = 412;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const PAD = 56; // inset for the name + index, clear of the frame

  // White field.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  // Quiet neutral hairline frame: just enough to define the card's edge
  // against the page. A full bold orange box read as too heavy, especially
  // small and tilted in the orbit — so the edge is now a soft hairline and
  // the orange is a single restrained mark (below).
  const FRAME = 3;
  ctx.strokeStyle = "rgba(13, 14, 16, 0.13)";
  ctx.lineWidth = FRAME;
  ctx.strokeRect(FRAME / 2, FRAME / 2, w - FRAME, h - FRAME);

  // The orange accent: one L-bracket tick in the top-left corner —
  // architectural, reads cleanly at orbit distance, and far lighter than a
  // full frame or an under-name bar (both previously rejected). It frames
  // the index below it, reading as a quiet "spec-tag" corner.
  const TICK = 6; // arm thickness
  const ARM_X = Math.round(w * 0.13); // horizontal arm length
  const ARM_Y = Math.round(h * 0.19); // vertical arm length
  const TICK_INSET = 22; // sits just inside the card edge
  ctx.fillStyle = CARD_ACCENT;
  ctx.fillRect(TICK_INSET, TICK_INSET, ARM_X, TICK); // horizontal arm
  ctx.fillRect(TICK_INSET, TICK_INSET, TICK, ARM_Y); // vertical arm

  // Faint tracked index, top-left — the quiet spec-tag nod, kept
  // subordinate via size + faint ink.
  const idx = String(index + 1).padStart(2, "0");
  ctx.fillStyle = CARD_INK_FAINT;
  ctx.font = `26px ${PIXEL_FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  drawTracked(ctx, idx, PAD, PAD + Math.round(h * 0.029), 3);

  // HERO: the tech name, big + vertically centered so it fills the open
  // field (the old plate left a lot of dead space). Auto-shrinks so the
  // longest label ("TypeScript") never clips the frame.
  const maxNameW = w - PAD * 2;
  let nameSize = 150;
  ctx.font = `${nameSize}px ${PIXEL_FONT}`;
  while (ctx.measureText(logo.label).width > maxNameW && nameSize > 48) {
    nameSize -= 2;
    ctx.font = `${nameSize}px ${PIXEL_FONT}`;
  }
  const nameBaseline = h / 2 + nameSize * 0.34; // optical vertical centering
  ctx.fillStyle = CARD_INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(logo.label, PAD, nameBaseline);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return tex;
}

/**
 * Draw tracked text with manual letter-spacing (Canvas2D's
 * `letterSpacing` is unreliable across browsers). `align` controls
 * whether `x` is the left edge or the right edge of the tracked run.
 */
function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
  align: "left" | "right" = "left",
) {
  const prevAlign = ctx.textAlign;
  ctx.textAlign = "left";
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((s, wd) => s + wd, 0) + spacing * (text.length - 1);
  let cx = align === "right" ? x - total : x;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i]!, cx, y);
    cx += widths[i]! + spacing;
  }
  ctx.textAlign = prevAlign;
}

/**
 * Single guarded uppercaser for CRT system-labels (meta lines, tag
 * chips, tile meta). Routing every label through one helper means a
 * future edit can't silently drop a `.toUpperCase()` and render
 * lowercase on the CRT with no warning.
 */
function ensureUppercase(text: string): string {
  return text.toUpperCase();
}

/* ─────────────────────────────────────────────────────────────────
 * Mac model + CRT screen overlay (kept identical to the prior
 * implementation; only the position/rotation choreography is new).
 * ──────────────────────────────────────────────────────────────── */

/**
 * CRT post shader for the screen overlay: scanlines, a slow upward
 * refresh band, corner vignette, and a faint flicker, all time-driven
 * in GLSL. Doing this in the material (instead of painting into the
 * canvas texture) means the effects move EVERY frame without a single
 * CanvasTexture re-upload; the UI texture keeps its repaint-on-change
 * regime. uOpacity replaces MeshBasicMaterial.opacity for the boot
 * power-on ramp. `colorspace_fragment` is mandatory: custom shaders
 * bypass three's output encoding, and without it the screen renders
 * dark/wrong under ColorManagement (see project rule).
 */
function makeCrtScreenMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      // Page-transition glitch intensity 0..1: pulsed by the Scene on
      // project open/close/switch, decaying over ~400ms. Drives the
      // slice-tear / chroma-split / noise burst below.
      uGlitch: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uGlitch;
      varying vec2 vUv;
      void main() {
        // PAGE-TRANSITION GLITCH (uGlitch 0..1, decaying pulse): the
        // tube loses sync for a beat when "switching pages" —
        //   1. horizontal SLICE TEAR: random rows shear sideways, the
        //      row pattern re-rolling at ~24Hz;
        //   2. a small whole-frame vertical jog (vsync slip);
        //   3. RGB chroma split that widens with the glitch;
        //   4. a broadband noise burst.
        // All of it displaces/samples the screen's OWN pixels.

        // SCREEN BULGE: barrel-distort the sample space so the picture
        // curves like tube glass — the image swells at centre and its
        // edges pull in, leaving a thin curved black bezel at the
        // corners of the flat quad. k kept subtle (corner overshoot
        // ~3%) so the DOM click hotspots (positioned on the FLAT rect)
        // stay within a few px of the painted UI.
        vec2 cb = vUv - 0.5;
        float r2 = dot(cb, cb);
        vec2 uv = 0.5 + cb * (1.0 + 0.12 * r2);
        // Bezel mask: anything sampled past the texture edge is tube
        // rim, fading over ~1% so the curve reads smooth.
        vec2 edgeD = abs(uv - 0.5);
        float outside = max(edgeD.x, edgeD.y) - 0.5;
        float bezel = 1.0 - smoothstep(0.0, 0.012, outside);

        if (uGlitch > 0.001) {
          float row = floor(uv.y * 36.0);
          float h = fract(sin(row * 91.7 + floor(uTime * 24.0) * 7.3) * 43758.5453);
          float tear = (h - 0.5) * 0.20 * uGlitch * step(0.62, h);
          uv.x = fract(uv.x + tear);
          uv.y = fract(uv.y + 0.012 * uGlitch * sin(uTime * 60.0));
        }
        float ca = 0.006 * uGlitch;
        vec3 col;
        col.r = texture2D(uMap, uv + vec2(ca, 0.0)).r;
        col.g = texture2D(uMap, uv).g;
        col.b = texture2D(uMap, uv - vec2(ca, 0.0)).b;
        if (uGlitch > 0.001) {
          float n = fract(sin(dot(uv + uTime, vec2(12.9898, 78.233))) * 43758.5453);
          col += (n - 0.5) * 0.35 * uGlitch;
        }

        // RASTER LINES: ~96 fat scanlines (was 210 hairlines at 6%
        // depth — invisible at viewing distance). Trapezoid profile:
        // a bright line core with a soft DARK SEAM between rows, the
        // way a real tube's beam rows actually read. The whole raster
        // crawls slowly downward so it reads as live scan, not print.
        // Raster follows the BULGED beam-space so the scanlines curve
        // with the glass like a real tube.
        float line = uv.y * 96.0 + uTime * 0.8;
        float ph = fract(line);
        float scan = 0.70 + 0.30 *
          (smoothstep(0.03, 0.36, ph) * (1.0 - smoothstep(0.64, 0.97, ph)));

        // INTERLACE SHIMMER: odd/even line fields trade ~3% brightness
        // on alternating ticks — the gentle row-flicker of an
        // interlaced tube. Field clock ~12Hz, far below strobe range.
        float odd = mod(floor(line), 2.0);
        float fieldClock = step(0.5, fract(uTime * 12.0));
        float interlace = 1.0 - 0.03 * abs(odd - fieldClock);

        // APERTURE GRILLE: faint vertical RGB phosphor triads. Pure
        // chroma texture (no geometry), reads as tube glass up close.
        float gx = uv.x * 320.0 * 6.2832;
        vec3 triad = vec3(
          0.96 + 0.04 * cos(gx),
          0.96 + 0.04 * cos(gx + 2.094),
          0.96 + 0.04 * cos(gx + 4.189)
        );

        // REFRESH BAND: a soft bright bar rolling DOWN the face every
        // ~6s (doubled presence vs the old 5%), with a faint dark
        // retrace shadow trailing just behind it.
        float roll = fract(uv.y - uTime * 0.16);
        float band = 1.0 + 0.10 * exp(-pow((roll - 0.5) * 8.0, 2.0))
                         - 0.045 * exp(-pow((roll - 0.62) * 12.0, 2.0));

        // Corner vignette: tube glass falloff.
        float d = distance(vUv, vec2(0.5));
        float vig = 1.0 - 0.18 * smoothstep(0.32, 0.72, d);

        // Supply flicker (sub-2%, two incommensurate sines so it never
        // reads as a loop).
        float flick = 1.0 + 0.018 * sin(uTime * 47.0) * sin(uTime * 13.7);

        vec3 outCol = col * scan * interlace * band * vig * flick * triad;
        // PHOSPHOR LIFT: the seams must not crush detail to black — a
        // touch of unmodulated bleed keeps text legible through the
        // raster, like real phosphor glow spilling between rows.
        outCol += col * 0.10;
        // Tube rim: black out the curved over-edge region.
        gl_FragColor = vec4(outCol * bezel, uOpacity);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function MacBody({
  screenTexture,
  overlayMatRef,
  screenInfoRef,
}: {
  screenTexture: THREE.Texture;
  // Scene hands down a ref it owns so the overlay's material can be
  // driven (opacity gating + CRT clock) from the parent useFrame loop.
  // The overlay is created asynchronously inside an effect once the GLB
  // clone is ready; this ref is null until that point, and the
  // parent loop guards against it.
  overlayMatRef: React.MutableRefObject<THREE.ShaderMaterial | null>;
  // Populated with the screen face geometry (mesh + local center +
  // local outward normal + aspect) once the overlay is built, so the
  // detail-zoom camera can aim dead-on down the live world normal.
  screenInfoRef: React.MutableRefObject<ScreenInfo | null>;
}) {
  const { scene } = useGLTF("/mac.glb") as unknown as { scene: THREE.Group };
  const screenOverlayRef = useRef<THREE.Mesh | null>(null);

  // Deep clone so each instance has its own material objects; swapping
  // a material on the cached scene wouldn't render via <primitive>.
  const clone = useMemo(() => scene?.clone(true), [scene]);

  useEffect(() => {
    if (!clone) return;
    let screenMesh: THREE.Mesh | null = null;
    // Collect all candidate meshes so we can fall back to a size-based
    // heuristic when name-matching fails. The mac.glb in /public ships
    // with generic mesh names like Cube_1 / Cube_2 (no "screen" /
    // "crt"), so the previous name-only lookup never matched; overlay
    // never attached, CRT stayed black. Selecting the smallest mesh by
    // bounding-box volume picks the screen subdivision reliably.
    const candidates: { mesh: THREE.Mesh; volume: number }[] = [];
    clone.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const matSources: THREE.Material[] = Array.isArray(obj.material)
        ? obj.material
        : [obj.material];
      const matchesByMat = matSources.some((m) => {
        const n = (m?.name ?? "").toLowerCase();
        return n.includes("screen") || n.includes("crt");
      });
      const objName = obj.name.toLowerCase();
      if (
        !screenMesh &&
        (matchesByMat ||
          objName.includes("screen") ||
          objName.includes("crt") ||
          objName.includes("display"))
      ) {
        screenMesh = obj;
      }
      // castShadow defaults OFF here; the size-based pass below re-enables
      // it only on the large meshes that actually form the contact blob.
      obj.castShadow = false;
      obj.receiveShadow = false;
      // Record bounding-box volume for the size-based fallback below.
      obj.geometry.computeBoundingBox();
      const bb = obj.geometry.boundingBox;
      if (bb) {
        const s = new THREE.Vector3();
        bb.getSize(s);
        candidates.push({ mesh: obj, volume: s.x * s.y * s.z });
      }
    });
    // Fallback: pick the smallest mesh (by bbox volume) as the screen.
    // On the current mac.glb this resolves to Cube_2 (the screen
    // inset). If only one mesh exists, skip overlay creation.
    if (!screenMesh && candidates.length > 1) {
      candidates.sort((a, b) => a.volume - b.volume);
      screenMesh = candidates[0]!.mesh;
    }

    // PERF: trim the shadow caster set.
    //   OLD: castShadow=true on EVERY GLB mesh → every sub-part added a
    //        geometry pass to the shadow-map depth render.
    //   NEW: only meshes ≥15% of the largest mesh's bbox volume cast. The
    //        Mac contact shadow is a soft, low-opacity (peak 0.22) blob, so
    //        only the body shell needs to occlude; tiny detail meshes
    //        (knobs, screen inset, vents) contribute nothing visible. The
    //        threshold is conservative — anything chunky still casts.
    if (candidates.length > 0) {
      const maxVol = candidates.reduce((m, c) => Math.max(m, c.volume), 0);
      const castThreshold = maxVol * 0.15;
      for (const c of candidates) {
        c.mesh.castShadow = c.volume >= castThreshold;
      }
    }

    if (!screenMesh) return;
    const sm = screenMesh as THREE.Mesh;

    // Paint the GLB screen mesh jet black so it reads as the unlit CRT
    // housing behind the picture. The picture itself is an overlay
    // plane attached in front of the dominant screen face; overlay
    // has clean 0..1 UVs so the canvas texture renders correctly
    // regardless of the GLB mesh's UV layout (a direct material swap
    // rendered black).
    sm.material = new THREE.MeshBasicMaterial({
      color: "#080808",
      toneMapped: false,
    });

    sm.geometry.computeBoundingBox();
    sm.geometry.computeVertexNormals();
    const box = sm.geometry.boundingBox!;
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);

    // Dominant face normal: area-weighted normal sum across triangles.
    const posAttr = sm.geometry.getAttribute("position") as THREE.BufferAttribute;
    const idxAttr = sm.geometry.getIndex();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const n = new THREE.Vector3();
    const accum = new THREE.Vector3();
    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
    for (let i = 0; i < triCount; i++) {
      const i0 = idxAttr ? idxAttr.getX(i * 3) : i * 3;
      const i1 = idxAttr ? idxAttr.getX(i * 3 + 1) : i * 3 + 1;
      const i2 = idxAttr ? idxAttr.getX(i * 3 + 2) : i * 3 + 2;
      a.fromBufferAttribute(posAttr, i0);
      b.fromBufferAttribute(posAttr, i1);
      c.fromBufferAttribute(posAttr, i2);
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      n.crossVectors(ab, ac);
      const area = n.length() / 2;
      accum.add(n.normalize().multiplyScalar(area));
    }
    accum.normalize();

    // Overlay sized to the two largest bbox axes.
    const sortedAxes = [size.x, size.y, size.z].sort((a, b) => b - a);
    const faceW = sortedAxes[0]!;
    const faceH = sortedAxes[1]!;
    const overlayGeo = new THREE.PlaneGeometry(faceW, faceH);

    // Overlay starts FULLY TRANSPARENT (uOpacity=0). The parent useFrame
    // loop reads pin progress and ramps uOpacity → 1 across the CRT
    // boot window (THRESHOLDS.bootStart..bootEnd). During the float +
    // orbit beats the overlay is invisible, so the underlying black
    // screen mesh ("#080808") reads through as an inert dark CRT face;
    // i.e. "the Mac is OFF". The screen lights up only when the Mac
    // lands. The material is the CRT post shader (scanlines / roll /
    // vignette / flicker) so the picture reads as a live tube.
    const overlayMat = makeCrtScreenMaterial(screenTexture);
    const overlay = new THREE.Mesh(overlayGeo, overlayMat);
    overlay.position.copy(center);
    const nudge = Math.max(size.length() * 0.01, 0.01);
    overlay.position.add(accum.clone().multiplyScalar(nudge));
    overlay.lookAt(overlay.position.clone().add(accum));
    overlay.renderOrder = 999;
    sm.add(overlay);
    screenOverlayRef.current = overlay;
    overlayMatRef.current = overlayMat;

    // Publish the screen face geometry so the detail-zoom camera can aim
    // dead-on down the LIVE world normal (the GLB seats the CRT face at
    // an angle, so a fixed straight-down-Z camera renders it keystoned),
    // AND so the DOM control overlay can project the screen's on-screen
    // rect to align its hotspots to the painted controls. We store the
    // LOCAL center + LOCAL outward normal in the screen mesh's object
    // space; consumers derive world values from the live world matrix.
    screenInfoRef.current = {
      mesh: sm,
      overlay,
      localCenter: center.clone(),
      localNormal: accum.clone(),
      aspect: faceH > 0 ? faceW / faceH : 780 / 550,
      faceH,
    };

    return () => {
      const o = screenOverlayRef.current;
      if (o && o.parent) {
        o.parent.remove(o);
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
      screenOverlayRef.current = null;
      overlayMatRef.current = null;
      screenInfoRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clone]);

  useEffect(() => {
    const overlay = screenOverlayRef.current;
    if (!overlay) return;
    const mat = overlay.material as THREE.ShaderMaterial;
    mat.uniforms.uMap!.value = screenTexture;
  }, [screenTexture]);

  if (!clone) return null;
  return <MacRig clone={clone} />;
}

/** Tune-mode wrapper: sliders drive scale + Y at runtime. */
function MacRig({ clone }: { clone: THREE.Group }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!TUNE_MODE) return;
    const g = groupRef.current;
    if (!g) return;
    const t = (window as unknown as { __macTune?: { scale: number; y: number } })
      .__macTune;
    if (!t) return;
    g.scale.setScalar(t.scale);
    g.position.y = t.y;
  });
  return (
    <group ref={groupRef} scale={[0.21, 0.21, 0.21]} position={[0, 0, 0]}>
      <primitive object={clone} />
    </group>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * Project thumbnail cache. The CRT screen is painted on a 2D canvas,
 * so the scraped Devpost gallery images must be decoded
 * HTMLImageElements before drawImage can use them. We keep a module
 * cache + a version signal that bumps as each one finishes decoding
 * so the CanvasTexture repaints once the artwork is ready.
 * ──────────────────────────────────────────────────────────────── */
const projectImageCache = new Map<string, HTMLImageElement>();

function getProjectImage(src: string): HTMLImageElement {
  let img = projectImageCache.get(src);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.src = src;
    projectImageCache.set(src, img);
  }
  return img;
}

function imageReady(img: HTMLImageElement | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}

/** Preload project thumbnails; returns a version that increments on each
 *  decode so the caller can rebuild the CanvasTexture + invalidate. */
function useProjectImages(projects: MacProject[]): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    for (const p of projects) {
      if (!p.image) continue;
      const img = getProjectImage(p.image);
      if (img.complete && img.naturalWidth > 0) continue;
      img.addEventListener(
        "load",
        () => {
          if (active) setVersion((v) => v + 1);
        },
        { once: true },
      );
    }
    return () => {
      active = false;
    };
  }, [projects]);
  return version;
}

/** Draw an image cover-fit (center-cropped) into a destination rect. */
function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const ir = iw / ih;
  const tr = dw / dh;
  let sx: number, sy: number, sw: number, sh: number;
  if (ir > tr) {
    sh = ih;
    sw = ih * tr;
    sx = (iw - sw) / 2;
    sy = 0;
  } else {
    sw = iw;
    sh = iw / tr;
    sx = 0;
    sy = (ih - sh) / 2;
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

/* ─────────────────────────────────────────────────────────────────
 * CRT canvas painter: boot text + project tile grid. Identical to
 * the prior version; the screen lights up later in the pin window
 * because the boot threshold shifted to 0.72→0.85.
 * ──────────────────────────────────────────────────────────────── */

function useScreenTexture(
  projects: MacProject[],
  bootProgress: number,
  hoverIndex: number | null,
  selected: MacProject | null,
  detailReveal: number,
  imageVersion: number,
  // Aspect ratio (w/h) of the physical CRT screen FACE. The canvas MUST
  // match it or the texture is non-uniformly scaled onto the mesh and the
  // UI renders horizontally squished. Defaults to the prior 780/550 until
  // the real geometry is published by MacBody.
  screenAspect: number,
  // True during the float beats (before CRT boot): paint the spinning
  // ASCII sphere screensaver instead of the boot/desktop UI. `floatSpin`
  // is a ~30Hz counter that ticks while floatActive so this hook re-runs
  // and the sphere animates (its value is otherwise unused — the spin time
  // is read from the clock at paint).
  floatActive: boolean,
  floatSpin: number,
): THREE.CanvasTexture {
  // PERF (GPU texture leak fix):
  //   OLD: every dependency change (bootProgress/hoverIndex/detailReveal/...
  //        churns ~30Hz) allocated a NEW canvas + NEW CanvasTexture and
  //        orphaned the prior texture WITHOUT .dispose() → unbounded GPU
  //        memory growth. Time O(paint) per change, GPU space O(#changes).
  //   NEW: ONE persistent canvas + ONE persistent CanvasTexture for the
  //        lifetime of the component. State changes repaint the SAME 2D
  //        context and flag needsUpdate (a single re-upload of the existing
  //        texture). The texture is recreated only when the canvas
  //        DIMENSIONS change (screenAspect), disposing the OLD one first.
  //        Time O(paint) per change, GPU space O(1) (bounded to one texture).

  // Fix the canvas HEIGHT and derive WIDTH from the screen face aspect so
  // the drawn texture maps 1:1 onto the screen plane (no squish/stretch).
  // ~640px tall keeps text crisp at the zoomed-in DETAIL framing under
  // anisotropic filtering without an oversized GPU upload. (Bumped from
  // 560 for sharper body text; fit is governed by the fractions below.)
  const h = 640;
  const aspect =
    Number.isFinite(screenAspect) && screenAspect > 0.2 && screenAspect < 5
      ? screenAspect
      : 780 / 550;
  const w = Math.round(h * aspect);

  // The single canvas, created once and never reallocated. Its 2D context is
  // cached alongside it so repaints don't re-fetch the context each frame.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  if (!canvasRef.current) {
    canvasRef.current = document.createElement("canvas");
    canvasRef.current.width = w;
    canvasRef.current.height = h;
    ctxRef.current = canvasRef.current.getContext("2d")!;
  }

  // The CanvasTexture is keyed ONLY on the canvas DIMENSIONS. A change to w/h
  // resizes the SAME canvas and disposes+recreates the texture (the GPU upload
  // size changed); state-only changes reuse this exact texture instance.
  const texture = useMemo(() => {
    const canvas = canvasRef.current!;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    return tex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h]);

  // Dispose the PREVIOUS texture when a dimension change swaps it out, and on
  // unmount — so the orphaned GPU texture is always released exactly once.
  const prevTexRef = useRef<THREE.CanvasTexture | null>(null);
  useEffect(() => {
    if (prevTexRef.current && prevTexRef.current !== texture) {
      prevTexRef.current.dispose();
    }
    prevTexRef.current = texture;
    return () => {
      texture.dispose();
    };
  }, [texture]);

  // Repaint into the SAME canvas context on every state change, then flag the
  // persistent texture for a single re-upload (Task 2: hover/boot/detail steps
  // mutate this canvas in place — no new canvas/texture allocation).
  const ctx = ctxRef.current!;
  // When a project is open AND its reveal has begun, paint the DETAIL view.
  // Otherwise paint the boot text / tile grid. The crossfade is owned by the
  // camera zoom + the detailReveal ramp; below ~0.04 we still show the grid so
  // the swap doesn't flash a blank panel at the very start of the zoom.
  // (drawScreen/drawProjectDetail both fully repaint, so no clear is needed.)
  if (selected && detailReveal > 0.04) {
    drawProjectDetail(ctx, w, h, selected, detailReveal);
  } else if (floatActive) {
    drawAsciiSphere(ctx, w, h, performance.now() / 1000);
  } else {
    drawScreen(ctx, w, h, projects, bootProgress, hoverIndex);
  }
  // `imageVersion` is referenced so a late thumbnail decode forces a repaint.
  void imageVersion;
  // `floatSpin` is referenced so the ~30Hz float tick re-runs this paint.
  void floatSpin;
  texture.needsUpdate = true;
  return texture;
}

/* ─────────────────────────────────────────────────────────────────
 * CRT PROJECT DETAIL painter: RIGID MODERN-OS WINDOW.
 *
 * The open project rendered ON the CRT as a clean desktop-OS window
 * (think a macOS/iPadOS settings panel): a slim title bar with a SHARP
 * square close control + a mono breadcrumb path, then a flat content
 * panel with a large Geist title, a mono meta line, the blurb in Geist body,
 * flat hairline tag chips, and a flat "View live" button. SHARP corners
 * everywhere (no border-radius), crisp hairlines, generous spacing, no
 * scanline kitsch. It's a DEVICE SCREEN, so the base is a dark cool CRT
 * with cool-white text + the signature orange accent.
 *
 * The real clickable controls (close + live link) live in the DOM overlay
 * (Macintosh.tsx); their on-screen positions are derived from the SAME
 * fractions used here (CRT_LAYOUT) so the invisible DOM hotspots align to
 * the painted controls now that the zoom lands dead-on/square.
 *
 * `reveal` (0..1) wipes the title bar in then types/fades the body so the
 * open reads as the OS "opening a record", not a hard cut.
 * ──────────────────────────────────────────────────────────────── */

// CRT screen palette (device screen, not the page). Cool-white text on a
// near-black cool base + the signature orange accent. Mirrors the design
// tokens adapted for an emissive dark surface.
const CRT_BASE = "#0a0c10"; // near-black cool CRT ground
const CRT_BAR = "#11141a"; // slightly lifted title-bar strip
const CRT_TEXT = "#eef2f7"; // cool near-white, primary text
const CRT_TEXT_DIM = "rgba(238, 242, 247, 0.66)"; // secondary
const CRT_TEXT_FAINT = "rgba(238, 242, 247, 0.40)"; // low-emphasis
const CRT_HAIRLINE = "rgba(238, 242, 247, 0.16)"; // dividers / chip borders
const CRT_ACCENT = "#e87040"; // signature orange
const CRT_ACCENT_INK = "#0a0c10"; // ink on an accent fill

// Shared layout fractions (of the canvas w/h) for the controls the DOM
// overlay must align to. Kept as fractions so the DOM hotspots track the
// painted controls regardless of the screen face aspect. titleBarH is the
// slim window-chrome strip; close box sits inside it top-left; the live
// button sits in the lower-left of the content panel.
const CRT_LAYOUT = {
  titleBarFrac: 0.135, // title bar height as a fraction of canvas height
  padFrac: 0.06, // content inset as a fraction of canvas WIDTH
} as const;

function drawProjectDetail(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  project: MacProject,
  reveal: number,
) {
  const r = clamp01(reveal);
  const PAD = Math.round(w * CRT_LAYOUT.padFrac);
  const barH = Math.round(h * CRT_LAYOUT.titleBarFrac);

  // Right-hand thumbnail panel (the scraped Devpost gallery image). When
  // present, the text column narrows to the left of it; otherwise the
  // text spans the full content width as before. The panel is an
  // aspect-matched landscape card (the gallery images are 3:2) so the
  // wordmark-centred artwork shows uncropped.
  const projImg = project.image ? getProjectImage(project.image) : undefined;
  const hasImage = imageReady(projImg);
  // Narrowed 0.34 → 0.28: a tighter, flush-right thumbnail column gives
  // the text block the dominant share of the panel and introduces the
  // asymmetric tension the symmetric ~third-column template lacked. The
  // text column widens to fill the reclaimed space (textMaxW below).
  const colGap = Math.round(w * 0.045);
  const imgW = hasImage ? Math.round(w * 0.28) : 0;
  const imgX = w - PAD - imgW;
  const textRight = hasImage ? imgX - colGap : w - PAD;
  const textMaxW = textRight - PAD;

  // ── Ground ───────────────────────────────────────────────────────
  ctx.fillStyle = CRT_BASE;
  ctx.fillRect(0, 0, w, h);

  // ── Title bar (slim window chrome) ───────────────────────────────
  // A flat lifted strip with a SHARP square close control (top-left) and
  // the file path breadcrumb. No rounded corners, no gloss.
  ctx.fillStyle = CRT_BAR;
  ctx.fillRect(0, 0, w, barH);
  // Hairline under the bar.
  ctx.strokeStyle = CRT_HAIRLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, barH + 0.5);
  ctx.lineTo(w, barH + 0.5);
  ctx.stroke();

  // Close control: a sharp square outline with a clean symmetric ×,
  // top-left. (An earlier "signature strike-out" variant mismatched the
  // two arms — one dim, one orange overshooting the box — which read as
  // a rendering glitch rather than a flourish; user: "fix this cross".)
  // Both arms accent orange, equal weight, contained inside the box.
  const closeSz = Math.round(barH * 0.42);
  const closeX = PAD;
  const closeY = Math.round((barH - closeSz) / 2);
  ctx.strokeStyle = CRT_HAIRLINE;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(closeX, closeY, closeSz, closeSz);
  const g = Math.round(closeSz * 0.3);
  ctx.strokeStyle = CRT_ACCENT;
  ctx.lineWidth = 2;
  ctx.lineCap = "square";
  ctx.beginPath();
  ctx.moveTo(closeX + g, closeY + g);
  ctx.lineTo(closeX + closeSz - g, closeY + closeSz - g);
  ctx.moveTo(closeX + g, closeY + closeSz - g);
  ctx.lineTo(closeX + closeSz - g, closeY + g);
  ctx.stroke();
  ctx.lineCap = "butt";

  // Breadcrumb path: mono, the one place mono suits (a system label).
  const crumbX = closeX + closeSz + 16;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `16px ${PIXEL_FONT}`;
  ctx.fillStyle = CRT_TEXT_DIM;
  const crumbBase = "projects.dir / ";
  ctx.fillText(crumbBase, crumbX, barH / 2 + 1);
  const crumbBaseW = ctx.measureText(crumbBase).width;
  ctx.fillStyle = CRT_ACCENT;
  ctx.font = `16px ${PIXEL_FONT}`;
  ctx.fillText(project.id, crumbX + crumbBaseW, barH / 2 + 1);

  // ESC hint: quiet faint mono label, right-aligned in the title bar
  // (mirrors the × close box on the top-left: standard window-chrome
  // keyboard hint). Right-aligned to w - PAD so it never collides with
  // the breadcrumb at narrow screen aspects. Paint-only, no DOM hotspot.
  ctx.font = `15px ${PIXEL_FONT}`;
  ctx.fillStyle = CRT_TEXT_FAINT;
  drawTracked(ctx, "ESC TO CLOSE", w - PAD, barH / 2 + 1, 1.5, "right");
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // ── Content panel ────────────────────────────────────────────────
  // Header wipe: the title bar + title slide/fade in first (reveal
  // 0 → 0.35), body types in after (0.3 → 0.85). The body finishes typing
  // a bit BEFORE the dolly fully settles: the open lerp approaches 1
  // asymptotically, so tying the LAST char to r===1 left every blurb
  // stranded ~2% short (cut off mid-word). Completing by r≈0.85 guarantees
  // the full description is shown well before the camera comes to rest.
  const headReveal = clamp01(r / 0.35);
  const bodyReveal = clamp01((r - 0.3) / 0.55);

  // Reclaim vertical space above the blurb (tighter than before) so the
  // longest blurb fits without truncation; see fit calc at the blurb below.
  let y = barH + Math.round(h * 0.045);

  // Meta line: mono, tracked, dim. The "system info" row.
  ctx.globalAlpha = headReveal;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = CRT_TEXT_DIM;
  ctx.font = `15px ${PIXEL_FONT}`;
  drawTracked(ctx, ensureUppercase(project.meta), PAD, y, 1.5);
  y += Math.round(h * 0.05);

  // Title: the HERO moment of the detail view. Bumped 0.058 → 0.07 and
  // weighted to 700 so it dominates the panel rather than merely reading.
  // Stays cool-white (the accent lives in the bar beneath) so a long
  // title never loses legibility. Auto-shrinks so long titles never clip.
  ctx.fillStyle = CRT_TEXT;
  let titleSize = Math.round(h * 0.07);
  ctx.font = `${titleSize}px ${PIXEL_FONT}`;
  const maxTitleW = textMaxW;
  while (ctx.measureText(project.title).width > maxTitleW && titleSize > 22) {
    titleSize -= 2;
    ctx.font = `${titleSize}px ${PIXEL_FONT}`;
  }
  ctx.fillText(project.title, PAD, y);
  const titleW = Math.min(ctx.measureText(project.title).width, maxTitleW);
  y += Math.round(titleSize * 0.5);

  // Accent bar under the title: a confident orange rule the FULL width of
  // the title (was a fixed short 0.08w tick) so the title reads as the
  // hero element it is — a bold underline anchoring the wordmark, not a
  // decorative hairline. Thickened 2 → 4px to match the new weight.
  ctx.fillStyle = CRT_ACCENT;
  ctx.fillRect(PAD, y, Math.round(titleW), 4);
  y += 4;
  ctx.globalAlpha = 1;

  // ── Thumbnail panel (right column) ───────────────────────────────
  // Aspect-matched landscape card, vertically centred in the content
  // area, with a hairline frame to match the OS-panel language.
  if (hasImage) {
    const imgH = Math.round(imgW * (537 / 806));
    const panelTop = barH + Math.round(h * 0.04);
    const panelBottom = h - PAD;
    const imgTop = Math.round(panelTop + (panelBottom - panelTop - imgH) / 2);
    ctx.globalAlpha = headReveal;
    drawImageCover(ctx, projImg, imgX, imgTop, imgW, imgH);
    ctx.strokeStyle = CRT_HAIRLINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(imgX + 0.5, imgTop + 0.5, imgW - 1, imgH - 1);
    ctx.globalAlpha = 1;
  }

  // ── Footer geometry (button) ──────────────────────────────────────
  // btnH/btnY are kept on the prior formula so the DOM hotspot overlay
  // stays aligned to the painted button.
  const btnH = Math.round(h * 0.085);
  const btnY = h - PAD - btnH;
  const hasLink = !!(project.liveHref || project.repoHref);

  // Pre-measure the tag chips into up to TWO wrapped rows (the narrowed
  // text column can't fit 5-6 chips on one line). Measured first so the
  // blurb can be capped to the room above the tag block.
  const chipFont = `15px ${PIXEL_FONT}`;
  const chipH = Math.round(h * 0.046);
  const chipGapX = 7;
  const chipGapY = 7;
  ctx.font = chipFont;
  const tagRows: { label: string; tw: number }[][] = [];
  if (project.tags.length > 0) {
    let rowArr: { label: string; tw: number }[] = [];
    let rowW = 0;
    for (const tag of project.tags) {
      const label = ensureUppercase(tag);
      const tw = Math.round(ctx.measureText(label).width + 20);
      if (rowArr.length && rowW + tw > textMaxW) {
        tagRows.push(rowArr);
        rowArr = [];
        rowW = 0;
        if (tagRows.length >= 2) break; // cap at 2 rows
      }
      rowArr.push({ label, tw });
      rowW += tw + chipGapX;
    }
    if (rowArr.length && tagRows.length < 2) tagRows.push(rowArr);
  }
  const numTagRows = tagRows.length;
  const tagBlockBottom = btnY - Math.round(h * 0.035);
  const tagBlockH =
    numTagRows > 0 ? numTagRows * chipH + (numTagRows - 1) * chipGapY : 0;
  const tagBlockTop = tagBlockBottom - tagBlockH;

  // ── Blurb (wrapped, typed-in): Geist body, cool-white dim ────────
  // FIT: the longest blurb (cognetech, ~340 chars) must NOT truncate. At
  // h=640, default aspect → textMaxW≈450px. Geist 400 averages ~0.5em/char,
  // so ~450/(0.5·bodySize) chars/line. bodySize = round(640·0.0225)=14 →
  // ~64 chars/line → 340/64 ≈ 6 lines (greedy-wrap typically 7). lineH =
  // round(14·1.34)=19. Blurb starts at by = y + round(640·0.022). With the
  // tightened gaps above, by ≈ 86+29+32(meta)+37(title·0.58)+20 ≈ 168, and
  // blurbBottom (above the 2 tag rows) ≈ 405 → ~237px / 19 = 12 lines of
  // room. 7 lines fits with comfortable headroom.
  ctx.globalAlpha = bodyReveal;
  ctx.fillStyle = CRT_TEXT_DIM;
  ctx.textBaseline = "top";
  const by0 = y + Math.round(h * 0.022);
  const blurbBottom = (numTagRows > 0 ? tagBlockTop : btnY) - 12;
  const availH = Math.max(0, blurbBottom - by0);

  // BODY SIZE: a confident, FIXED editorial reading size — shrink ONLY if a
  // long blurb would otherwise overflow (so it never truncates), never grow
  // to fill (that ballooned short blurbs to a clumsy size). ~17px on the
  // 640px canvas reads ~24px once the CRT is dollied to fill the viewport.
  let bodySize = Math.round(h * 0.027); // ~17px @640
  const minBodySize = Math.max(13, Math.round(h * 0.0185));
  let lineH = Math.round(bodySize * 1.5); // airy, editorial leading
  let blurbLines: string[] = [];
  for (;;) {
    ctx.font = `${bodySize}px ${BODY_FONT}`;
    blurbLines = wrapText(ctx, project.blurb, textMaxW);
    lineH = Math.round(bodySize * 1.5);
    if (blurbLines.length * lineH <= availH || bodySize <= minBodySize) break;
    bodySize -= 1;
  }

  const charsToShow = Math.floor(bodyReveal * project.blurb.length);
  let shown = 0;
  // Vertically CENTRE the blurb block within its region so the column reads
  // as a balanced cluster (meta/title up top, centred body, tags + CTA
  // anchored low) instead of text crammed under the title with a dead gap.
  const blockH = Math.min(availH, blurbLines.length * lineH);
  let by = by0 + Math.max(0, Math.round((availH - blockH) / 2));
  const blockBottom = by + blockH;
  for (let li = 0; li < blurbLines.length; li++) {
    const line = blurbLines[li]!;
    if (by + lineH > blockBottom + 1) break; // safety (full text also in a11y DOM)
    const remain = charsToShow - shown;
    if (remain <= 0) break;
    ctx.fillText(line.slice(0, Math.max(0, remain)), PAD, by);
    shown += line.length + 1;
    by += lineH;
  }
  ctx.globalAlpha = 1;

  // ── Tag chips: flat, SHARP-cornered hairline boxes, up to 2 rows ──
  if (r > 0.55 && numTagRows > 0) {
    ctx.globalAlpha = clamp01((r - 0.55) / 0.35);
    ctx.font = chipFont;
    ctx.textBaseline = "middle";
    for (let ri = 0; ri < numTagRows; ri++) {
      const rowArr = tagRows[ri]!;
      const cy = tagBlockTop + ri * (chipH + chipGapY) + chipH / 2;
      let tx = PAD;
      for (const chip of rowArr) {
        ctx.strokeStyle = CRT_HAIRLINE;
        ctx.lineWidth = 1;
        ctx.strokeRect(tx, cy - chipH / 2, chip.tw, chipH); // sharp corners
        ctx.fillStyle = CRT_TEXT_DIM;
        ctx.textAlign = "center";
        ctx.fillText(chip.label, tx + chip.tw / 2, cy);
        ctx.textAlign = "left";
        tx += chip.tw + chipGapX;
      }
    }
    ctx.globalAlpha = 1;
  }

  // ── "View live" button: flat accent fill, SHARP corners ─────────
  // The visible face of the real DOM <a> positioned over it. Pinned
  // bottom-left of the content panel.
  if (hasLink) {
    const label = project.liveHref ? liveLinkLabel(project.liveHref) : "Source";
    ctx.font = `19px ${PIXEL_FONT}`;
    ctx.textBaseline = "middle";
    const arrow = "  →";
    const btnW = Math.round(ctx.measureText(label + arrow).width + 40);
    const bx = PAD;
    ctx.fillStyle = CRT_ACCENT;
    ctx.fillRect(bx, btnY, btnW, btnH); // sharp-cornered flat button
    ctx.fillStyle = CRT_ACCENT_INK;
    ctx.textAlign = "left";
    ctx.fillText(label + arrow, bx + 20, btnY + btnH / 2 + 1);
  }
}

/** Greedy word-wrap to a pixel width using the ctx's current font. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/* ─────────────────────────────────────────────────────────────────
 * FLOAT-BEAT SCREENSAVER: a spinning ASCII sphere ("hydron") painted
 * onto the CRT while the Mac floats (BEATs 1-2), in the hero's monotone
 * orange-on-dark ASCII voice. A tiny software rasterizer samples a unit
 * sphere, rotates it on two axes by wall-clock time, z-buffers the
 * nearest sample per character cell, and shades each cell by a Lambert
 * term (normal·light) mapped to a glyph ramp + an orange→warm-white tint.
 * Repainted ~30Hz off `floatSpin` while floatActive; `t` is sampled from
 * the clock at paint time so the spin is smooth regardless of tick jitter.
 * The CRT overlay shader (scanlines/roll/vignette) rides on top, so it
 * reads as a live tube running a demo, not a flat image.
 * ──────────────────────────────────────────────────────────────── */
const ASCII_SPHERE_RAMP = ".,-~:;=!*$#@";
function drawAsciiSphere(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
) {
  ctx.fillStyle = CRT_BASE;
  ctx.fillRect(0, 0, w, h);

  // Character cell metrics (VT323 is narrow — advance ≈ 0.46em).
  const fontPx = Math.max(20, Math.round(h * 0.05));
  const cellW = fontPx * 0.46;
  const cellH = fontPx * 0.92;
  const cols = Math.max(1, Math.floor(w / cellW));
  const rows = Math.max(1, Math.floor(h / cellH));
  const N = cols * rows;
  const lum = new Float32Array(N).fill(-2); // <-1 ⇒ empty cell
  const zb = new Float32Array(N).fill(-1e9); // 1/depth: larger ⇒ nearer

  // Two-axis tumble.
  const A = t * 0.55;
  const B = t * 0.34;
  const cA = Math.cos(A);
  const sA = Math.sin(A);
  const cB = Math.cos(B);
  const sB = Math.sin(B);

  // Key light from the upper-front-left (normalized).
  const lx = -0.35;
  const ly = 0.62;
  const lz = 0.7;
  const linv = 1 / Math.hypot(lx, ly, lz);
  const Lx = lx * linv;
  const Ly = ly * linv;
  const Lz = lz * linv;

  // Sphere radius in PIXELS (equal on both axes ⇒ perfectly round even
  // though cells aren't square). Then converted to cell deltas per sample.
  const Rpx = Math.min(w, h) * 0.42;
  const cxPx = w / 2;
  const cyPx = h / 2;

  const PHI = 74;
  const THETA = 150;
  for (let i = 0; i <= PHI; i++) {
    const phi = (i / PHI) * Math.PI;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let j = 0; j < THETA; j++) {
      const theta = (j / THETA) * Math.PI * 2;
      // Unit-sphere point == its own normal.
      const x0 = sp * Math.cos(theta);
      const y0 = cp;
      const z0 = sp * Math.sin(theta);
      // Rotate about Y (B) then X (A).
      const x1 = x0 * cB + z0 * sB;
      const z1 = -x0 * sB + z0 * cB;
      const y2 = y0 * cA - z1 * sA;
      const z2 = y0 * sA + z1 * cA; // larger ⇒ nearer camera
      const x2 = x1;
      const sx = Math.round((cxPx + x2 * Rpx) / cellW);
      const sy = Math.round((cyPx - y2 * Rpx) / cellH);
      if (sx < 0 || sx >= cols || sy < 0 || sy >= rows) continue;
      const idx = sy * cols + sx;
      if (z2 > zb[idx]!) {
        zb[idx] = z2;
        // Lambert term; floored so the unlit silhouette still reads.
        const L = x2 * Lx + y2 * Ly + z2 * Lz;
        lum[idx] = Math.max(0.08, L);
      }
    }
  }

  ctx.font = `${fontPx}px ${PIXEL_FONT}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const last = ASCII_SPHERE_RAMP.length - 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const L = lum[r * cols + c]!;
      if (L < -1) continue;
      const g = Math.pow(Math.min(1, L), 0.8);
      const ch = ASCII_SPHERE_RAMP[Math.min(last, Math.round(g * last))]!;
      const rr = Math.round(232 + (255 - 232) * g);
      const gg = Math.round(112 + (240 - 112) * g);
      const bb = Math.round(64 + (220 - 64) * g);
      ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
      ctx.fillText(ch, c * cellW, r * cellH);
    }
  }
}

function drawScreen(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  projects: MacProject[],
  bootProgress: number,
  hoverIndex: number | null,
) {
  // RIGID MODERN-OS desktop, matches drawProjectDetail's language: dark
  // cool CRT ground, cool-white text, orange accent, SHARP corners.
  // (Scanlines/vignette/roll live in the screen overlay's CRT shader,
  // NOT in this canvas: shader effects animate per frame without
  // re-uploading the texture.)
  ctx.fillStyle = CRT_BASE;
  ctx.fillRect(0, 0, w, h);

  const showDesktop = bootProgress >= 0.95;
  if (!showDesktop) {
    // Boot voice: version string, mount line, READY. The "(it works
    // this time)" quip was cut per user (reads as the machine
    // apologizing), and the spinning ASCII donut that filled the lower
    // screen went the same way ("looks really stupid") — the type-in
    // boot text alone carries the beat.
    const lines = [
      "DANIEL_OS v2.6",
      "mounting projects.dir ... ok",
      "READY.",
    ];
    const totalChars = lines.reduce((s, l) => s + l.length, 0);
    const charsToShow = Math.floor(bootProgress * totalChars * 1.25);
    let remaining = charsToShow;
    ctx.fillStyle = CRT_ACCENT;
    ctx.font = `32px ${PIXEL_FONT}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    let y = 40;
    for (const line of lines) {
      if (remaining <= 0) break;
      const take = Math.min(line.length, remaining);
      remaining -= take;
      ctx.fillText(line.slice(0, take), 40, y);
      y += 42;
    }
    return;
  }

  // System header strip. Keep its height at ~11.5% of h to match the
  // ScreenClickPlane hitTile threshold (v < 0.115) so clicks stay accurate.
  const PAD = Math.round(w * 0.05);
  const headH = Math.round(h * 0.115);
  ctx.fillStyle = CRT_BAR;
  ctx.fillRect(0, 0, w, headH);
  ctx.strokeStyle = CRT_HAIRLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, headH + 0.5);
  ctx.lineTo(w, headH + 0.5);
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `18px ${PIXEL_FONT}`;
  ctx.fillStyle = CRT_ACCENT;
  ctx.fillText("projects.dir", PAD, headH / 2 + 1);
  ctx.textAlign = "right";
  ctx.fillStyle = CRT_TEXT_DIM;
  drawTracked(
    ctx,
    `${projects.length} ITEMS`,
    w - PAD,
    headH / 2 + 1,
    1.5,
    "right",
  );
  ctx.textAlign = "left";

  // 2-column tile grid filling the area below the header. Sharp corners.
  const gridTop = headH + Math.round(h * 0.04);
  const gap = Math.round(w * 0.03);
  const tileW = (w - PAD * 2 - gap) / 2;
  const tileH = (h - gridTop - PAD - gap) / 2;
  const cols = 2;
  projects.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = PAD + col * (tileW + gap);
    const y = gridTop + row * (tileH + gap);
    const hovered = hoverIndex === i;

    // Tile face: the real Devpost thumbnail (cover-fit) when decoded,
    // with a dark scrim toward the bottom so the meta + title stay
    // legible over any artwork. Falls back to a subtle hue wash before
    // the image loads / when a project has no thumbnail.
    const img = p.image ? getProjectImage(p.image) : undefined;
    if (imageReady(img)) {
      drawImageCover(ctx, img, x, y, tileW, tileH);
      const scrim = ctx.createLinearGradient(x, y, x, y + tileH);
      scrim.addColorStop(0, "rgba(10, 12, 16, 0.04)");
      scrim.addColorStop(0.5, "rgba(10, 12, 16, 0.20)");
      scrim.addColorStop(1, "rgba(10, 12, 16, 0.88)");
      ctx.fillStyle = scrim;
      ctx.fillRect(x, y, tileW, tileH);
      if (hovered) {
        ctx.fillStyle = "rgba(238, 242, 247, 0.08)";
        ctx.fillRect(x, y, tileW, tileH);
      }
    } else {
      const grad = ctx.createLinearGradient(x, y, x, y + tileH);
      grad.addColorStop(0, withAlpha(p.color, hovered ? 0.42 : 0.26));
      grad.addColorStop(1, withAlpha(p.color, hovered ? 0.12 : 0.06));
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, tileW, tileH);
    }
    ctx.strokeStyle = hovered ? CRT_ACCENT : CRT_HAIRLINE;
    ctx.lineWidth = hovered ? 2 : 1;
    ctx.strokeRect(
      x + ctx.lineWidth / 2,
      y + ctx.lineWidth / 2,
      tileW - ctx.lineWidth,
      tileH - ctx.lineWidth,
    );

    if (hovered) {
      // "OPEN" affordance: flat accent tab, top-right, sharp corners.
      ctx.font = `14px ${PIXEL_FONT}`;
      const hintText = "OPEN ↵";
      const hintW = ctx.measureText(hintText).width + 18;
      const hintH = Math.round(tileH * 0.13);
      const hintX = x + tileW - 14 - hintW;
      const hintY = y + 14;
      ctx.fillStyle = CRT_ACCENT;
      ctx.fillRect(hintX, hintY, hintW, hintH);
      ctx.fillStyle = CRT_ACCENT_INK;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(hintText, hintX + hintW / 2, hintY + hintH / 2 + 1);
      ctx.textAlign = "left";
    }

    // Tile meta (mono) + title (Geist), bottom-left.
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = CRT_TEXT_DIM;
    ctx.font = `15px ${PIXEL_FONT}`;
    drawTracked(
      ctx,
      ensureUppercase(p.meta.split(" · ")[0]!),
      x + 18,
      y + tileH - 44,
      1.2,
    );
    ctx.fillStyle = CRT_TEXT;
    ctx.font = `26px ${PIXEL_FONT}`;
    ctx.fillText(p.title, x + 18, y + tileH - 18);
  });
}

/** Parse a #rrggbb hex into an `rgba()` string at the given alpha. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(232, 112, 64, ${alpha})`;
  const n = parseInt(m[1]!, 16);
  const rr = (n >> 16) & 255;
  const gg = (n >> 8) & 255;
  const bb = n & 255;
  return `rgba(${rr}, ${gg}, ${bb}, ${alpha})`;
}

/**
 * Invisible click-catcher plane in 3D space, positioned over the Mac's
 * screen. Raycasts pointer events to tile row/column and dispatches.
 */
function ScreenClickPlane({
  projects,
  onSelect,
  enabled,
  onHoverChange,
}: {
  projects: MacProject[];
  onSelect: (p: MacProject) => void;
  enabled: boolean;
  onHoverChange: (i: number | null) => void;
}) {
  const cols = 2;

  // Always reset the body cursor we may have set, both on unmount AND
  // whenever the plane becomes disabled mid-hover. Without this the
  // pointer could get stuck as a "pointer" cursor: if `enabled` flips
  // false while the user is hovering a tile (e.g. scrolling back up past
  // the boot threshold so showDesktop → false), onPointerMove early-
  // returns and onPointerOut may never fire, leaving the cursor stuck.
  useEffect(() => {
    if (!enabled) {
      document.body.style.cursor = "";
      onHoverChange(null);
    }
    return () => {
      document.body.style.cursor = "";
    };
  }, [enabled, onHoverChange]);

  // Map a UV hit on the plane to a tile index (or null when above the
  // grid / out of range). Shared by hover + click so they never drift.
  const hitTile = (uv: THREE.Vector2 | undefined): number | null => {
    if (!uv) return null;
    const v = 1 - uv.y;
    if (v < 0.115) return null;
    const tileV = (v - 0.115) / 0.885;
    const row = tileV < 0.5 ? 0 : 1;
    const col = uv.x < 0.5 ? 0 : 1;
    const i = row * cols + col;
    return i < projects.length ? i : null;
  };

  return (
    <mesh
      position={[0, 1.0, 0.557]}
      onPointerMove={(e) => {
        if (!enabled) return;
        const i = hitTile(e.uv);
        onHoverChange(i);
        // cursor:pointer only over an actual tile; design-system
        // forbids missing cursor:pointer on clickables AND a misleading
        // pointer over the dead gutter/header band.
        document.body.style.cursor = i != null ? "pointer" : "";
      }}
      onPointerOut={() => {
        onHoverChange(null);
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        if (!enabled) return;
        const i = hitTile(e.uv);
        if (i != null) onSelect(projects[i]!);
      }}
    >
      <planeGeometry args={[1.02, 0.72]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/**
 * Click-catcher that closes the open project. Sits over the CRT screen
 * while the detail view is showing; a click anywhere on the screen pulls
 * the camera back to the tile grid (the canvas-drawn "VIEW LIVE" button
 * is not itself clickable (the real link lives in the DOM overlay), so
 * this gives the screen a sensible whole-surface "back" gesture). The
 * `enabled` gate keeps it from intercepting until the zoom is underway.
 */
function ScreenBackPlane({
  enabled,
  onBack,
}: {
  enabled: boolean;
  onBack: () => void;
}) {
  useEffect(() => {
    if (!enabled) document.body.style.cursor = "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [enabled]);
  return (
    <mesh
      position={[0, 1.0, 0.558]}
      onPointerOver={() => {
        if (enabled) document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        if (!enabled) return;
        e.stopPropagation();
        onBack();
      }}
    >
      <planeGeometry args={[1.02, 0.72]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * Scene root: owns refs for orbit angle + dissolve + spin so the
 * orbit and the Mac choreography can be driven in lockstep from a
 * single useFrame loop.
 * ──────────────────────────────────────────────────────────────── */

function Scene({
  pinProgressRef,
  projects,
  onSelectProject,
  selected,
  onCloseProject,
  onScreenRect,
  visibleRef,
}: Props & { visibleRef: React.RefObject<boolean> }) {
  // Narrow (≤900px): skip the scroll-orbit choreography entirely and
  // present the Mac LANDED + facing the user with the screen on and
  // tiles tappable. The section isn't pinned at these widths
  // (Macintosh.tsx skips the pin), so pinProgressRef stays at its
  // initial 0; reading it would leave the Mac floating high, tilted,
  // and dark (exactly the "blank scene" bug). Forcing the effective
  // progress to 1 lands it immediately.
  const narrow = useMacNarrow();
  const macGroupRef = useRef<THREE.Group>(null);
  // Tilt group sits between the Y-translation group (macGroupRef) and
  // the spin group (macSpinRef). It holds the keypad-style float pose
  // (X/Y/Z euler from MAC_FLOAT_TILT_*) and unwinds to 0 during the
  // descent so the screen faces camera by the time the boot starts.
  const macTiltRef = useRef<THREE.Group>(null);
  const macSpinRef = useRef<THREE.Group>(null);
  const shadowMatRef = useRef<THREE.ShadowMaterial>(null);
  // Handle to the shadow-casting key light so the useFrame loop can
  // toggle its shadow map render off until the contact shadow ramps in.
  const shadowLightRef = useRef<THREE.DirectionalLight>(null);
  // Overlay material handle written by MacBody once the GLB has been
  // cloned + traversed and the screen-overlay plane exists. Until then
  // this is null; the useFrame loop short-circuits. (CRT post shader:
  // the loop drives uOpacity for the boot ramp and uTime for the
  // moving scanlines/roll/flicker.)
  const overlayMatRef = useRef<THREE.ShaderMaterial | null>(null);
  // Live screen face geometry (mesh + local center/normal + aspect),
  // written by MacBody once the overlay exists. The detail-zoom camera
  // reads it to aim dead-on down the screen's world normal.
  const screenInfoRef = useRef<ScreenInfo | null>(null);
  const orbitAngleRef = useRef(0);
  const dissolveRef = useRef(0);
  const macSelfSpinRef = useRef(0);
  // Detail-zoom progress, LERPED toward its target each frame (1 when a
  // project is open, 0 when not) so the camera push-in / pull-out is
  // smooth and fixed-rate, never bound straight to the open/closed flag.
  const detailZoomRef = useRef(0);

  const [bootProgress, setBootProgress] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // detailReveal mirrors detailZoomRef into React state (throttled) so
  // the CanvasTexture can repaint the typing-in detail view. Like
  // bootProgress it's stepped at ~30Hz, not per frame.
  const [detailReveal, setDetailReveal] = useState(0);
  // Aspect ratio (w/h) of the physical CRT screen face, set once MacBody
  // publishes the geometry. The CRT canvas is sized to this so the drawn
  // UI maps 1:1 onto the screen plane (no horizontal squish). Starts at
  // the prior fixed 780/550 until the real value arrives.
  const [screenAspect, setScreenAspect] = useState(780 / 550);
  // Float-beat screensaver gate + animation tick (see useScreenTexture).
  const [floatActive, setFloatActive] = useState(false);
  const [floatSpin, setFloatSpin] = useState(0);
  const lastTickRef = useRef(0);
  // Normalized cursor position (-1..1 each axis; top = -1) for the float
  // parallax. Ref, not state, so the per-frame read never re-renders.
  const pointerRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMove = (e: PointerEvent) => {
      pointerRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerRef.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Preload the project thumbnails; the version bumps as each decodes so
  // the CanvasTexture rebuilds and the artwork paints in.
  const imageVersion = useProjectImages(projects);

  const screenTexture = useScreenTexture(
    projects,
    bootProgress,
    hoverIndex,
    selected,
    detailReveal,
    imageVersion,
    screenAspect,
    floatActive,
    floatSpin,
  );
  const { invalidate, camera, size } = useThree();

  // Repaint the screen once a late-decoding thumbnail becomes ready (the
  // canvas is only redrawn on demand).
  useEffect(() => {
    invalidate();
  }, [imageVersion, invalidate]);

  // CRT PAGE-TRANSITION GLITCH: stamp the pulse whenever the "page"
  // changes (project opened, closed, or switched). The useFrame below
  // decays uGlitch from 1 → 0 over ~400ms — a brief sync-loss tear,
  // chroma split and noise burst on the screen shader. The undefined
  // sentinel skips the mount run so loading the section never glitches.
  const glitchStartRef = useRef(0);
  const prevSelectedRef = useRef<MacProject | null | undefined>(undefined);
  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (
      !reduced &&
      prevSelectedRef.current !== undefined &&
      prevSelectedRef.current !== selected
    ) {
      glitchStartRef.current = performance.now();
      invalidate();
    }
    prevSelectedRef.current = selected;
  }, [selected, invalidate]);

  useFrame((_, dt) => {
    // PERF: short-circuit when off-screen. With frameloop="demand" on
    // the canvas, this stops the entire WebGL submit pipeline while
    // the user is on other sections.
    if (visibleRef.current === false) return;
    invalidate();
    // On narrow viewports the section isn't pinned, so the scroll-driven
    // pinProgressRef never advances. Drive the choreography from a fixed
    // landed value (1) so the Mac sits descended, square-on, booted, and
    // clickable. The mobile experience is "the Mac, landed" with no
    // orbit beat. Desktop reads the live scroll progress as before.
    const p = narrow ? 1 : pinProgressRef.current;

    // ── ORBIT ANGLE (drives the LogoOrbit group rotation) ─────────
    // Cards hold their starting positions through BEAT 1, then sweep
    // a full 2π revolution across BEAT 2. The mapping is linear over
    // the orbit window so the angular velocity is constant, feels
    // like real orbital motion, not an ease that "snaps" at the end.
    const orbitT = clamp01(
      (p - THRESHOLDS.orbitStart) /
        (THRESHOLDS.orbitEnd - THRESHOLDS.orbitStart),
    );
    orbitAngleRef.current = orbitT * ORBIT_SWEEP;

    // ── DISSOLVE (cards fade + drift + scale-down) ────────────────
    const dissolveT = clamp01(
      (p - THRESHOLDS.dissolveStart) /
        (THRESHOLDS.dissolveEnd - THRESHOLDS.dissolveStart),
    );
    dissolveRef.current = easeOutCubic(dissolveT);

    // ── MAC DESCENT ───────────────────────────────────────────────
    const descentT = clamp01(
      (p - THRESHOLDS.descentStart) /
        (THRESHOLDS.descentEnd - THRESHOLDS.descentStart),
    );
    const descent = easeInOutCubic(descentT);
    if (macGroupRef.current) {
      macGroupRef.current.position.y =
        MAC_HOVER_Y + (MAC_REST_Y - MAC_HOVER_Y) * descent;
    }

    // ── MAC FLOAT TILT ────────────────────────────────────────────
    // BEATs 1-2 (float + orbit): keypad-style tilt. BEAT 3 (land):
    // tilt blends back to 0 in parallel with the descent so the
    // screen face is square to the camera when the CRT lights up.
    // The unwind window mirrors the descent window, same easing,
    // so the tilt and translation feel like a single landing motion.
    const tiltT = clamp01(
      (p - TILT_UNWIND_START) / (TILT_UNWIND_END - TILT_UNWIND_START),
    );
    const tiltUnwind = easeInOutCubic(tiltT);
    const tiltFactor = 1 - tiltUnwind;
    if (macTiltRef.current) {
      macTiltRef.current.rotation.x = MAC_FLOAT_TILT_X * tiltFactor;
      macTiltRef.current.rotation.y = MAC_FLOAT_TILT_Y * tiltFactor;
      macTiltRef.current.rotation.z = MAC_FLOAT_TILT_Z * tiltFactor;
    }

    // ── MAC SELF-SPIN (gentle Y sway) ─────────────────────────────
    // The Mac sways slowly around its front-facing Y orientation during
    // BEATs 1-2: a calm hover, NOT a full revolution, so the tipped-up
    // screen always faces the viewer (see MAC_SPIN_* notes). The sway
    // amplitude damps to 0 across the spin-settle window so the Mac is
    // dead-square to camera by the time the descent + CRT boot begin.
    const settleT = clamp01(
      (p - THRESHOLDS.spinSettleStart) /
        (THRESHOLDS.spinSettleEnd - THRESHOLDS.spinSettleStart),
    );
    const spinFactor = 1 - settleT;
    // CURSOR PARALLAX: turn the Mac toward the pointer (yaw ← cursor X,
    // pitch ← cursor Y) during the float beats, eased toward the target so
    // it glides. A faint idle sway keeps it alive when the pointer is
    // still. Everything scales by spinFactor so it unwinds to square-on as
    // the descent begins. Phase advances regardless so the idle term is
    // continuous.
    macSelfSpinRef.current += dt * MAC_SPIN_RATE;
    if (macSpinRef.current) {
      const g = macSpinRef.current;
      const idle = Math.sin(macSelfSpinRef.current) * MAC_SPIN_AMP * 0.12;
      const targetYaw =
        (pointerRef.current.x * PARALLAX_YAW + idle) * spinFactor;
      const targetPitch = pointerRef.current.y * PARALLAX_PITCH * spinFactor;
      const k = 1 - Math.exp(-PARALLAX_RATE * Math.min(dt, 0.05));
      g.rotation.y += (targetYaw - g.rotation.y) * k;
      g.rotation.x += (targetPitch - g.rotation.x) * k;
    }

    // ── SHADOW PLATE ──────────────────────────────────────────────
    const shadowT = clamp01(
      (p - THRESHOLDS.shadowStart) /
        (THRESHOLDS.shadowEnd - THRESHOLDS.shadowStart),
    );
    if (shadowMatRef.current) {
      shadowMatRef.current.opacity = shadowT * 0.22;
    }
    // PERF: gate the shadow-map depth pass behind the contact-shadow ramp.
    //   OLD: directional light rendered its shadow map EVERY visible frame
    //        (full GLB depth pass) even during BEATs 1-2 when shadowT===0
    //        and the ShadowMaterial plate is fully transparent — invisible
    //        cost on every frame the Mac is floating.
    //   NEW: light.castShadow flips on only while shadowT>0 (shadow actually
    //        visible). Identical look (plate opacity is 0 before the ramp),
    //        zero shadow-map render during the long float/spin beats.
    if (shadowLightRef.current) {
      shadowLightRef.current.castShadow = shadowT > 0;
    }

    // ── CRT BOOT ──────────────────────────────────────────────────
    const newBoot = clamp01(
      (p - THRESHOLDS.bootStart) /
        (THRESHOLDS.bootEnd - THRESHOLDS.bootStart),
    );
    const now = performance.now();
    if (now - lastTickRef.current >= 33) {
      lastTickRef.current = now;
      setBootProgress((prev) => (Math.abs(prev - newBoot) > 0.02 ? newBoot : prev));
      // Float-beat screensaver gate: on before the CRT boot, while no
      // project is open and not on the narrow/landed path. Tick floatSpin
      // so useScreenTexture re-runs and the ASCII sphere animates.
      const fa = !narrow && !selected && p < THRESHOLDS.bootStart;
      setFloatActive((prev) => (prev === fa ? prev : fa));
      if (fa) setFloatSpin((s) => (s + 1) % 1000000);
      const dz = detailZoomRef.current;
      // Snap to exactly 0 once closed (texture falls back to the tile grid)
      // AND exactly 1 once fully open. Without the ==1 case, the throttled
      // 0.02-step mirror stranded detailReveal at ~0.98 while the asymptotic
      // dolly lerp crept the final 2% toward 1 — so the blurb's typed-in
      // reveal (bodyReveal = (r-0.3)/0.7) topped out at ~97% and EVERY
      // description was cut off mid-word at the end.
      setDetailReveal((prev) =>
        dz === 0
          ? prev === 0
            ? prev
            : 0
          : dz === 1
            ? prev === 1
              ? prev
              : 1
            : Math.abs(prev - dz) > 0.02
              ? dz
              : prev,
      );
      // Publish the real screen-face aspect once MacBody has built the
      // overlay, so the CRT canvas matches the screen plane (no squish).
      const info = screenInfoRef.current;
      if (info) {
        setScreenAspect((prev) =>
          Math.abs(prev - info.aspect) > 0.01 ? info.aspect : prev,
        );
      }

      // ── PROJECT THE SCREEN RECT FOR THE DOM CONTROL OVERLAY ──────
      // Project the overlay plane's 4 corners to on-screen CSS pixels so
      // the real clickable close + live controls can sit exactly over
      // their painted faces. Desktop only; emits null when no project is
      // open so the overlay clears. Throttled with this 33ms tick.
      if (onScreenRect && !narrow) {
        const dz = detailZoomRef.current;
        if (selected && info && dz > 0.001) {
          const ov = info.overlay;
          ov.updateWorldMatrix(true, false);
          // The overlay PlaneGeometry spans ±faceW/2 × ±faceH/2 in local
          // space, so scale the unit corner offsets by the real face size.
          const hW = (info.faceH * info.aspect) / 2;
          const hH = info.faceH / 2;
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const [cx, cy] of _planeCorners) {
            _corner
              .set(cx * 2 * hW, cy * 2 * hH, 0)
              .applyMatrix4(ov.matrixWorld)
              .project(camera);
            const px = (_corner.x * 0.5 + 0.5) * size.width;
            const py = (-_corner.y * 0.5 + 0.5) * size.height;
            if (px < minX) minX = px;
            if (py < minY) minY = py;
            if (px > maxX) maxX = px;
            if (py > maxY) maxY = py;
          }
          onScreenRect({
            x: minX,
            y: minY,
            w: maxX - minX,
            h: maxY - minY,
            vis: easeInOutCubic(clamp01(dz)),
          });
        } else {
          onScreenRect(null);
        }
      }
    }

    // ── DETAIL-ZOOM PROGRESS (fixed-rate lerp toward open/closed) ──
    // Target is 1 when a project is open, 0 otherwise. We lerp toward it
    // (not snap) so the camera push-in / pull-out is smooth on BOTH
    // open and close. On narrow the screen is already filling the frame
    // and the section isn't scroll-pinned, so the dolly machinery below
    // is skipped, but we still advance the ref so the CRT detail
    // texture reveals (the narrow path renders detail in-place without a
    // camera move). Only zoom in once the boot has completed enough that
    // the screen is on (avoids zooming into a dark CRT mid-scroll-up).
    const canOpen = narrow || pinProgressRef.current >= THRESHOLDS.bootEnd;
    const detailTarget = selected && canOpen ? 1 : 0;
    detailZoomRef.current +=
      (detailTarget - detailZoomRef.current) * (1 - Math.exp(-dt * DETAIL_RATE));
    if (detailZoomRef.current < 0.0005) detailZoomRef.current = 0;
    // Asymptotic lerp never hits 1 exactly; snap it so the detail reveal
    // (and the blurb's typing) actually completes instead of stalling ~98%.
    else if (detailTarget === 1 && detailZoomRef.current > 0.999)
      detailZoomRef.current = 1;
    const detail = easeInOutCubic(clamp01(detailZoomRef.current));

    // ── CAMERA DOLLY-IN + DETAIL-ZOOM ─────────────────────────────
    // BEATs 1-2: hold the wide orbit framing. BEAT 3: travel in toward
    // the landed Mac so the CRT face dominates the frame and the tiles
    // become readable. Then, when a project opens, push FURTHER in (the
    // detail-zoom) until the screen face fills the viewport. Skipped on
    // narrow; CameraFramer parks the close framing there (the section
    // isn't scroll-pinned at narrow widths, so a pin-driven dolly would
    // have nothing to read; the narrow detail view stays at the framed
    // pose and just swaps the CRT texture).
    if (!narrow) {
      const dollyT = clamp01(
        (p - DOLLY_START) / (DOLLY_END - DOLLY_START),
      );
      const dolly = easeInOutCubic(dollyT);
      const landedZ = DOLLY_Z_WIDE + (DOLLY_Z_CLOSE - DOLLY_Z_WIDE) * dolly;
      const landedY = DOLLY_Y_WIDE + (DOLLY_Y_CLOSE - DOLLY_Y_WIDE) * dolly;
      const landedLookY =
        DOLLY_LOOK_Y_WIDE + (DOLLY_LOOK_Y_CLOSE - DOLLY_LOOK_Y_WIDE) * dolly;

      // Landed pose: straight down −Z, looking at the screen-center column.
      const landedPosX = 0;
      const landedPosY = landedY;
      const landedPosZ = landedZ;
      const landedLookX = 0;
      const landedLookYv = landedLookY;
      const landedLookZ = 0;

      // DETAIL pose: aim DEAD-ON down the screen face's LIVE world normal.
      // The GLB seats the CRT face at an angle, so a straight-down-Z camera
      // renders it keystoned/slanted. We derive the screen's world center +
      // world outward normal from the mesh's live world matrix and place the
      // camera ALONG that normal at a distance that fills DETAIL_FILL of the
      // viewport height, so the rendered screen reads square/flat-on with a
      // sliver of PC bezel around it. Falls back to the on-axis DETAIL pose
      // if the screen geometry isn't published yet (overlay not built).
      // On-axis fallback pose (screen world-center ≈ y0.8, z0) used only
      // for the few frames before the screen geometry is published.
      let detPosX = 0;
      let detPosY = 0.8;
      let detPosZ = 1.55;
      let detLookX = 0;
      let detLookY = 0.8;
      let detLookZ = 0;
      // PERF: the detail pose (updateWorldMatrix + getNormalMatrix +
      // getWorldScale + tan + distance solve) is blended in by `detail` and
      // discarded when detail===0 (the common landed case).
      //   OLD: full normal/distance solve EVERY frame regardless of detail.
      //   NEW: guarded behind detail>0.0001 → O(1) constant work when not
      //        zooming; identical result while zooming. Time unchanged in the
      //        detail phase, skipped entirely otherwise. When detail is 0 the
      //        landed pose is used verbatim (det* defaults are inert at w=0).
      const info = detail > 0.0001 ? screenInfoRef.current : null;
      if (info) {
        const mesh = info.mesh;
        mesh.updateWorldMatrix(true, false);
        // World center of the screen face.
        _scrCenter.copy(info.localCenter).applyMatrix4(mesh.matrixWorld);
        // World outward normal (the normal matrix handles the mesh's
        // rotation + scale). Normalize, then ensure it points toward the
        // camera side (+Z) so the camera sits IN FRONT of the screen.
        _normalMat.getNormalMatrix(mesh.matrixWorld);
        _scrNormal.copy(info.localNormal).applyMatrix3(_normalMat).normalize();
        if (_scrNormal.z < 0) _scrNormal.negate();
        // World height of the screen face → distance that fills the frame.
        const worldScale = mesh.getWorldScale(_camTarget).y; // uniform ~0.21
        const faceWorldH = info.faceH * worldScale;
        const fov = THREE.MathUtils.degToRad(
          (camera as THREE.PerspectiveCamera).fov,
        );
        const halfTan = Math.tan(fov / 2);
        // Visible viewport height at distance d = 2·d·halfTan. Solve d so the
        // screen fills DETAIL_FILL of it: d = faceWorldH / (FILL·2·halfTan).
        const dist = faceWorldH / (DETAIL_FILL * 2 * halfTan);
        _camTarget.copy(_scrNormal).multiplyScalar(dist).add(_scrCenter);
        detPosX = _camTarget.x;
        detPosY = _camTarget.y;
        detPosZ = _camTarget.z;
        detLookX = _scrCenter.x;
        detLookY = _scrCenter.y;
        detLookZ = _scrCenter.z;
      }

      // Blend landed → dead-on detail pose by `detail` (0..1, eased).
      const camPX = landedPosX + (detPosX - landedPosX) * detail;
      const camPY = landedPosY + (detPosY - landedPosY) * detail;
      const camPZ = landedPosZ + (detPosZ - landedPosZ) * detail;
      const lookPX = landedLookX + (detLookX - landedLookX) * detail;
      const lookPY = landedLookYv + (detLookY - landedLookYv) * detail;
      const lookPZ = landedLookZ + (detLookZ - landedLookZ) * detail;
      camera.position.set(camPX, camPY, camPZ);
      camera.lookAt(lookPX, lookPY, lookPZ);
    }

    // Mirror the detail reveal into React state (throttled with the boot
    // tick below) so the CRT texture repaints the typing-in detail view.

    // ── SCREEN OVERLAY OPACITY ────────────────────────────────────
    // The overlay plane carries the boot text + desktop tile canvas
    // texture. We want the screen to read as OFF during BEATs 1-2 so
    // the floating Mac shows an inert dark CRT face, then power-on
    // in lockstep with the boot ramp. Opacity = newBoot (same 0..1
    // curve as bootProgress) so the typing text appears character by
    // character at the same time the picture fades up. The inert
    // black screen mesh ("#080808") stays visible underneath; the
    // overlay only adds the picture on top of it.
    const mat = overlayMatRef.current;
    if (mat) {
      // The screen now powers on EARLY (during the float) to run the ASCII
      // sphere screensaver, then carries the boot type-in + desktop. So the
      // overlay opacity is max(power-on ramp, boot ramp): a quick power-on at
      // the start of the float, held at full through boot/desktop.
      const screenOn = clamp01((p - 0.02) / 0.05);
      const targetOpacity = Math.max(screenOn, newBoot);
      // Cheap guard against re-writing the same value every frame.
      if (
        Math.abs((mat.uniforms.uOpacity!.value as number) - targetOpacity) >
        0.005
      ) {
        mat.uniforms.uOpacity!.value = targetOpacity;
      }
      // CRT clock: drives the scanline drift / refresh roll / flicker.
      // Ticks only while this scene's frameloop runs (i.e. while the
      // section is on screen), so the effects pause for free off-screen.
      mat.uniforms.uTime!.value = performance.now() / 1000;
      // Glitch pulse: exponential decay from the last page transition.
      // e^-9t ≈ 0.027 at 400ms; clamped to zero past the window so the
      // uniform isn't written forever.
      const since = (performance.now() - glitchStartRef.current) / 1000;
      const g = since < 0.4 ? Math.exp(-since * 9) : 0;
      if (Math.abs((mat.uniforms.uGlitch!.value as number) - g) > 0.002) {
        mat.uniforms.uGlitch!.value = g;
      }
    }
  });

  const showDesktop = bootProgress >= 0.95;

  return (
    <>
      {/* Cool retro-futurism studio lighting: neutral key + soft
          fill, no warm cast. Matches the keypad scene's product-shot
          treatment so the two floating-in-empty-space scenes read as
          a coherent pair. */}
      <ambientLight intensity={0.55} color="#ffffff" />
      {/* PERF: shadow-camera frustum snugged to the Mac footprint and the
          shadow map gated on by the useFrame loop only once the contact
          shadow ramps in (shadowLightRef + shadowT above).
            OLD: default ortho frustum (±5, near 0.5, far 500) → the 1024px
                 map spread over a 10×10 box (~10mm/texel) and the depth
                 pass ran every frame.
            NEW: ±1.6 box, near 1, far 12 → ~3mm/texel (sharper) AND the
                 depth pass is skipped entirely until shadowT>0. The Mac
                 body + its plate shadow sit well inside ±1.6, so the
                 visible (soft, peak-0.22) shadow is unchanged. */}
      <directionalLight
        ref={shadowLightRef}
        position={[3, 5, 3]}
        intensity={1.4}
        color="#ffffff"
        castShadow={false}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-1.6}
        shadow-camera-right={1.6}
        shadow-camera-top={1.6}
        shadow-camera-bottom={-1.6}
        shadow-camera-near={1}
        shadow-camera-far={12}
      />
      <directionalLight position={[-3, 2, 2]} intensity={0.45} color="#eef4ff" />

      {/* Mac descent group: drives the float→land Y translation.
          Composition (outer → inner):
            macGroupRef  - Y translation HOVER_Y to REST_Y
            macTiltRef   - keypad-style float pose (X/Y/Z euler) that
                           unwinds to 0 during descent so the screen
                           faces camera when boot starts
            macSpinRef   - self-spin around local Y, damped by
                           THRESHOLDS.spinSettleStart..spinSettleEnd
          The screen click-plane is OUTSIDE the tilt + spin so it stays
          axis-aligned to the camera; clicks always land on tile
          coordinates in screen-space, not on rotated UVs. */}
      <group
        ref={macGroupRef}
        position={[0, MAC_HOVER_Y, 0]}
        scale={[MAC_GROUP_SCALE, MAC_GROUP_SCALE, MAC_GROUP_SCALE]}
      >
        <group ref={macTiltRef}>
          <group ref={macSpinRef}>
            <MacBody
              screenTexture={screenTexture}
              overlayMatRef={overlayMatRef}
              screenInfoRef={screenInfoRef}
            />
          </group>
        </group>
        <ScreenClickPlane
          projects={projects}
          onSelect={onSelectProject}
          // Tile clicks engage only on the booted grid AND while no
          // project is open; when the detail view fills the CRT the
          // tiles aren't there to click, and the DOM BACK/link overlay
          // owns interaction. (onCloseProject referenced so the prop is
          // threaded through for the click-to-go-back affordance below.)
          enabled={showDesktop && !selected}
          onHoverChange={setHoverIndex}
        />
        {/* Click-to-go-back: while the detail view fills the CRT, the
            screen plane becomes a BACK target (clicking anywhere on the
            screen closes the project) so a pointer user isn't forced to
            hunt for the DOM affordance. Disabled until the zoom is well
            underway so an open-click doesn't immediately re-close. */}
        <ScreenBackPlane
          enabled={!!selected && detailReveal > 0.6}
          onBack={onCloseProject}
        />
      </group>

      {/* Logo orbit: a sibling of the Mac group so the cards orbit
          in WORLD space around the Mac's vertical axis (independent
          of the Mac's self-spin). The +0.30 offset centers the ring on
          the Mac's screen rather than its housing base, visually reads
          as "tools circling the brain", not "tools spinning around the
          feet". With MAC_HOVER_Y=0.15 the ring center sits at world
          y≈0.45, which is exactly the camera lookAt (DOLLY_LOOK_Y_WIDE),
          so the ring is dead-centered in the viewport during the float.
          Cards dissolve before the Mac drops so they're gone by the time
          the descent visibly starts. Mobile gets the flat
          TechStackTicker marquee instead; the orbit needs more
          horizontal real estate than a 390px viewport can give without
          cards overlapping the housing. */}
      {!narrow && (
        <group position={[0, MAC_HOVER_Y + 0.3, 0]}>
          <LogoOrbit
            logos={SKILL_LOGOS}
            orbitAngleRef={orbitAngleRef}
            dissolveRef={dissolveRef}
          />
        </group>
      )}

      {/* Shadow plate appears only as the Mac lands; fades in via
          ref so the floating beats stay clean (no ghosting). Y is
          a hair below REST_Y so it sits flush beneath the Mac base. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.21, 0]} receiveShadow>
        <planeGeometry args={[5, 5]} />
        <shadowMaterial ref={shadowMatRef} opacity={0} transparent />
      </mesh>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────
 * Responsive camera framing: NARROW PATH ONLY.
 *
 * On narrow viewports there's no scroll pin (Macintosh.tsx skips it) so
 * the per-frame dolly in Scene has nothing to read; the camera must be
 * parked at the close "landed Mac" framing here, on mount + resize. The
 * canvas is a tall, narrow box where the HORIZONTAL extent binds, so we
 * solve the camera distance from the screen's world width (so the CRT
 * fills ~82% of the viewport width and the tiles stay readable without
 * cropping) and recenter on the landed CRT screen (world y≈0.8).
 *
 * On WIDE viewports this is a no-op: the Scene useFrame's CAMERA DOLLY
 * block owns the camera every frame (wide orbit framing through BEATs
 * 1-2, dolly-in through BEAT 3). Writing the camera here too would
 * fight that loop, so we leave it alone. No useFrame here; narrow only
 * writes on mount + resize, so it adds no per-frame work to the demand
 * loop.
 * ──────────────────────────────────────────────────────────────── */
function CameraFramer({ narrow }: { narrow: boolean }) {
  const { camera, size, invalidate } = useThree();
  useEffect(() => {
    if (!narrow) return; // wide path: the Scene dolly owns the camera.
    const cam = camera as THREE.PerspectiveCamera;
    // Frame the LANDED Mac so the CRT tiles are readable on phones too,
    // centered on the screen (world y≈0.8) like the wide dolly's CLOSE
    // target. On a tall portrait box the HORIZONTAL extent is the binding
    // constraint: at a given distance d the visible WIDTH =
    // 2·d·tan(fov/2)·aspect. The CRT screen plane is ~1.02 world units
    // wide, so we solve d for that to fill ~82% of the viewport width
    // (margin so the rounded housing corners don't clip), then clamp.
    // Computing z from width (not a hand-tuned linear ramp) keeps the
    // screen edge-to-edge readable across phone aspect ratios instead of
    // cropping the tiles on the narrowest devices.
    const aspect = size.width / Math.max(size.height, 1);
    const fov = THREE.MathUtils.degToRad(cam.fov); // 28°
    const halfTan = Math.tan(fov / 2); // ≈0.2493
    const SCREEN_W = 1.02; // ScreenClickPlane width
    const TARGET_W_FILL = 0.82; // screen occupies ~82% of viewport width
    // d such that 2·d·halfTan·aspect = SCREEN_W / TARGET_W_FILL
    const zForWidth = SCREEN_W / TARGET_W_FILL / (2 * halfTan * aspect);
    // Clamp: never closer than 3.4 (avoid cropping the housing top on
    // near-square narrow boxes) nor further than 7.0 (avoid shrinking the
    // tiles on ultra-tall slivers). aspect 0.462 (390×844) → z≈5.4.
    const z = THREE.MathUtils.clamp(zForWidth, 3.4, 7.0);
    cam.position.set(0, 0.8, z);
    cam.lookAt(0, 0.8, 0);
    cam.updateProjectionMatrix();
    // Demand loop: render the new pose immediately (resize / breakpoint
    // cross can happen while the loop is otherwise idle).
    invalidate();
  }, [camera, narrow, size.width, size.height, invalidate]);
  return null;
}

export function MacintoshScene(props: Props) {
  // PERF: visibility ref toggled by IntersectionObserver. The useFrame
  // inside Scene early-returns when this is false; with frameloop=
  // "demand" the canvas idles entirely while the user is on other
  // sections (Hero, About, Other, etc.). The IO callback ALSO writes
  // to invalidateRef so the Canvas can be poked back to life on
  // re-entry (otherwise the demand loop would never restart; Scene's
  // useFrame is the only invalidator, and it early-returns until
  // visibleRef flips).
  const wrapRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef<boolean>(false);
  const invalidateRef = useRef<(() => void) | null>(null);
  // mac.glb load gate: flipped true by LoadedSignal (which only mounts
  // once <Scene>'s useGLTF suspense resolves). Drives the DOM loading
  // overlay so the section shows a "booting" placeholder instead of a
  // blank transparent canvas on a cold/slow load.
  const [loaded, setLoaded] = useState(false);
  // Drives responsive camera framing (CameraFramer below). Same 900px
  // breakpoint as the CSS + the Scene's orbit gate.
  const narrow = useMacNarrow();
  // When the breakpoint flips, the demand loop may be idle; poke it so
  // CameraFramer's new pose actually renders (otherwise the canvas
  // would hold the previous frame until the next scroll/IO event).
  useEffect(() => {
    if (invalidateRef.current) invalidateRef.current();
  }, [narrow]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const next = entry.isIntersecting;
          const was = visibleRef.current;
          visibleRef.current = next;
          // Kick the demand loop on the visible-edge transition so
          // Scene's useFrame can resume invalidating.
          if (next && !was && invalidateRef.current) invalidateRef.current();
        }
      },
      { rootMargin: "25% 0px 25% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
      <Canvas
        // Initial pose matches the wide FLOAT framing (the per-frame
        // dolly in Scene overwrites this every visible frame, but aligning
        // the initial values avoids a one-frame flash before useFrame
        // runs). Camera at z=DOLLY_Z_WIDE(8.5), level at y=0.58, looking at
        // the composition center (0, 0.58, 0) so the Mac + ring are
        // vertically centered. FOV stays 28; a tighter FOV would crop the
        // wider orbit ring on the sides.
        camera={{ position: [0, 0.58, 8.5], fov: 28, near: 0.1, far: 40 }}
        // PERF: cap DPR at 1.25 (was 1.5). The Mac surface is mostly
        // matte and the CanvasTexture for the screen is 780x550; past
        // 1.25× we're shading pixels nobody can see in the resolved
        // output. 1.25 is the same target as the room canvas.
        dpr={[1, 1.25]}
        // PERF: demand frame loop; Scene's useFrame calls invalidate()
        // each visible frame to keep the loop running while on-screen,
        // and as soon as visibleRef flips false the loop quiets.
        frameloop="demand"
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
          powerPreference: "high-performance",
        }}
        onCreated={({ camera, gl, invalidate }) => {
          camera.lookAt(0, 0.58, 0);
          gl.setClearColor(0x000000, 0);
          // Expose invalidate to the IO callback above. Re-entering
          // the section pokes the loop alive even though Scene's
          // useFrame was the only previous invalidator.
          invalidateRef.current = invalidate;
        }}
      >
        {/* Suspense boundary so the mac.glb fetch doesn't bubble an
            unhandled suspension out of the Canvas. fallback={null}
            keeps the canvas transparent (it composites onto the cool
            page bg) while the DOM overlay below shows the load state.
            LoadedSignal mounts only after the GLB resolves. */}
        <Suspense fallback={null}>
          <Scene {...props} visibleRef={visibleRef} />
          <LoadedSignal onLoaded={() => setLoaded(true)} />
        </Suspense>
        {/* Responsive framing: dollies in + recenters on the landed
            Mac at ≤900px; restores the wide orbit pose above. Disabled
            in tune mode so OrbitControls owns the camera. */}
        {!TUNE_MODE && <CameraFramer narrow={narrow} />}
        {TUNE_MODE && <TuneCameraReader />}
        {TUNE_MODE && (
          <OrbitControls
            enableDamping
            dampingFactor={0.08}
            target={[0, 0.8, 0]}
            minDistance={2}
            maxDistance={20}
          />
        )}
      </Canvas>
      {/* DOM loading state: a quiet "booting" chip centered over the
          stage until the GLB resolves. Removed (not just hidden) once
          loaded so it never intercepts pointer events on the canvas. */}
      {!loaded && (
        <div className="mac-loading" role="status" aria-live="polite">
          <span className="mac-loading-dot" aria-hidden="true" />
          <span>Booting projects…</span>
        </div>
      )}
      {TUNE_MODE && <MacTuneHUD />}
    </div>
  );
}

/**
 * Mounts only after the surrounding <Suspense> resolves (i.e. once
 * mac.glb has loaded), so its mount effect is a reliable "model ready"
 * signal for the DOM loading overlay. Renders nothing in the scene.
 */
function LoadedSignal({ onLoaded }: { onLoaded: () => void }) {
  useEffect(() => {
    onLoaded();
  }, [onLoaded]);
  return null;
}

/** TUNE_MODE only: copies camera pose into window.__macCamTune. */
function TuneCameraReader() {
  const { camera } = useThree();
  useFrame(() => {
    const c = camera as THREE.PerspectiveCamera;
    (window as unknown as {
      __macCamTune?: { pos: [number, number, number]; fov: number };
    }).__macCamTune = {
      pos: [
        Math.round(c.position.x * 100) / 100,
        Math.round(c.position.y * 100) / 100,
        Math.round(c.position.z * 100) / 100,
      ],
      fov: Math.round(c.fov * 10) / 10,
    };
  });
  return null;
}

function MacTuneHUD() {
  const [scale, setScale] = useState(0.21);
  const [y, setY] = useState(0);
  const [camInfo, setCamInfo] = useState({ pos: [0, 1.6, 7] as number[], fov: 28 });

  useEffect(() => {
    (window as unknown as { __macTune: { scale: number; y: number } })
      .__macTune = { scale, y };
  }, [scale, y]);

  useEffect(() => {
    const id = setInterval(() => {
      const c = (window as unknown as {
        __macCamTune?: { pos: [number, number, number]; fov: number };
      }).__macCamTune;
      if (c) setCamInfo(c);
    }, 100);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: 16,
        zIndex: 9999,
        background: "rgba(20, 17, 14, 0.92)",
        color: "#fff",
        padding: "16px 18px",
        borderRadius: 10,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        letterSpacing: "0.06em",
        lineHeight: 1.5,
        boxShadow: "0 12px 32px -8px rgba(0,0,0,0.55)",
        width: 260,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 10, color: "#ffae6a" }}>
        MAC TUNE
      </div>
      <label style={{ display: "block", marginBottom: 8 }}>
        scale: {scale.toFixed(3)}
        <input
          type="range"
          min={0.05}
          max={1.5}
          step={0.005}
          value={scale}
          onChange={(e) => setScale(parseFloat(e.target.value))}
          style={{ width: "100%", marginTop: 4 }}
        />
      </label>
      <label style={{ display: "block", marginBottom: 12 }}>
        y offset: {y.toFixed(3)}
        <input
          type="range"
          min={-3}
          max={3}
          step={0.01}
          value={y}
          onChange={(e) => setY(parseFloat(e.target.value))}
          style={{ width: "100%", marginTop: 4 }}
        />
      </label>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.18)", paddingTop: 10, marginBottom: 10 }}>
        <div style={{ opacity: 0.65, marginBottom: 4 }}>CAMERA</div>
        <div>
          pos: [{camInfo.pos[0]}, {camInfo.pos[1]}, {camInfo.pos[2]}]
        </div>
        <div>fov: {camInfo.fov}</div>
      </div>
      <div style={{ opacity: 0.7, fontSize: 10 }}>
        Drag the canvas to rotate camera. Adjust sliders for Mac scale + Y.
        Paste values back to MacintoshScene.tsx when done.
      </div>
    </div>
  );
}
