import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, OrbitControls, Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { SKILL_LOGOS, liveLinkLabel, type MacProject, type SkillLogo } from "./projects";
import { useMacNarrow } from "./useMacNarrow";
import macSpec from "./macSpec.json";
import { clamp01 } from "../math";
import { isTuneMode } from "../tuneMode";
import { DECAY, damp, ease, isCoarsePointer } from "../motion";
import { onScrollJump } from "../scroll";
import { markSectionCanvasCreated } from "../useSectionCanvasMount";

// Visit ?tune=mac to enter a free-camera, slider-driven positioning
// view for re-framing the model.
const TUNE_MODE = isTuneMode("mac");

/**
 * 3D scene for the Macintosh section. Scroll choreography over the pin
 * (Macintosh.tsx pins for 4.0 viewports; motion spec §W4 beat map):
 *
 *   ENTRY   (pin 0.00 → 0.06)
 *     Camera eases in 9.0 → 8.5 (outCubic) so the very first wheel notch
 *     visibly responds.
 *
 *   ORBIT   (pin 0.02 → 0.46)
 *     Mac floats high in empty cool-white space (no floor, no shadow
 *     plate), turning toward the cursor. Tech-stack cards orbit it
 *     through a slow partial revolution (ORBIT_SWEEP = 0.6π, ~0.068°/px
 *     at 900 tall: the owner-approved speed).
 *
 *   LAND    (pin 0.38 → 0.76)
 *     Cards dissolve 0.38 → 0.52 (opacity → 0, scale → 0.4, outward
 *     drift). Parallax/sway settles 0.38 → 0.50. The camera dollies in
 *     0.42 → 0.76 (inOutSine, so it is already moving before the dissolve
 *     ends: no static "limbo pose"). Mac descends + its float tilt unwinds
 *     0.44 → 0.68. CRT boot types in 0.62 → 0.76 (bootEnd = the landed
 *     magnet L in Macintosh.tsx, which also gates the detail zoom).
 *
 *   DWELL   (pin 0.76 → 0.88)
 *     Landed, booted, readable; the tile grid is clickable.
 *
 *   EXIT    (pin 0.88 → 1.00): a one-shot timed double blink as the exit
 *     arms, then a scroll-bound CRT power-off collapse and housing
 *     shrink + fade, so a rest holds the frame and scrolling back reverses
 *     it exactly (see EXIT_* below).
 *
 * Composition mirrors the Keypad scene's framing: the Mac and orbit
 * float in empty space. The wrapper section has cool off-white
 * `var(--bg-page)` underneath; the Canvas is alpha so it composites
 * onto that surface (no in-canvas floor).
 *
 * Pin progress 0..1 is read each frame from `pinProgressRef` (directly on
 * wheel/trackpad, where Lenis already smooths; through one DECAY.follow
 * damp on coarse pointers, where native touch scroll is unsmoothed). State
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
  /**
   * Which on-CRT control the pointer is hovering ("back" | "link"), or null.
   * Set by the DOM hotspots in Macintosh.tsx and threaded to the painter so the
   * hover feedback is drawn ON THE CANVAS — it then barrel-distorts identically
   * with the bulged button and is always perfectly aligned (a flat DOM glow
   * can't track the bulge; that was the "hover elements aren't correctly placed"
   * bug). The hotspots are now invisible hover/click detectors only.
   */
  hoveredControl?: "back" | "link" | null;
}

/** CRT screen face projected to on-screen CSS pixels (canvas-relative). */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Eased detail-zoom progress 0..1. */
  vis: number;
  /** Painted live/dev-post CTA width as a fraction of the screen-face width, so
   *  the DOM link hotspot matches the actual painted button (whose width varies
   *  by label) instead of a fixed fraction that overshoots it. */
  linkWFrac?: number;
}

// Beat map (pin fraction). Moves together with the camera constants below
// (ENTRY_END, DOLLY_*, TILT_UNWIND_*, EXIT_*) and with the landed magnet /
// CTA target in Macintosh.tsx (LANDED_P = bootEnd).
const THRESHOLDS = {
  // Orbit sweep: linear across the window (constant angular velocity).
  orbitStart: 0.02,
  orbitEnd: 0.46,
  // Card dissolve: starts inside the orbit so the cards are already
  // leaving as the dolly begins.
  dissolveStart: 0.38,
  dissolveEnd: 0.52,
  // Mac descent (and the tilt unwind, TILT_UNWIND_*): the landing motion.
  descentStart: 0.44,
  descentEnd: 0.68,
  // Cursor parallax / idle sway damps out so the screen is square to
  // camera before the descent commits.
  spinSettleStart: 0.38,
  spinSettleEnd: 0.5,
  // CRT boot text + desktop tile reveal. bootEnd is the landed pose.
  bootStart: 0.62,
  bootEnd: 0.76,
};
// The float-beat click-to-zoom hitbox (and its hover cursor) is live only
// before the landing commits; after this the on-screen tiles own clicks.
const FLOAT_CLICK_END = 0.44;
// Detail-zoom gate tolerance: the snap/CTA land on integer scroll px, which
// can put p a hair under bootEnd (e.g. 0.75990 at 833px tall). Without the
// slack a tile click would set `selected` but never zoom in.
const CAN_OPEN_EPS = 0.005;

/** Orbit ring target angle for a pin progress (linear across the window). */
function orbitAngleFor(p: number): number {
  return (
    clamp01(
      (p - THRESHOLDS.orbitStart) / (THRESHOLDS.orbitEnd - THRESHOLDS.orbitStart),
    ) * ORBIT_SWEEP
  );
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
// notes that the sweep still felt fast: 2π → 1.2π → 0.8π → now 0.6π
// (108°) over the 4.0vh pin's 0.02 → 0.46 window (1584px at 900 tall),
// i.e. ~0.068°/px, the owner-approved speed of the old 5800px pin. The
// applied rotation follows through a DECAY.soft damp (LogoOrbit) so
// discrete wheel steps glide.
const ORBIT_SWEEP = Math.PI * 0.6;

// CURSOR PARALLAX (float beats). Replaces the old fixed Y-axis sine sway:
// during BEATs 1-2 the Mac TURNS TOWARD the cursor — yaw tracks the
// horizontal cursor position, pitch the vertical — so it reads as the
// object "watching" the pointer (parallax), not idly oscillating on one
// axis. The applied rotation eases toward the target (PARALLAX_RATE) so a
// fast flick glides instead of snapping, and the whole effect is scaled by
// `spinFactor` so it damps to 0 across the settle window (square to camera
// before the descent + CRT boot). Amplitudes are modest so the tipped-up
// screen never turns away from the viewer.
const PARALLAX_YAW = THREE.MathUtils.degToRad(10.8);
const PARALLAX_PITCH = THREE.MathUtils.degToRad(6);
const PARALLAX_RATE = 4.0;

// Uniform up-scale on the whole Mac group (model + screen click planes
// together, so tile hit-testing + the detail-zoom solve stay aligned). A
// "tiny bit bigger" per the user — the landed CRT fills a touch more of
// the frame without overflowing the close dolly framing.
const MAC_GROUP_SCALE = 1.07;

// ── mac.glb screen fit ───────────────────────────────────────────────────────
// The housing is a classic Macintosh generated by scripts/build-mac-model.py
// from macSpec.json, in macGroup-local units with the front face vertical on
// +Z. Both the GLB and the rects below come from the same spec, so the CRT
// picture lands on the glass by construction (MacBody also cross-checks the
// loaded "screen" mesh against MAC_SEAT in dev).
const inch = (v: number) => v * macSpec.scale;
const MAC_FRONT_Z = inch(macSpec.body.d) / 2;
// Glass surface sits behind the recessed bezel panel and the screen well.
const MAC_GLASS_Z =
  MAC_FRONT_Z - inch(macSpec.bezel.depth) - inch(macSpec.glass.recess);
// SEAT = the dark GLASS rect (the OFF-tube backing plane is sized to it).
const MAC_SEAT = {
  cx: macSpec.screenCenterLocal[0]!,
  cy: macSpec.screenCenterLocal[1]!,
  cz: MAC_GLASS_Z + 0.004,
  w: inch(macSpec.glass.w),
  h: inch(macSpec.glass.h),
};
// CRT PICTURE overlay rect — inset from the glass edges (thin black CRT border)
// and a hair in front of the glass so it never z-fights it.
const MAC_SCREEN_RECT = {
  cx: MAC_SEAT.cx,
  cy: MAC_SEAT.cy,
  cz: MAC_GLASS_Z + 0.006,
  w: inch(macSpec.picture.w),
  h: inch(macSpec.picture.h),
};
// The front face is vertical; the overlay sits flat on it.
const MAC_SCREEN_TILT_X = 0;
// The picture's rect in macGroup-local space — the click/back planes + detail
// framing track the PICTURE (not the larger glass) so hotspots line up with it.
const SCREEN_LOCAL_W = MAC_SCREEN_RECT.w;
const SCREEN_LOCAL_PIC_H = MAC_SCREEN_RECT.h;
const SCREEN_LOCAL_PIC_CENTER: [number, number, number] = [
  MAC_SCREEN_RECT.cx,
  MAC_SCREEN_RECT.cy,
  MAC_SCREEN_RECT.cz,
];

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
const TILT_UNWIND_START = THRESHOLDS.descentStart;
const TILT_UNWIND_END = THRESHOLDS.descentEnd;

/* ─────────────────────────────────────────────────────────────────
 * CAMERA DOLLY-IN (wide layout only).
 *
 * Through BEATs 1-2 the camera holds the wide orbit framing
 * (z=DOLLY_Z_WIDE) so the full ~2.95-radius card ring + Mac fit with
 * margin. During BEAT 3 the camera travels IN toward the landed Mac so
 * the CRT face dominates the frame and the project tiles become
 * readable. The dolly window is pin DOLLY_START→DOLLY_END (overlaps the
 * dissolve tail + descent + tilt-unwind + CRT boot) eased inOutSine (its
 * gentler shoulders keep it visibly moving from the first px, so there is
 * no parked "limbo" pose between the dissolve and the push-in), so the zoom
 * feels like one continuous landing motion with the Mac. A short ENTRY cue
 * (z 9.0 → 8.5 over pin 0.00 → 0.06) precedes it so the first notch reads.
 *
 * GEOMETRY (FOV 28 → vertical half-angle 14°, tan≈0.2493):
 *   At the landed state the CRT screen plane (0.72 world tall) sits
 *   centered at world y ≈ REST_Y + 1.0 = 0.8 (ScreenInteractionPlane is at
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
 * tracks scroll 1:1 (Lenis is the smoother). CameraFramer owns the narrow path
 * (no scroll there); this dolly owns the wide path.
 * ──────────────────────────────────────────────────────────────── */
const DOLLY_START = 0.42;
// Zoom-in completes exactly at the landed pose (bootEnd = the magnet L).
const DOLLY_END = THRESHOLDS.bootEnd;
// ENTRY cue: the camera settles from DOLLY_Z_ENTRY to DOLLY_Z_WIDE over the
// first ENTRY_END of the pin (outCubic), so the first wheel notch into the
// pin produces visible change instead of a static float frame.
const ENTRY_END = 0.06;
const DOLLY_Z_ENTRY = 9.0;
// EXIT window: the landed CRT dwells at full size 0.76 → EXIT_START, then
// the exit plays SCROLL-BOUND (no timers) across EXIT_START → EXIT_END, so
// resting mid-exit holds the frame and scrolling back reverses it exactly.
// Sub-beats, as fractions of the exit window (exitT 0..1):
const EXIT_START = 0.88;
const EXIT_END = 1.0;
//   Double blink (two brief picture drop-outs), ARMED at exitT 0.05, just
//   ahead of the collapse at 0.15. Deliberate exception to "no timers": the
//   blink is a one-shot, TIME-based acknowledgement fired when exitT first
//   crosses EXIT_BLINK_ARM going down. Mapping it to scroll (the spec's exitT
//   0.05-0.15 windows, ~11 px each) made it 0-2 frames while scrolling
//   (invisible) and left the screen stuck at the dim level when a rest landed
//   inside a window. A time-based blink always reads, and every rest ends on
//   a lit screen. The collapse and housing fade stay scroll-bound.
//   Re-arms only once exitT drops back below EXIT_BLINK_ARM; dropping below
//   it also cancels a blink in flight.
const EXIT_BLINK_ARM = 0.05;
// [startMs, endMs) picture drop-outs after the arm crossing.
const EXIT_BLINK_PATTERN_MS: ReadonlyArray<readonly [number, number]> = [
  [0, 60],
  [110, 170],
];
const EXIT_BLINK_OPACITY = 0.1;
//   CRT power-off collapse (uPowerOff 0 → 1: hot line → dot → black).
const EXIT_POWER_OFF_START = 0.15;
const EXIT_POWER_OFF_END = 0.55;
//   Housing shrink + fade (ease.inQuad), overlapping the collapse.
//   Starts at 0.30 (spec had 0.45): at the close dolly the screen fills the
//   frame, so even a few % of shrink about the group origin swings the
//   housing a long way on screen. Over 0.45 → 1 (~240 px) the inQuad tail
//   made the vanish the biggest per-px jump on the page; 0.30 → 1 (~300 px)
//   lowers the peak rate ~21% while inQuad still holds the housing near
//   full size through the hot-line phase (~5% vanished at 0.45, ~13% as
//   the CRT reaches its dot at 0.55).
const EXIT_SHRINK_START = 0.3;
// Scale the housing reaches at exitT 1 while its opacity reaches 0: it
// recedes and fades rather than collapsing to a point on top of the CRT's
// own line → dot collapse.
const EXIT_MIN_SCALE = 0.3;
// Wide framing 9.5 → 8.5 so the centered Mac + the widened ~2.95 ring
// fill more of the viewport (less dead margin) while still leaving
// horizontal room for the rightmost card to clear the editorial rail
// (the rail sits high-right, the ring cards ride the vertical center, so
// they don't actually collide (verified). CLOSE held at 2.6 (the
// dolly-in win; tiles must read at land).
const DOLLY_Z_WIDE = 8.5;
const DOLLY_Z_CLOSE = 2.6;
// Framing heights are derived from macSpec so they track the housing: the
// WIDE camera sits level with the middle of the floating housing (so the Mac
// reads dead-centered top-to-bottom; the float tilt pivots near that height,
// so it projects centered too), and CLOSE sits level with the landed screen
// centre. Level camera (Y == lookAt) = straight-on, not looking down.
const MAC_BODY_CENTER_LOCAL_Y =
  macSpec.screenCenterLocal[1]! -
  inch(macSpec.screenCenterFromBottom) +
  inch(macSpec.body.h) / 2;
const DOLLY_Y_WIDE = MAC_HOVER_Y + MAC_BODY_CENTER_LOCAL_Y * MAC_GROUP_SCALE;
// Landed CRT picture centre in world space (group rests at MAC_REST_Y).
const MAC_LANDED_SCREEN_Y = MAC_REST_Y + MAC_SEAT.cy * MAC_GROUP_SCALE;
const DOLLY_Y_CLOSE = MAC_LANDED_SCREEN_Y;
const DOLLY_LOOK_Y_WIDE = DOLLY_Y_WIDE;
const DOLLY_LOOK_Y_CLOSE = DOLLY_Y_CLOSE;
// The skill ring rides a little below the camera line (as it always has) so
// the cards read centred in the frame around the Mac.
const ORBIT_RING_Y = DOLLY_Y_WIDE - 0.13;
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
  /** Screen-bearing object (the GLB clone root for the single-mesh monitor);
   *  consumers read only its live world matrix. */
  mesh: THREE.Object3D;
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
  orbitSnapRef,
  dissolveRef,
}: {
  logos: SkillLogo[];
  orbitAngleRef: React.MutableRefObject<number>;
  /** Set by the Scene on a programmatic CUT jump: the next frame places the
   *  ring at its target instead of damping across the teleport. */
  orbitSnapRef: React.MutableRefObject<boolean>;
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
      // binding rotation 1:1 to scroll. dt-based damp (DECAY.soft, τ≈167ms:
      // same feel at 60 and 120 Hz) so discrete wheel/trackpad steps glide
      // rather than snap (the "smoothen" half of the user note). A cut jump
      // lands on the target in one frame.
      const target = orbitAngleRef.current;
      const g = groupRef.current;
      if (orbitSnapRef.current) {
        orbitSnapRef.current = false;
        g.rotation.y = target;
      } else {
        g.rotation.y = damp(g.rotation.y, target, DECAY.soft, dt);
      }
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
const CARD_ACCENT = "#ff4f00";

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
 * Mac model + CRT screen overlay.
 * ──────────────────────────────────────────────────────────────── */

/**
 * CURVED GLASS shared by the picture overlay and the OFF-tube backing: the
 * unlit phosphor's grey-black floor plus a broad, soft room reflection on the
 * bulged faceplate. Both planes add the SAME term in the SAME glass-space
 * coordinates (g: 0..1 across the glass rect), so the picture's edge never
 * reads as a lighter rectangle sitting inside the black glass, and the dark
 * tube still looks like glass when the picture is off. Values are LINEAR and
 * tiny on purpose: colorspace_fragment's sRGB encode lifts 0.004 to ~12/255.
 */
const CRT_GLASS_GLSL = /* glsl */ `
  vec3 crtGlass(vec2 g) {
    vec2 c = g - 0.5;
    // Unlit P134-ish phosphor: a warm grey, never pure black.
    vec3 floorCol = vec3(0.0032, 0.0029, 0.0025);
    // Broad diffuse reflection of the room in the upper-left of the glass,
    // stretched along the curve. Low-frequency only: a crisp "window"
    // highlight is its own fake tell.
    vec2 rp = c - vec2(-0.18, 0.26);
    float sheen = exp(-dot(rp * vec2(1.6, 2.4), rp * vec2(1.6, 2.4)) * 3.0);
    // A faint lit rim where the faceplate curves back toward the top light.
    float rim = smoothstep(0.30, 0.50, c.y) * (1.0 - smoothstep(0.30, 0.52, abs(c.x)));
    // The glass curves away from the viewer at its edges and reflects less.
    float edge = 1.0 - 0.55 * smoothstep(0.25, 0.62, length(c * vec2(1.0, 1.15)));
    vec3 refl = vec3(0.86, 0.90, 1.0) * (0.0055 * sheen + 0.0022 * rim);
    return (floorCol + refl) * edge;
  }
`;

/**
 * CRT post shader for the screen overlay, modelled on how an amber
 * monochrome tube looks IN PERSON (not filmed): no rolling bar, no crawling
 * stripes. The read comes from
 *   - phosphor HALATION: bright strokes bloom into the glass around them;
 *   - BEAM width tracking brightness: dark areas show the raster's seams,
 *     bright text swells and fills them (the scanlines sit still);
 *   - a soft horizontal beam spot (no pixel-crisp edges) and slight
 *     radial misconvergence toward the corners;
 *   - luminance falling off toward the corners of the tube;
 *   - the curved glass (CRT_GLASS_GLSL) sitting over everything.
 * Doing this in the material (instead of painting into the canvas texture)
 * keeps the UI texture on its repaint-on-change regime. uOpacity replaces
 * MeshBasicMaterial.opacity for the boot power-on ramp. `colorspace_fragment`
 * is mandatory: custom shaders bypass three's output encoding, and without it
 * the screen renders dark/wrong under ColorManagement (see project rule).
 */
function makeCrtScreenMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  const img = map.image as { width?: number; height?: number } | undefined;
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      // 1 / texture size in texels (set by MacBody when the texture changes).
      uTexel: {
        value: new THREE.Vector2(1 / (img?.width || 900), 1 / (img?.height || 640)),
      },
      // Picture rect as a fraction of the glass rect (same centre), mapping
      // the overlay's UVs into the glass space the reflection is defined in.
      uPicInGlass: {
        value: new THREE.Vector2(
          MAC_SCREEN_RECT.w / MAC_SEAT.w,
          MAC_SCREEN_RECT.h / MAC_SEAT.h,
        ),
      },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      // Page-transition glitch intensity 0..1: pulsed by the Scene on
      // project open/close/switch, decaying over ~400ms. Drives the
      // slice-tear / chroma-split / noise burst below.
      uGlitch: { value: 0 },
      // Retro CRT POWER-OFF 0..1: the section-exit "going to sleep" collapse.
      // 0 = on; ramped to 1 by the Scene's time-based shutdown (double-blink
      // handled via uOpacity). 0->0.5 collapses the picture to a hot horizontal
      // line, 0.5->0.86 pinches that line to a centre dot, 0.86->1 fades it out.
      uPowerOff: { value: 0 },
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
      uniform vec2 uTexel;
      uniform vec2 uPicInGlass;
      uniform float uOpacity;
      uniform float uTime;
      uniform float uGlitch;
      uniform float uPowerOff;
      varying vec2 vUv;
      ${CRT_GLASS_GLSL}
      // The painter's tube ground (CRT_BASE #0a0806) in linear: treated as
      // "no phosphor lit" so the raster's black IS the glass floor.
      const vec3 BASE = vec3(0.0030, 0.0024, 0.0018);
      vec3 phos(vec2 p) { return max(texture2D(uMap, p).rgb - BASE, 0.0); }
      vec3 phosB(vec2 p, float bias) { return max(texture2D(uMap, p, bias).rgb - BASE, 0.0); }
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
        // edges pull in. k kept subtle (corner overshoot ~3%) so the DOM
        // click hotspots (positioned on the FLAT rect) stay within a few
        // px of the painted UI.
        vec2 cb = vUv - 0.5;
        float r2 = dot(cb, cb);
        vec2 uv = 0.5 + cb * (1.0 + 0.12 * r2);
        // Raster edge: the beam's scan area ends softly, not on a ruled line.
        vec2 edgeD = abs(uv - 0.5);
        float outside = max(edgeD.x, edgeD.y) - 0.5;
        float bezel = 1.0 - smoothstep(-0.012, 0.004, outside);

        if (uGlitch > 0.001) {
          float row = floor(uv.y * 36.0);
          float h = fract(sin(row * 91.7 + floor(uTime * 24.0) * 7.3) * 43758.5453);
          float tear = (h - 0.5) * 0.20 * uGlitch * step(0.62, h);
          uv.x = fract(uv.x + tear);
          uv.y = fract(uv.y + 0.012 * uGlitch * sin(uTime * 60.0));
        }

        // RETRO CRT POWER-OFF: squeeze the picture into a shrinking lit window —
        // VERTICAL first (-> a hot horizontal line), then HORIZONTAL (-> a centre
        // dot) — compressing the image into it rather than clipping. poWin masks
        // the phosphor outside the window; the flash + fade land at the end.
        float poWin = 1.0;
        if (uPowerOff > 0.0001) {
          float poV = smoothstep(0.0, 0.5, uPowerOff);
          float poH = smoothstep(0.5, 0.86, uPowerOff);
          float bH = mix(0.5, 0.006, poV);
          float bW = mix(0.5, 0.006, poH);
          vec2 c2 = vUv - 0.5;
          poWin = step(abs(c2.y), bH) * step(abs(c2.x), bW);
          uv = 0.5 + vec2(c2.x * (0.5 / bW), c2.y * (0.5 / bH));
        }

        // BEAM SPOT: a soft horizontal gaussian instead of square texels,
        // with each gun landing slightly off toward the corners
        // (misconvergence), widened by the glitch's chroma split.
        vec2 dx = vec2(uTexel.x * 0.85, 0.0);
        vec2 conv = cb * uTexel * 0.6 + vec2(0.006 * uGlitch, 0.0);
        vec3 col;
        col.r = phos(uv + conv).r;
        col.g = phos(uv).g;
        col.b = phos(uv - conv).b;
        col = col * 0.5 + (phos(uv - dx) + phos(uv + dx)) * 0.25;
        if (uGlitch > 0.001) {
          float n = fract(sin(dot(uv + uTime, vec2(12.9898, 78.233))) * 43758.5453);
          col = max(col + (n - 0.5) * 0.35 * uGlitch, 0.0);
        }

        // HALATION: light from bright strokes scatters in the phosphor and
        // the faceplate, haloing text. Two rings of taps on the texture's
        // mip chain (bias keeps it to a handful of cheap, pre-blurred
        // samples): a tight glow and a wide, faint veil.
        vec3 glowN = vec3(0.0);
        vec3 glowW = vec3(0.0);
        for (int i = 0; i < 6; i++) {
          float a = float(i) * 1.0472 + 0.5;
          vec2 o = vec2(cos(a), sin(a));
          glowN += phosB(uv + o * uTexel * 3.5, 1.5);
          glowW += phosB(uv + o.yx * uTexel * 11.0, 3.0);
        }
        vec3 halo = glowN * (0.20 / 6.0) + glowW * (0.07 / 6.0);

        // SCANLINE BEAM: fixed raster (it never crawls). Each line is a
        // gaussian whose width grows with brightness, normalised to keep
        // the line's average light constant, so the dark seams show on
        // dim areas and bright strokes swell to fill them.
        float lines = 220.0;
        float line = uv.y * lines;
        float d = fract(line) - 0.5;
        float lum = max(col.r, max(col.g, col.b));
        float sigma = mix(0.22, 0.50, sqrt(clamp(lum, 0.0, 1.0)));
        float beam = exp(-d * d / (2.0 * sigma * sigma));
        // Mean of the gaussian over its line: sigma*sqrt(2pi)*erf(0.5/(sigma*sqrt2)),
        // erf via the sqrt(1 - exp(-4x^2/pi)) approximation.
        float ex = 0.5 / (sigma * 1.41421);
        float mean = sigma * 2.5066 * sqrt(1.0 - exp(-1.2732 * ex * ex));
        float scan = beam / mean;
        // Anti-alias: fade the raster out where lines shrink toward a pixel
        // (small/tilted float pose, phones) so it never moirés.
        float fw = fwidth(line);
        scan = mix(scan, 1.0, smoothstep(0.22, 0.45, fw));

        // Luminance falls off toward the tube's corners.
        float vig = 1.0 - 0.30 * smoothstep(0.18, 0.62, length(cb * vec2(1.0, 0.9)));

        // Mains ripple: well under 1%, two incommensurate sines.
        float flick = 1.0 + 0.007 * sin(uTime * 47.0) * sin(uTime * 13.7);

        vec3 lit = (col * scan + halo) * vig * flick;
        // Phosphor saturation: the hottest cores run toward white.
        float over = max(lit.r - 0.85, 0.0);
        lit.gb += over * vec2(0.40, 0.22);
        // POWER-OFF: the collapsing line/dot glows HOT as the beam pinches,
        // then the dot fades out to black (the classic CRT sleep).
        lit *= 1.0 + 3.5 * smoothstep(0.0, 0.5, uPowerOff) * (1.0 - smoothstep(0.86, 1.0, uPowerOff));
        lit *= bezel * poWin * (1.0 - smoothstep(0.86, 1.0, uPowerOff));

        // The glass sits over the phosphor; added after the bezel / power-off
        // masks so the reflection never blacks out or flares with the dot.
        vec2 g = 0.5 + (vUv - 0.5) * uPicInGlass;
        gl_FragColor = vec4(lit + crtGlass(g), uOpacity);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    // depthTest TRUE so the orbiting skill cards that swing IN FRONT of the
    // Mac occlude the screen instead of the screen (renderOrder 999) always
    // painting over them as a black rectangle. The overlay sits a hair in
    // front of the black screen mesh (nudged along the face normal), so it
    // still passes the depth test over its own housing. depthWrite stays
    // false (it's the topmost transparent layer).
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** The OFF-tube backing: the same curved glass as the picture's, unlit. */
function makeCrtGlassMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      ${CRT_GLASS_GLSL}
      void main() {
        gl_FragColor = vec4(crtGlass(vUv), 1.0);
        #include <colorspace_fragment>
      }
    `,
    depthWrite: false,
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
  const screenMaskRef = useRef<THREE.Mesh | null>(null);

  // Deep clone so each instance has its own material objects; swapping
  // a material on the cached scene wouldn't render via <primitive>.
  const clone = useMemo(() => scene?.clone(true), [scene]);

  useEffect(() => {
    if (!clone) return;
    // Light the housing (materials are authored flat in the GLB: beige case,
    // lighter bezel, near-black glass) and build the CRT picture overlay at
    // the spec'd screen rect. In dev, cross-check the GLB's "screen" mesh
    // against the spec so a regenerated model can't silently drift.
    clone.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const matSources: THREE.Material[] = Array.isArray(obj.material)
        ? obj.material
        : [obj.material];
      for (const m of matSources) {
        if (m instanceof THREE.MeshStandardMaterial) {
          m.envMapIntensity = m.name === "MacScreen" ? 1.2 : 0.5;
          m.needsUpdate = true;
        }
      }
      if (import.meta.env.DEV && obj.name === "screen") {
        // Placed bounds in clone (model-root) space: the GLB nodes are direct
        // children of the root, so the node's local matrix is the whole chain.
        obj.geometry.computeBoundingBox();
        obj.updateMatrix();
        const bb = obj.geometry.boundingBox!.clone().applyMatrix4(obj.matrix);
        const w = bb.max.x - bb.min.x;
        const h = bb.max.y - bb.min.y;
        const cy = (bb.max.y + bb.min.y) / 2;
        if (
          Math.abs(w - MAC_SEAT.w) > 0.02 ||
          Math.abs(h - MAC_SEAT.h) > 0.02 ||
          Math.abs(cy - MAC_SEAT.cy) > 0.02 ||
          Math.abs(bb.max.z - MAC_GLASS_Z) > 0.02
        ) {
          console.warn(
            "[MacintoshScene] mac.glb screen mesh drifted from macSpec " +
              JSON.stringify({
                mesh: { w, h, cy, frontZ: bb.max.z },
                spec: { w: MAC_SEAT.w, h: MAC_SEAT.h, cy: MAC_SEAT.cy, frontZ: MAC_GLASS_Z },
              }),
          );
        }
      }
    });

    // CRT picture overlay: a plane at the spec'd screen rect, attached to the
    // clone ROOT (the GLB's nodes carry no transforms). The screen faces +Z,
    // which PlaneGeometry already does, so no reorientation. The overlay starts
    // transparent (uOpacity=0) and the parent useFrame ramps it in across the
    // CRT boot window; until then the GLB's own dark glass reads through as
    // the OFF tube.
    const overlayGeo = new THREE.PlaneGeometry(
      MAC_SCREEN_RECT.w,
      MAC_SCREEN_RECT.h,
    );
    const overlayMat = makeCrtScreenMaterial(screenTexture);
    const overlay = new THREE.Mesh(overlayGeo, overlayMat);
    overlay.position.set(MAC_SCREEN_RECT.cx, MAC_SCREEN_RECT.cy, MAC_SCREEN_RECT.cz);
    overlay.rotation.x = MAC_SCREEN_TILT_X;
    overlay.renderOrder = 999;
    clone.add(overlay);
    screenOverlayRef.current = overlay;
    overlayMatRef.current = overlayMat;

    // OFF-SCREEN BACKING: the unlit curved glass behind the picture, sized to
    // the GLASS (same reflection as the picture's, so the two never seam). When the CRT powers off (the picture double-blinks then collapses,
    // going transparent), this reads through as a dark, inert OFF tube instead
    // of the model's pale screen material showing white (owner-flagged).
    // renderOrder 998 keeps it behind the picture (999); depthWrite:false so it
    // never z-fights the glass it sits just in front of.
    const maskMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(MAC_SEAT.w, MAC_SEAT.h),
      makeCrtGlassMaterial(),
    );
    maskMesh.position.set(MAC_SEAT.cx, MAC_SEAT.cy, MAC_SEAT.cz);
    maskMesh.rotation.x = MAC_SCREEN_TILT_X;
    maskMesh.renderOrder = 998;
    clone.add(maskMesh);
    screenMaskRef.current = maskMesh;

    // Publish the screen face geometry (clone-space center + +Z outward normal)
    // so the detail-zoom camera can aim dead-on down the live world normal and
    // the DOM overlay can project the screen's on-screen rect. Consumers derive
    // world values from clone.matrixWorld, so these stay correct through the
    // float spin/tilt and the descent.
    screenInfoRef.current = {
      mesh: clone,
      overlay,
      localCenter: new THREE.Vector3(
        MAC_SCREEN_RECT.cx,
        MAC_SCREEN_RECT.cy,
        MAC_SCREEN_RECT.cz,
      ),
      // Outward normal of the picture plane (PlaneGeometry's +Z rotated by
      // MAC_SCREEN_TILT_X about X) so the detail-zoom aims dead-on.
      localNormal: new THREE.Vector3(
        0,
        -Math.sin(MAC_SCREEN_TILT_X),
        Math.cos(MAC_SCREEN_TILT_X),
      ),
      aspect: MAC_SCREEN_RECT.w / MAC_SCREEN_RECT.h,
      faceH: MAC_SCREEN_RECT.h,
    };

    return () => {
      const o = screenOverlayRef.current;
      if (o && o.parent) {
        o.parent.remove(o);
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
      const mk = screenMaskRef.current;
      if (mk && mk.parent) {
        mk.parent.remove(mk);
        mk.geometry.dispose();
        (mk.material as THREE.Material).dispose();
      }
      screenMaskRef.current = null;
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
    const img = screenTexture.image as { width?: number; height?: number } | undefined;
    if (img?.width && img.height) {
      (mat.uniforms.uTexel!.value as THREE.Vector2).set(1 / img.width, 1 / img.height);
    }
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
    <group ref={groupRef}>
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


/* ─────────────────────────────────────────────────────────────────
 * TUI BOX FRAME. The single move that reads "terminal" instead of
 * "window": the screen content sits inside a drawn box rule with a
 * label knocked into the top edge (Norton-Commander / DOS voice).
 * Drawn as sharp 1px amber rules + short International-Orange L-brackets
 * at the corners (not box-drawing glyphs — those risk font tofu on the
 * tube and won't align to a px grid). `label` is knocked into the top
 * rule top-left, `rightLabel` top-right, both over a ground-coloured gap
 * so the rule reads as interrupted by the tab.
 * ──────────────────────────────────────────────────────────────── */
function drawTuiFrame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { label?: string; rightLabel?: string; labelHot?: boolean } = {},
) {
  ctx.save();
  // Four edges, 1px amber-faint rules, sharp.
  ctx.strokeStyle = CRT_HAIRLINE;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w) - 1, Math.round(h) - 1);
  // Orange L-brackets at the corners — the accent that makes the frame
  // read as a deliberate TUI panel, not a plain box.
  const arm = Math.round(Math.min(w, h) * 0.035) + 8;
  const t = 2;
  ctx.fillStyle = CRT_ACCENT;
  const corners: [number, number, number, number][] = [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ];
  for (const [cx, cy, sx, sy] of corners) {
    ctx.fillRect(sx < 0 ? cx - arm : cx, sy < 0 ? cy - t : cy, arm, t); // horizontal arm
    ctx.fillRect(sx < 0 ? cx - t : cx, sy < 0 ? cy - arm : cy, t, arm); // vertical arm
  }
  // Label notch knocked into the TOP rule (left), over a ground gap.
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `19px ${PIXEL_FONT}`;
  if (opts.label) {
    const text = ` ${opts.label} `;
    const lw = ctx.measureText(text).width + 14;
    const lx = x + arm + 12;
    ctx.fillStyle = CRT_BASE;
    ctx.fillRect(lx, y - 1, lw, 3); // erase the rule under the tab
    ctx.fillStyle = opts.labelHot ? CRT_ACCENT : CRT_TEXT;
    ctx.fillText(text, lx + 6, y + 1);
  }
  if (opts.rightLabel) {
    ctx.textAlign = "right";
    const text = ` ${opts.rightLabel} `;
    const lw = ctx.measureText(text).width + 14;
    const rx = x + w - arm - 12;
    ctx.fillStyle = CRT_BASE;
    ctx.fillRect(rx - lw, y - 1, lw, 3);
    ctx.fillStyle = CRT_TEXT_DIM;
    ctx.fillText(text, rx - 6, y + 1);
  }
  ctx.restore();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

/* Cover-fit a project's COLOUR thumbnail into a dest rect (centre-cropped).
 * The owner asked for colour thumbnails back (the amber 1-bit dither was
 * dropped); the screen's CRT shader still lays scanlines + bulge over them, so
 * the real artwork reads as a colour tube, not a flat pasted photo. Returns
 * false until the source image has decoded so the caller can paint a fallback. */
function drawProjectThumbCover(
  ctx: CanvasRenderingContext2D,
  src: string,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): boolean {
  const img = getProjectImage(src);
  if (!imageReady(img)) return false;
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
  return true;
}

/* ─────────────────────────────────────────────────────────────────
 * CRT canvas painter: boot log + project DIRECTORY listing. Amber
 * phosphor TUI; the screen lights up later in the pin window because
 * the boot window is THRESHOLDS.bootStart→bootEnd (0.62→0.76).
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
  // ASCII sphere screensaver instead of the boot/desktop UI. The sphere's
  // per-frame animation is NOT driven from here: Scene's frame loop repaints
  // it straight into this same canvas (paintFloatSphere), change-only, so the
  // spin never re-renders React. This hook only paints it when it (re)renders.
  floatActive: boolean,
  // Block-cursor blink phase (toggled ~1.9Hz in the Scene tick). Threaded into
  // the boot/desktop/detail painters so the terminal caret pulses on otherwise
  // static screens; the repaint cost is one extra texture upload per flip.
  cursorOn: boolean,
  // Which detail control the pointer is over ("back"|"link"|null) — painted as
  // an on-canvas hover state so it aligns with the bulged button.
  hovered: "back" | "link" | null,
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
    drawProjectDetail(ctx, w, h, selected, detailReveal, cursorOn, hovered);
  } else if (floatActive) {
    drawAsciiSphere(ctx, w, h, performance.now() / 1000, true);
  } else {
    drawScreen(ctx, w, h, projects, bootProgress, hoverIndex, cursorOn);
  }
  // Any other painter invalidates the sphere's change-only signature, so the
  // frame loop's next sphere paint always lands.
  if (!floatActive || (selected && detailReveal > 0.04)) sphereSig.delete(ctx);
  // `imageVersion` is referenced so a late thumbnail decode forces a repaint.
  void imageVersion;
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

// CRT screen palette — AMBER-PHOSPHOR TERMINAL (not a modern dark-mode window).
// The old palette built hierarchy with HUE (cool-white #eef2f7 text on cool
// near-black #0a0c10 + an orange garnish) — which is exactly what made it read
// as a generic dark-mode OS. A real amber/orange phosphor tube is MONOCHROME:
// every lit pixel is the same warm hue, and hierarchy comes from INTENSITY
// (brightness), never a second colour. So: one warm-black ground, one orange
// family in 4 brightness stops, the saturated #ff4f00 as the accent, and a warm
// phosphor-white reserved ONLY for the multi-sentence blurb (recruiter
// legibility — pure orange body over 340 chars on a scanline tube fatigues).
const CRT_BASE = "#0a0806"; // warm near-black tube ground (was cool #0a0c10)
const CRT_BAR = "#15100a"; // faintly-lifted frame / header fill
const CRT_TEXT = "#ff8f44"; // PRIMARY amber phosphor: row names, system text
const CRT_TEXT_DIM = "#b8631f"; // dim phosphor: meta, breadcrumb base, labels
const CRT_HAIRLINE = "rgba(255, 96, 30, 0.20)"; // amber frame rules / dividers
const CRT_HOT = "#ffd6a0"; // hottest phosphor: selected row, cursor, hot edges
const CRT_ACCENT = "#ff4f00"; // saturated International Orange: fills, rules, CTA
const CRT_ACCENT_INK = "#0a0806"; // ink knocked out of an accent fill
const CRT_PAPER = "#f4e6d0"; // warm phosphor-white: the blurb paragraph ONLY
const CRT_PAPER_DIM = "rgba(244, 230, 208, 0.62)"; // wrapped-blurb tail

// Shared layout fractions (of the canvas w/h) for the controls the DOM
// overlay must align to. Kept as fractions so the DOM hotspots track the
// painted controls regardless of the screen face aspect. titleBarH is the
// slim window-chrome strip; close box sits inside it top-left; the live
// button sits in the lower-left of the content panel.
const CRT_LAYOUT = {
  titleBarFrac: 0.135, // title bar height as a fraction of canvas height
  padFrac: 0.06, // content inset as a fraction of canvas WIDTH
  backWFrac: 0.16, // "← BACK" button width as a fraction of canvas WIDTH
  backHFrac: 0.56, // "← BACK" button height as a fraction of the TITLE BAR
} as const;

// Painted CTA width as a fraction of the canvas width, written by
// drawProjectDetail and reported via ScreenRect.linkWFrac so the DOM link
// hotspot matches the painted button (its width varies by label; a fixed
// fraction overshot it — the empty lit box right of the button the owner flagged).
let DETAIL_CTA_WFRAC = 0;

function drawProjectDetail(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  project: MacProject,
  reveal: number,
  cursorOn: boolean,
  hovered: "back" | "link" | null,
) {
  const r = clamp01(reveal);
  const PAD = Math.round(w * CRT_LAYOUT.padFrac);
  const barH = Math.round(h * CRT_LAYOUT.titleBarFrac);

  // ── Ground ───────────────────────────────────────────────────────
  ctx.fillStyle = CRT_BASE;
  ctx.fillRect(0, 0, w, h);

  // ── Title bar (top strip, ABOVE the framed body) ─────────────────
  // Carries the BACK control + the breadcrumb. Kept as a strip at the
  // exact CRT_LAYOUT geometry so the DOM hotspots in Macintosh.tsx stay
  // aligned to the painted BACK button.
  ctx.fillStyle = CRT_BAR;
  ctx.fillRect(0, 0, w, barH);
  ctx.strokeStyle = CRT_HAIRLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, barH + 0.5);
  ctx.lineTo(w, barH + 0.5);
  ctx.stroke();

  // BACK control: bordered amber key. The DOM hotspot sits over it (same
  // CRT_LAYOUT fractions) but is INVISIBLE — the hover feedback is painted HERE
  // on the canvas so it barrel-distorts with the button and stays aligned (a
  // flat DOM glow drifted off the bulged button).
  const backW = Math.round(w * CRT_LAYOUT.backWFrac);
  const backH = Math.round(barH * CRT_LAYOUT.backHFrac);
  const backX = PAD;
  const backY = Math.round((barH - backH) / 2);
  const backHot = hovered === "back";
  if (backHot) {
    // Hover: fill the key with a faint orange wash so it reads as lit.
    ctx.fillStyle = "rgba(255, 79, 0, 0.22)";
    ctx.fillRect(backX, backY, backW, backH);
  }
  ctx.save();
  ctx.shadowColor = backHot ? "rgba(255, 79, 0, 0.6)" : "rgba(255, 79, 0, 0.35)";
  ctx.shadowBlur = backHot ? 9 : 5;
  ctx.strokeStyle = CRT_ACCENT;
  ctx.lineWidth = backHot ? 2 : 1.5;
  ctx.strokeRect(backX + 0.75, backY + 0.75, backW - 1.5, backH - 1.5);
  ctx.restore();
  ctx.fillStyle = backHot ? CRT_HOT : CRT_ACCENT;
  ctx.font = `17px ${PIXEL_FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  drawTracked(ctx, "< BACK", backX + 15, barH / 2 + 1, 2);

  // Breadcrumb: a unix path. Base dim, the open project id glows orange
  // like a live phosphor target, with a blinking caret trailing it.
  const crumbX = backX + backW + 18;
  ctx.font = `16px ${PIXEL_FONT}`;
  ctx.fillStyle = CRT_TEXT_DIM;
  const crumbBase = "~/projects/";
  ctx.fillText(crumbBase, crumbX, barH / 2 + 1);
  const crumbBaseW = ctx.measureText(crumbBase).width;
  ctx.save();
  ctx.shadowColor = "rgba(255, 79, 0, 0.6)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = CRT_ACCENT;
  ctx.fillText(project.id, crumbX + crumbBaseW, barH / 2 + 1);
  ctx.restore();
  if (cursorOn) {
    const idW = ctx.measureText(project.id).width;
    ctx.fillStyle = CRT_HOT;
    ctx.fillRect(crumbX + crumbBaseW + idW + 5, barH / 2 - 8, 9, 16);
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // ── TUI frame around the record body ─────────────────────────────
  const frameX = Math.round(w * 0.035);
  const frameTop = barH + Math.round(h * 0.03);
  const frameW = w - frameX * 2;
  const frameH = h - frameTop - Math.round(h * 0.04);
  drawTuiFrame(ctx, frameX, frameTop, frameW, frameH, {
    label: `${project.id}.rec`,
  });

  // Reveal windows (unchanged): header/title in first (0→0.35), body types
  // in after (0.3→0.85, completing before the dolly settles).
  const headReveal = clamp01(r / 0.35);
  const bodyReveal = clamp01((r - 0.3) / 0.55);

  // Content insets. Content left == PAD (so the painted title/blurb/CTA all
  // share the CTA's DOM-hotspot left edge); the frame sits a touch outside it.
  const cX = PAD;
  const hasImage =
    !!project.image && imageReady(getProjectImage(project.image));
  const colGap = Math.round(w * 0.04);
  const imgW = hasImage ? Math.round(w * 0.27) : 0;
  const imgRight = frameX + frameW - Math.round(w * 0.025);
  const imgX = imgRight - imgW;
  const textRight = hasImage ? imgX - colGap : imgRight;
  const textMaxW = textRight - cX;

  let y = frameTop + Math.round(h * 0.06);

  // Meta line: dim, tracked system info.
  ctx.globalAlpha = headReveal;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = CRT_TEXT_DIM;
  ctx.font = `15px ${PIXEL_FONT}`;
  drawTracked(ctx, ensureUppercase(project.meta), cX, y, 1.5);
  y += Math.round(h * 0.05);

  // Title: the HERO. Bright amber-orange (NOT white) with a warm two-pass
  // phosphor bloom so the headline reads as the hottest orange on the tube.
  let titleSize = Math.round(h * 0.07);
  ctx.font = `${titleSize}px ${PIXEL_FONT}`;
  const maxTitleW = textMaxW;
  while (ctx.measureText(project.title).width > maxTitleW && titleSize > 22) {
    titleSize -= 2;
    ctx.font = `${titleSize}px ${PIXEL_FONT}`;
  }
  ctx.save();
  ctx.fillStyle = "#ff8a3d";
  ctx.shadowColor = "rgba(255, 79, 0, 0.5)";
  ctx.shadowBlur = Math.round(titleSize * 0.7);
  ctx.fillText(project.title, cX, y);
  ctx.shadowColor = "rgba(255, 210, 170, 0.5)";
  ctx.shadowBlur = Math.round(titleSize * 0.32);
  ctx.fillText(project.title, cX, y);
  ctx.restore();
  const titleW = Math.min(ctx.measureText(project.title).width, maxTitleW);
  y += Math.round(titleSize * 0.5);

  // Accent rule under the title, full title-width, with orange glow.
  ctx.save();
  ctx.shadowColor = CRT_ACCENT;
  ctx.shadowBlur = 14;
  ctx.fillStyle = CRT_ACCENT;
  ctx.fillRect(cX, y, Math.round(titleW), 4);
  ctx.restore();
  y += 4;
  ctx.globalAlpha = 1;

  // ── Thumbnail (right column): amber ordered-dither + orange corner ticks ──
  if (hasImage) {
    const imgH = Math.round(imgW * (537 / 806));
    const panelTop = frameTop + Math.round(h * 0.06);
    const panelBottom = frameTop + frameH - Math.round(h * 0.05);
    const imgTop = Math.round(panelTop + (panelBottom - panelTop - imgH) / 2);
    ctx.globalAlpha = headReveal;
    const drew = drawProjectThumbCover(ctx, project.image!, imgX, imgTop, imgW, imgH);
    if (!drew) {
      ctx.fillStyle = CRT_BAR;
      ctx.fillRect(imgX, imgTop, imgW, imgH);
    }
    ctx.strokeStyle = CRT_HAIRLINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(imgX + 0.5, imgTop + 0.5, imgW - 1, imgH - 1);
    // Orange L-ticks at the corners — frames it as part of the TUI, not a card.
    ctx.fillStyle = CRT_ACCENT;
    const tk = 14;
    const ticks: [number, number, number, number][] = [
      [imgX, imgTop, 1, 1],
      [imgX + imgW, imgTop, -1, 1],
      [imgX, imgTop + imgH, 1, -1],
      [imgX + imgW, imgTop + imgH, -1, -1],
    ];
    for (const [px, py, sx, sy] of ticks) {
      ctx.fillRect(sx < 0 ? px - tk : px, sy < 0 ? py - 2 : py, tk, 2);
      ctx.fillRect(sx < 0 ? px - 2 : px, sy < 0 ? py - tk : py, 2, tk);
    }
    ctx.globalAlpha = 1;
  }

  // ── Footer geometry (CTA) — kept on the prior formula so the DOM hotspot
  // overlay stays aligned to the painted button. ──
  const btnH = Math.round(h * 0.085);
  const btnY = h - PAD - btnH;
  const hasLink = !!(project.liveHref || project.repoHref);

  // Pre-measure the tags as bracket tokens "[ TAG ]" into up to TWO rows.
  const tagFont = `15px ${PIXEL_FONT}`;
  const rowH = Math.round(h * 0.042);
  const tagGapX = 12;
  const tagGapY = 8;
  ctx.font = tagFont;
  type Tok = { label: string; openW: number; labW: number; tw: number };
  const tagRows: Tok[][] = [];
  if (project.tags.length > 0) {
    let rowArr: Tok[] = [];
    let rowW = 0;
    for (const tag of project.tags) {
      const label = ensureUppercase(tag);
      const openW = ctx.measureText("[ ").width;
      const labW = ctx.measureText(label).width;
      const tw = Math.round(openW + labW + ctx.measureText(" ]").width);
      if (rowArr.length && rowW + tw > textMaxW) {
        tagRows.push(rowArr);
        rowArr = [];
        rowW = 0;
        if (tagRows.length >= 2) break;
      }
      rowArr.push({ label, openW, labW, tw });
      rowW += tw + tagGapX;
    }
    if (rowArr.length && tagRows.length < 2) tagRows.push(rowArr);
  }
  const numTagRows = tagRows.length;
  const tagBlockBottom = btnY - Math.round(h * 0.035);
  const tagBlockH =
    numTagRows > 0 ? numTagRows * rowH + (numTagRows - 1) * tagGapY : 0;
  const tagBlockTop = tagBlockBottom - tagBlockH;

  // ── Blurb (wrapped, typed-in): Geist, WARM phosphor-white for reading ──
  ctx.globalAlpha = bodyReveal;
  ctx.fillStyle = CRT_PAPER;
  ctx.textBaseline = "top";
  const by0 = y + Math.round(h * 0.022);
  const blurbBottom = (numTagRows > 0 ? tagBlockTop : btnY) - 12;
  const availH = Math.max(0, blurbBottom - by0);

  let bodySize = Math.round(h * 0.027); // ~17px @640
  const minBodySize = Math.max(13, Math.round(h * 0.0185));
  let lineH = Math.round(bodySize * 1.5);
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
  const blockH = Math.min(availH, blurbLines.length * lineH);
  let by = by0 + Math.max(0, Math.round((availH - blockH) / 2));
  const blockBottom = by + blockH;
  // A dim left gutter bar makes the blurb read as quoted record output.
  if (bodyReveal > 0.02 && blockH > 0) {
    ctx.fillStyle = CRT_HAIRLINE;
    ctx.fillRect(cX - 14, by, 2, blockH);
    ctx.fillStyle = CRT_PAPER;
  }
  for (let li = 0; li < blurbLines.length; li++) {
    const line = blurbLines[li]!;
    if (by + lineH > blockBottom + 1) break;
    const remain = charsToShow - shown;
    if (remain <= 0) break;
    ctx.fillStyle = li === blurbLines.length - 1 ? CRT_PAPER_DIM : CRT_PAPER;
    ctx.fillText(line.slice(0, Math.max(0, remain)), cX, by);
    shown += line.length + 1;
    by += lineH;
  }
  ctx.globalAlpha = 1;

  // ── Tags: bracket tokens "[ TAG ]" — brackets orange, label dim ──
  if (r > 0.55 && numTagRows > 0) {
    ctx.globalAlpha = clamp01((r - 0.55) / 0.35);
    ctx.font = tagFont;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    for (let ri = 0; ri < numTagRows; ri++) {
      const rowArr = tagRows[ri]!;
      const cy = tagBlockTop + ri * (rowH + tagGapY) + rowH / 2;
      let tx = cX;
      for (const tok of rowArr) {
        ctx.fillStyle = CRT_ACCENT;
        ctx.fillText("[ ", tx, cy);
        ctx.fillStyle = CRT_TEXT_DIM;
        ctx.fillText(tok.label, tx + tok.openW, cy);
        ctx.fillStyle = CRT_ACCENT;
        ctx.fillText(" ]", tx + tok.openW + tok.labW, cy);
        tx += tok.tw + tagGapX;
      }
    }
    ctx.globalAlpha = 1;
    ctx.textBaseline = "alphabetic";
  }

  // ── CTA: flat orange key, ink label (uppercase), SHARP, orange bloom ──
  // Geometry (bx, btnY, btnH) is the DOM-hotspot contract — do not move it.
  if (hasLink) {
    const raw = project.liveHref ? liveLinkLabel(project.liveHref) : "Source";
    const label = ensureUppercase(raw);
    ctx.font = `19px ${PIXEL_FONT}`;
    ctx.textBaseline = "middle";
    const arrow = "  →";
    const btnW = Math.round(ctx.measureText(label + arrow).width + 40);
    DETAIL_CTA_WFRAC = btnW / w;
    const bx = PAD;
    const linkHot = hovered === "link";
    ctx.save();
    ctx.shadowColor = CRT_ACCENT;
    ctx.shadowBlur = linkHot ? 26 : 16;
    // Hover: the fill stays true International Orange (CRT_ACCENT) — the old
    // lighter #ff7a2e read as an off-brand orange. The hover cue is the wider
    // bloom above (shadowBlur 26 vs 16) — painted on the canvas so it distorts
    // with the bulge and stays aligned to the button (the DOM hotspot is
    // invisible, hover/click only).
    ctx.fillStyle = CRT_ACCENT;
    ctx.fillRect(bx, btnY, btnW, btnH);
    ctx.restore();
    ctx.fillStyle = CRT_ACCENT_INK;
    ctx.textAlign = "left";
    ctx.fillText(label + arrow, bx + 20, btnY + btnH / 2 + 1);
    ctx.textBaseline = "alphabetic";
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
 * FLOAT-BEAT SCREENSAVER: a spinning ASCII ICOSAHEDRON ("hydron")
 * painted onto the CRT while the Mac floats (BEATs 1-2), in the hero's
 * monotone orange-on-dark ASCII voice. A tiny software rasterizer
 * FLAT-SHADES each of the 20 triangular faces by its own (rotated) face
 * normal · light, z-buffered per character cell — so each facet catches
 * a distinct, changing brightness as it tumbles (a smooth sphere's
 * normal is rotationally symmetric, so its lighting never changed and
 * the spin was invisible). Repainted from Scene's frame loop (uncapped,
 * owner 2026-10-05 "uncap the fps") but CHANGE-ONLY: the char/colour grid
 * is compared with the last one painted into this context and the canvas
 * (plus its GPU re-upload) is touched only when a cell actually changed.
 * Seam overhaul 2026-10-06: since f7b1947 the spin bumped a React state
 * every frame, re-rendering the whole Scene and re-uploading the CRT
 * texture; the orbit now pre-rolls under the rising Projects sheet while
 * the hero tears down, so that churn landed on the busiest frames. `t` is
 * sampled from the clock at paint time so the spin is smooth regardless
 * of tick jitter. The CRT overlay shader (scanlines/roll/vignette) rides
 * on top, so it reads as a live tube running a demo.
 * ──────────────────────────────────────────────────────────────── */
const ASCII_SPHERE_RAMP = ".,-~:;=!*$#@";
// Unit icosahedron: 12 vertices (golden-ratio rectangles) + 20 faces.
const _ICO_PHI = (1 + Math.sqrt(5)) / 2;
const ICO_VERTS: [number, number, number][] = (
  [
    [-1, _ICO_PHI, 0], [1, _ICO_PHI, 0], [-1, -_ICO_PHI, 0], [1, -_ICO_PHI, 0],
    [0, -1, _ICO_PHI], [0, 1, _ICO_PHI], [0, -1, -_ICO_PHI], [0, 1, -_ICO_PHI],
    [_ICO_PHI, 0, -1], [_ICO_PHI, 0, 1], [-_ICO_PHI, 0, -1], [-_ICO_PHI, 0, 1],
  ] as [number, number, number][]
).map(([x, y, z]) => {
  const inv = 1 / Math.hypot(x, y, z);
  return [x * inv, y * inv, z * inv] as [number, number, number];
});
const ICO_FACES: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];
// Last painted grid per context: cell code = 0 (empty) or
// (ramp index + 1) << 16 | green << 8 | blue. Deleted by any other painter.
const sphereSig = new WeakMap<CanvasRenderingContext2D, Int32Array>();
/** Paint the screensaver at time t; returns false (and touches nothing) when
 *  the grid is identical to the last one painted, unless `force`. */
function drawAsciiSphere(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  force = false,
): boolean {
  // Character cell metrics (VT323 is narrow — advance ≈ 0.46em).
  const fontPx = Math.max(20, Math.round(h * 0.05));
  const cellW = fontPx * 0.46;
  const cellH = fontPx * 0.92;
  const cols = Math.max(1, Math.floor(w / cellW));
  const rows = Math.max(1, Math.floor(h / cellH));
  const N = cols * rows;
  const lum = new Float32Array(N).fill(-2); // <-1 ⇒ empty cell
  const zb = new Float32Array(N).fill(-1e9); // depth: larger ⇒ nearer

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

  // Circumradius in PIXELS (equal on both axes ⇒ undistorted even though
  // cells aren't square). Sized to read as clearly-CENTERED screen content
  // (~60% of the screen height) rather than a small stray blob lost in the
  // black — a centered small sphere read as "off the screen" (owner-flagged).
  const Rpx = Math.min(w, h) * 0.3;
  const cxPx = w / 2;
  const cyPx = h / 2;

  // Rotate every vertex once; cache rotated coords (for normals) + its
  // projection to cell space (cx in columns, cy in rows, depth).
  const rv: [number, number, number][] = ICO_VERTS.map(([x, y, z]) => {
    const x1 = x * cB + z * sB;
    const z1 = -x * sB + z * cB;
    const y2 = y * cA - z1 * sA;
    const z2 = y * sA + z1 * cA; // larger ⇒ nearer camera
    return [x1, y2, z2];
  });
  const pj: [number, number, number][] = rv.map(([x, y, z]) => [
    (cxPx + x * Rpx) / cellW,
    (cyPx - y * Rpx) / cellH,
    z,
  ]);

  for (const [ia, ib, ic] of ICO_FACES) {
    const a = rv[ia]!;
    const b = rv[ib]!;
    const c = rv[ic]!;
    // Rotated face normal (cross of two edges).
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    if (nz <= 0) continue; // back-face: occluded by the front faces anyway
    // Flat Lambert term, floored well above black so the WHOLE front
    // hemisphere reads as a full orange disc (not a one-sided lit crescent
    // that looks off-center on the dark tube); the highlight still ramps to
    // near-white so it keeps its 3D tumble.
    const L = Math.max(0.32, nx * Lx + ny * Ly + nz * Lz);

    // Rasterize the triangle in cell space (edge functions + z-buffer).
    const pa = pj[ia]!, pb = pj[ib]!, pc = pj[ic]!;
    const minX = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0])));
    const maxX = Math.min(cols - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0])));
    const minY = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1])));
    const maxY = Math.min(rows - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])));
    const denom =
      (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1]);
    if (Math.abs(denom) < 1e-6) continue;
    for (let yy = minY; yy <= maxY; yy++) {
      for (let xx = minX; xx <= maxX; xx++) {
        const fx = xx + 0.5;
        const fy = yy + 0.5;
        const w0 =
          ((pb[1] - pc[1]) * (fx - pc[0]) + (pc[0] - pb[0]) * (fy - pc[1])) /
          denom;
        const w1 =
          ((pc[1] - pa[1]) * (fx - pc[0]) + (pa[0] - pc[0]) * (fy - pc[1])) /
          denom;
        const w2 = 1 - w0 - w1;
        if (w0 < -0.001 || w1 < -0.001 || w2 < -0.001) continue;
        const depth = w0 * pa[2] + w1 * pb[2] + w2 * pc[2];
        const idx = yy * cols + xx;
        if (depth > zb[idx]!) {
          zb[idx] = depth;
          lum[idx] = L;
        }
      }
    }
  }

  // Quantise to what actually reaches the canvas (glyph + rgb), then bail if
  // nothing changed since the last paint into this context.
  const last = ASCII_SPHERE_RAMP.length - 1;
  const code = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const L = lum[i]!;
    if (L < -1) continue;
    const g = Math.pow(Math.min(1, L), 0.8);
    const k = Math.min(last, Math.round(g * last));
    // Orange phosphor ramp: base = --accent International Orange #ff4f00
    // rgb(255,79,0) (was the off-brand terracotta #e87040 rgb(232,112,64))
    // brightening to a warm near-white at the hot end of the ramp.
    const gg = Math.round(79 + (240 - 79) * g);
    const bb = Math.round(0 + (220 - 0) * g);
    code[i] = ((k + 1) << 16) | (gg << 8) | bb;
  }
  const prev = sphereSig.get(ctx);
  if (!force && prev && prev.length === N) {
    let same = true;
    for (let i = 0; i < N; i++) {
      if (prev[i] !== code[i]) {
        same = false;
        break;
      }
    }
    if (same) return false;
  }
  sphereSig.set(ctx, code);

  ctx.fillStyle = CRT_BASE;
  ctx.fillRect(0, 0, w, h);
  ctx.font = `${fontPx}px ${PIXEL_FONT}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = code[r * cols + c]!;
      if (!v) continue;
      const ch = ASCII_SPHERE_RAMP[(v >> 16) - 1]!;
      ctx.fillStyle = `rgb(255,${(v >> 8) & 255},${v & 255})`;
      ctx.fillText(ch, c * cellW, r * cellH);
    }
  }
  return true;
}

// Directory-listing geometry shared by drawScreen (paint) and
// ScreenInteractionPlane (hit-test) so a click always lands on the record row
// under the cursor. Fractions of the canvas height; v = 1 - uv.y measures DOWN
// from the top. Rows live between these two v lines (header + shell prompt sit
// above LIST_ROWS_TOP, the status line sits below LIST_ROWS_BOTTOM).
const LIST_ROWS_TOP = 0.225;
const LIST_ROWS_BOTTOM = 0.9;

function drawScreen(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  projects: MacProject[],
  bootProgress: number,
  hoverIndex: number | null,
  cursorOn: boolean,
) {
  // AMBER-PHOSPHOR TERMINAL. Warm-black ground; the tube's scanlines /
  // grille / roll / flicker live in the overlay shader (animate per frame
  // without a texture re-upload), so this canvas paints only the content.
  ctx.fillStyle = CRT_BASE;
  ctx.fillRect(0, 0, w, h);

  const showDesktop = bootProgress >= 0.95;
  if (!showDesktop) {
    // BOOT — a believable amber POST log, typed in left-to-right. No
    // apologising voice, no spinning donut (both cut by the owner); the
    // last line (READY.) is the hottest phosphor and carries a block
    // cursor that blinks once it lands.
    const lines = [
      "DANIEL_OS v2.6",
      "MEM 640K OK",
      "MOUNT /projects.dir ... OK",
      `${projects.length} RECORDS LINKED`,
      "READY.",
    ];
    const totalChars = lines.reduce((s, l) => s + l.length, 0);
    const charsToShow = Math.floor(bootProgress * totalChars * 1.25);
    let remaining = charsToShow;
    ctx.font = `30px ${PIXEL_FONT}`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const x = Math.round(w * 0.07);
    let y = Math.round(h * 0.11);
    let caretX = x;
    let caretY = y;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      if (remaining <= 0) break;
      const take = Math.min(line.length, remaining);
      remaining -= take;
      const shown = line.slice(0, take);
      ctx.fillStyle = li === lines.length - 1 ? CRT_HOT : CRT_ACCENT;
      ctx.fillText(shown, x, y);
      caretX = x + ctx.measureText(shown).width;
      caretY = y;
      y += 42;
    }
    // Block cursor trailing the last typed character (blinks via cursorOn).
    if (cursorOn) {
      ctx.fillStyle = CRT_HOT;
      ctx.fillRect(caretX + 5, caretY + 3, 15, 26);
    }
    return;
  }

  // ── DESKTOP = a directory LISTING inside a TUI box frame ────────────
  const frameX = Math.round(w * 0.045);
  const frameY = Math.round(h * 0.05);
  const frameW = w - frameX * 2;
  const frameH = h - frameY * 2;
  drawTuiFrame(ctx, frameX, frameY, frameW, frameH, {
    label: "projects.dir",
    labelHot: true,
    rightLabel: `${projects.length} REC`,
  });

  const inX = frameX + Math.round(w * 0.03);
  const inRight = frameX + frameW - Math.round(w * 0.03);

  // Shell prompt under the top rule — sells the terminal.
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `17px ${PIXEL_FONT}`;
  ctx.fillStyle = CRT_TEXT_DIM;
  const shell = "daniel@os:~$ ls projects.dir";
  const shellY = frameY + Math.round(h * 0.06);
  ctx.fillText(shell, inX, shellY);
  if (cursorOn) {
    const sw = ctx.measureText(shell).width;
    ctx.fillStyle = CRT_HOT;
    ctx.fillRect(inX + sw + 7, shellY - 14, 10, 17);
  }

  // Rows band (kept in lock-step with LIST_ROWS_TOP/BOTTOM for hit-testing).
  const rowsTop = Math.round(h * LIST_ROWS_TOP);
  const rowsBottom = Math.round(h * LIST_ROWS_BOTTOM);
  const n = projects.length;
  const rowGap = Math.round(h * 0.018);
  const rowH = (rowsBottom - rowsTop - rowGap * (n - 1)) / n;
  const dateColW = Math.round(w * 0.13);

  projects.forEach((p, i) => {
    const ry = rowsTop + i * (rowH + rowGap);
    const hovered = hoverIndex === i;

    // Selection: a row wash + a solid orange left bar (the canonical TUI
    // cursor landing), instant — no transition, brutalist.
    if (hovered) {
      ctx.fillStyle = "rgba(255, 79, 0, 0.10)";
      ctx.fillRect(frameX + 2, ry, frameW - 4, rowH);
      ctx.fillStyle = CRT_ACCENT;
      ctx.fillRect(frameX + 2, ry, 4, rowH);
    }

    // Index.
    const indent = hovered ? 12 : 0;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.font = `${Math.round(rowH * 0.32)}px ${PIXEL_FONT}`;
    ctx.fillStyle = hovered ? CRT_ACCENT : CRT_TEXT_DIM;
    const idx = String(i + 1).padStart(2, "0");
    const idxX = inX + indent;
    ctx.fillText(idx, idxX, ry + rowH / 2);
    const idxW = ctx.measureText(idx).width;

    // Amber-dithered thumbnail (1-bit phosphor read of the real artwork).
    const thumbH = Math.round(rowH * 0.74);
    const thumbW = Math.round(thumbH * 1.5);
    const thumbX = idxX + idxW + 18;
    const thumbY = ry + Math.round((rowH - thumbH) / 2);
    const drew = p.image
      ? drawProjectThumbCover(ctx, p.image, thumbX, thumbY, thumbW, thumbH)
      : false;
    if (!drew) {
      ctx.fillStyle = CRT_BAR;
      ctx.fillRect(thumbX, thumbY, thumbW, thumbH);
    }
    ctx.strokeStyle = hovered ? CRT_ACCENT : CRT_HAIRLINE;
    ctx.lineWidth = 1;
    ctx.strokeRect(thumbX + 0.5, thumbY + 0.5, thumbW - 1, thumbH - 1);

    // Date, right-aligned (top of the text block).
    const date = ensureUppercase(p.meta.split(" · ")[0]!);
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.font = `${Math.round(rowH * 0.2)}px ${PIXEL_FONT}`;
    ctx.fillStyle = hovered ? CRT_TEXT : CRT_TEXT_DIM;
    ctx.fillText(date, inRight, ry + rowH * 0.46);

    // Name (auto-shrunk to clear the date column) + stack line below it.
    const tx = thumbX + thumbW + 22;
    const nameMaxW = inRight - dateColW - tx;
    let nameSize = Math.round(rowH * 0.42);
    ctx.font = `${nameSize}px ${PIXEL_FONT}`;
    while (ctx.measureText(p.title).width > nameMaxW && nameSize > 16) {
      nameSize -= 2;
      ctx.font = `${nameSize}px ${PIXEL_FONT}`;
    }
    ctx.textAlign = "left";
    ctx.fillStyle = hovered ? CRT_HOT : CRT_TEXT;
    ctx.fillText(p.title, tx, ry + rowH * 0.46);

    const stackRaw = p.meta.split(" · ")[1] ?? "";
    if (stackRaw) {
      const stackMaxW = inRight - tx - (hovered ? Math.round(w * 0.1) : 0);
      let stackSize = Math.round(rowH * 0.2);
      ctx.font = `${stackSize}px ${PIXEL_FONT}`;
      let stack = ensureUppercase(stackRaw);
      while (ctx.measureText(stack).width > stackMaxW && stackSize > 11) {
        stackSize -= 1;
        ctx.font = `${stackSize}px ${PIXEL_FONT}`;
      }
      ctx.fillStyle = hovered ? CRT_TEXT : CRT_TEXT_DIM;
      ctx.fillText(stack, tx, ry + rowH * 0.78);
    }

    // OPEN affordance on the selected row: flat accent token, lower-right.
    if (hovered) {
      ctx.font = `${Math.round(rowH * 0.2)}px ${PIXEL_FONT}`;
      const openText = "OPEN ↵";
      const ow = ctx.measureText(openText).width + 22;
      const oh = Math.round(rowH * 0.3);
      const ox = inRight - ow;
      const oy = ry + rowH - oh - Math.round(rowH * 0.1);
      ctx.fillStyle = CRT_ACCENT;
      ctx.fillRect(ox, oy, ow, oh);
      ctx.fillStyle = CRT_ACCENT_INK;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(openText, ox + ow / 2, oy + oh / 2 + 1);
    }

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  });

  // Status line knocked into the bottom rule.
  ctx.font = `15px ${PIXEL_FONT}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const statusY = frameY + frameH;
  const status = "SELECT A RECORD   /   ↵ OPEN";
  const statusW = ctx.measureText(status).width + 16;
  ctx.fillStyle = CRT_BASE;
  ctx.fillRect(inX, statusY - 2, statusW, 4);
  ctx.fillStyle = CRT_TEXT_DIM;
  ctx.fillText(status, inX + 6, statusY + 1);
  ctx.textBaseline = "alphabetic";
}

/**
 * Invisible interaction plane over the Mac's CRT screen — the single raycast
 * target for the project TILES. Engages ONLY on the booted grid while no
 * project is open (clickEnabled). Once a project opens the plane goes inert:
 * the on-screen controls (the DOM back-button + link hotspots in Macintosh.tsx)
 * own all interaction, so the detail content is NOT a giant click target and
 * the cursor only turns to a pointer over the real controls (owner: "everything
 * is clickable on this screen for some reason?"). Closing is the BACK button
 * (or ESC), never a click on the body.
 *
 * (A single plane is also what keeps R3F's click deterministic — an earlier
 * design had two coincident handler planes, which made pointerdown/up resolve
 * to different hits and swallowed clicks.)
 */
function ScreenInteractionPlane({
  projects,
  onSelect,
  clickEnabled,
  onHoverChange,
}: {
  projects: MacProject[];
  onSelect: (p: MacProject) => void;
  clickEnabled: boolean;
  onHoverChange: (i: number | null) => void;
}) {
  // Reset the body cursor we may have set: whenever the tile grid goes disabled
  // mid-hover (e.g. showDesktop flips false on scroll-back so onPointerMove
  // early-returns and onPointerOut may never fire), AND on unmount (R3F fires NO
  // pointerOut when the mount-on-approach canvas unmounts, which would otherwise
  // strand the cursor on the next section).
  useEffect(() => {
    if (!clickEnabled) {
      document.body.style.cursor = "";
      onHoverChange(null);
    }
    return () => {
      document.body.style.cursor = "";
    };
  }, [clickEnabled, onHoverChange]);

  // Map a UV hit on the plane to a record-row index (or null above the first
  // row / below the last). Uses the SAME LIST_ROWS_TOP/BOTTOM band the painter
  // lays the rows into (v = 1 - uv.y measures down from the top), so the click
  // target always tracks the row under the cursor. Shared by hover + click.
  const hitTile = (uv: THREE.Vector2 | undefined): number | null => {
    if (!uv) return null;
    const v = 1 - uv.y;
    if (v < LIST_ROWS_TOP || v > LIST_ROWS_BOTTOM) return null;
    const t = (v - LIST_ROWS_TOP) / (LIST_ROWS_BOTTOM - LIST_ROWS_TOP);
    const i = Math.floor(t * projects.length);
    return i >= 0 && i < projects.length ? i : null;
  };

  return (
    <mesh
      position={SCREEN_LOCAL_PIC_CENTER}
      rotation={[MAC_SCREEN_TILT_X, 0, 0]}
      onPointerMove={(e) => {
        // Inert unless the tile grid is live; the detail view's controls are
        // DOM hotspots, so the screen body never sets a pointer cursor.
        if (!clickEnabled) return;
        const i = hitTile(e.uv);
        onHoverChange(i);
        // cursor:pointer only over an actual tile, not the dead gutter/header.
        document.body.style.cursor = i != null ? "pointer" : "";
      }}
      onPointerOut={() => {
        onHoverChange(null);
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        if (!clickEnabled) return;
        const i = hitTile(e.uv);
        if (i != null) onSelect(projects[i]!);
      }}
    >
      <planeGeometry args={[SCREEN_LOCAL_W, SCREEN_LOCAL_PIC_H]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

/** window.__mac, read by the seam acceptance probes (every build; tiny). */
interface MacDebug {
  c: number;
  beat: string;
  canOpen: boolean;
  frames: number;
  commits: number;
  powerOff: number;
  dot: number;
}
function macDebug(): MacDebug {
  const w = window as unknown as { __mac?: MacDebug };
  return (w.__mac ??= { c: 0, beat: "", canOpen: false, frames: 0, commits: 0, powerOff: 0, dot: 1 });
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
  onScreenRect,
  hoveredControl,
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
  // Click-to-zoom hitbox: clickable only while the Mac floats; its visibility
  // (and thus its raycastability) is toggled by pin progress in the useFrame.
  const zoomHitRef = useRef<THREE.Mesh>(null);
  // Effective pin progress the choreography reads. Direct on wheel/trackpad
  // (Lenis is already the one smoother there); on coarse pointers (native,
  // unsmoothed touch scroll) it follows the raw progress through a single
  // DECAY.follow damp. -1 = unseeded (first frame takes the raw value).
  const followPRef = useRef(-1);
  const coarseRef = useRef(isCoarsePointer());
  useEffect(() => {
    const mq = window.matchMedia?.("(pointer: coarse)");
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent) => {
      coarseRef.current = e.matches;
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // Programmatic CUT jump (menu / footer / JumpToTop behind the cover): snap
  // the follower and the orbit ring to the new position in the same frame
  // instead of animating across the teleport. ScrollTrigger.update() runs
  // before the event, so pinProgressRef is already current here.
  const orbitSnapRef = useRef(false);
  // Last opacity written to the canvas element by the exit fade ("" = none),
  // so the per-frame loop only touches the style when the value changes.
  const canvasFadeRef = useRef("");
  // Exit double-blink one-shot: previous frame's exitT (NaN until the first
  // frame, so a reload that lands mid-exit doesn't fire it) and the start
  // time of the blink in flight (-1 = none / armed).
  const prevExitTRef = useRef(Number.NaN);
  const blinkStartRef = useRef(-1);
  // Tilt group sits between the Y-translation group (macGroupRef) and
  // the spin group (macSpinRef). It holds the keypad-style float pose
  // (X/Y/Z euler from MAC_FLOAT_TILT_*) and unwinds to 0 during the
  // descent so the screen faces camera by the time the boot starts.
  const macTiltRef = useRef<THREE.Group>(null);
  const macSpinRef = useRef<THREE.Group>(null);
  // NO ground element: the Mac floats clean in the void (like the Keypad/Hero
  // scenes). Every grounding attempt — shelf, orange pool, dock edge, the
  // directional cast shadow, AND a soft contact-shadow decal — was rejected by
  // the owner (each read as junk / a "plane" on the ground, and the flat decal
  // plane at the base Y clipped into the housing geometry). Clean float it is.
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
  useEffect(
    () =>
      onScrollJump((e) => {
        if (e.phase !== "end" || e.mode !== "cut") return;
        const raw = narrow ? 1 : pinProgressRef.current;
        followPRef.current = raw;
        orbitAngleRef.current = orbitAngleFor(raw);
        orbitSnapRef.current = true;
      }),
    [narrow, pinProgressRef],
  );
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
  // Float-beat screensaver gate (see useScreenTexture). The spin itself is
  // painted from the frame loop below, change-only, with no React state.
  const [floatActive, setFloatActive] = useState(false);
  // Block-cursor blink phase (terminal caret). Toggled ~1.9Hz in the tick
  // block; one extra texture upload per flip on otherwise-static screens.
  const [cursorOn, setCursorOn] = useState(true);
  const lastTickRef = useRef(0);
  // Debug mirror for the seam acceptance probes (window.__mac): `frames`
  // counts frames that passed the visibility gate, `commits` counts Scene
  // React commits (the float spin used to add one per frame).
  const macDbg = useMemo(() => macDebug(), []);
  useEffect(() => {
    macDbg.commits++;
  });
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
    cursorOn,
    selected ? hoveredControl ?? null : null,
  );
  const { invalidate, camera, size, gl } = useThree();

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
    macDbg.frames++;
    // On narrow viewports the section isn't pinned, so the scroll-driven
    // pinProgressRef never advances. Drive the choreography from a fixed
    // landed value (1) so the Mac sits descended, square-on, booted, and
    // clickable. The mobile experience is "the Mac, landed" with no
    // orbit beat. Desktop reads the live scroll progress as before.
    const raw = narrow ? 1 : pinProgressRef.current;
    // Touch-only follower (see followPRef). Everything below reads `p`.
    if (followPRef.current < 0 || narrow || !coarseRef.current) {
      followPRef.current = raw;
    } else {
      followPRef.current = damp(followPRef.current, raw, DECAY.follow, dt);
      if (Math.abs(raw - followPRef.current) < 1e-4) followPRef.current = raw;
    }
    const p = followPRef.current;
    // Click-to-zoom target is live only while the Mac is still floating/orbiting
    // (before it commits to the landing); after that the on-screen tiles own
    // clicks. Invisible meshes don't raycast, so visibility IS the gate.
    if (zoomHitRef.current)
      zoomHitRef.current.visible = !narrow && p < FLOAT_CLICK_END;

    // ── ORBIT ANGLE (drives the LogoOrbit group rotation) ─────────
    // Linear over the orbit window so the angular velocity is constant:
    // reads like real orbital motion, not an ease that "snaps" at the end.
    orbitAngleRef.current = orbitAngleFor(p);

    // ── DISSOLVE (cards fade + drift + scale-down) ────────────────
    const dissolveT = clamp01(
      (p - THRESHOLDS.dissolveStart) /
        (THRESHOLDS.dissolveEnd - THRESHOLDS.dissolveStart),
    );
    dissolveRef.current = easeOutCubic(dissolveT);

    // ── EXIT VANISH ───────────────────────────────────────────────
    // Past the landed-CRT dwell (EXIT_START) the user is scrolling OUT of the
    // section. Rather than let the Mac HARD-CUT at the viewport edge as the
    // pin releases (the reported "computer just gets cut off"), the CRT
    // powers down and the housing recedes and fades, so it VANISHES on the
    // way out instead of clipping, and NOT by "floating back up" (explicitly
    // rejected). All of it is a pure function of scroll (no timers), so a
    // rest mid-exit holds and scrolling back reverses it exactly.
    // Never on narrow (p is pinned at 1 there → would hide the Mac) or while
    // a project detail is open (the user is reading it, not leaving).
    const exitT =
      narrow || selected ? 0 : clamp01((p - EXIT_START) / (EXIT_END - EXIT_START));
    // Housing shrink + fade: ease.inQuad holds near full size early in the
    // window, then accelerates away as the pin releases.
    const exitVanish = ease.inQuad(
      clamp01((exitT - EXIT_SHRINK_START) / (1 - EXIT_SHRINK_START)),
    );
    const exitScale = 1 - (1 - EXIT_MIN_SCALE) * exitVanish;
    // Fade the housing on the canvas element (compositor-only; the orbit
    // cards are long dissolved by now, so the Mac is all it carries). Never
    // on .mac-stage: its opacity transition belongs to data-stage-visible.
    const fade = exitVanish > 0.001 ? (1 - exitVanish).toFixed(3) : "";
    if (fade !== canvasFadeRef.current) {
      canvasFadeRef.current = fade;
      gl.domElement.style.opacity = fade;
    }

    // ── MAC DESCENT ───────────────────────────────────────────────
    const descentT = clamp01(
      (p - THRESHOLDS.descentStart) /
        (THRESHOLDS.descentEnd - THRESHOLDS.descentStart),
    );
    const descent = easeInOutCubic(descentT);
    if (macGroupRef.current) {
      macGroupRef.current.position.y =
        MAC_HOVER_Y + (MAC_REST_Y - MAC_HOVER_Y) * descent;
      // Shrink the whole Mac (model + click planes together) toward nothing
      // on exit; at exitScale 1 this is the inert base scale.
      macGroupRef.current.scale.setScalar(MAC_GROUP_SCALE * exitScale);
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

    // (No ground element — the Mac floats clean; see the note by the refs.)

    // ── CRT BOOT ──────────────────────────────────────────────────
    const newBoot = clamp01(
      (p - THRESHOLDS.bootStart) /
        (THRESHOLDS.bootEnd - THRESHOLDS.bootStart),
    );
    const now = performance.now();
    // Uncapped (owner, 2026-10-05: "uncap the fps"): the mirror block used to
    // step at ~30Hz; it now runs every frame (each setState still bails when
    // its value hasn't moved, so a static screen costs no re-render).
    if (now - lastTickRef.current >= 0) {
      lastTickRef.current = now;
      setBootProgress((prev) => (Math.abs(prev - newBoot) > 0.02 ? newBoot : prev));
      // Float-beat screensaver gate: on before the CRT boot, while no
      // project is open and not on the narrow/landed path.
      const fa = !narrow && !selected && p < THRESHOLDS.bootStart;
      setFloatActive((prev) => (prev === fa ? prev : fa));
      // Terminal caret blink (~1.9Hz): flips cursorOn so the boot/desktop/detail
      // painters pulse their block cursor on otherwise-static screens. Only ticks
      // while the scene is on-screen (this whole loop early-returns off-screen),
      // and never during the float (the screensaver has no caret, so a flip
      // there would only cost a Scene re-render).
      if (!fa) {
        const blink = Math.floor(now / 530) % 2 === 0;
        setCursorOn((prev) => (prev === blink ? prev : blink));
      }
      // Screensaver: every frame (uncapped, owner 2026-10-05), painted straight
      // into the CRT canvas and re-uploaded only when a cell changed. Waits for
      // the render that flips floatActive on (that render paints the first
      // frame and owns the canvas until then).
      if (fa && floatActive) {
        const cv = screenTexture.image as HTMLCanvasElement;
        const sctx = cv.getContext("2d");
        if (sctx && drawAsciiSphere(sctx, cv.width, cv.height, now / 1000)) {
          screenTexture.needsUpdate = true;
        }
      }
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
            linkWFrac: DETAIL_CTA_WFRAC,
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
    const canOpen = narrow || p >= THRESHOLDS.bootEnd - CAN_OPEN_EPS;
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
      const dolly = ease.inOutSine(dollyT);
      // ENTRY cue (outCubic 9.0 → 8.5), then the landing dolly.
      const entry = ease.outCubic(clamp01(p / ENTRY_END));
      const wideZ = DOLLY_Z_ENTRY + (DOLLY_Z_WIDE - DOLLY_Z_ENTRY) * entry;
      const landedZ = wideZ + (DOLLY_Z_CLOSE - wideZ) * dolly;
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
      let detPosY = MAC_LANDED_SCREEN_Y;
      let detPosZ = 1.55;
      let detLookX = 0;
      let detLookY = MAC_LANDED_SCREEN_Y;
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
      // The screen is ON from the very start of the float so the ASCII sphere
      // screensaver is immediately visible (no dark power-on beat), then the
      // overlay carries the boot type-in + desktop. Opacity = max(on, boot
      // ramp) so it's always at full while floating and through boot/desktop.
      const screenOn = 1;
      // RETRO POWER-OFF: a one-shot timed DOUBLE BLINK fired as exitT crosses
      // EXIT_BLINK_ARM going down (see EXIT_BLINK_PATTERN_MS), then the
      // scroll-bound collapse to a hot line -> centre dot -> black (uPowerOff
      // over EXIT_POWER_OFF_START..END). Scrolling back reverses the collapse
      // exactly; the blink only ever dims for its ~170 ms, so no rest can
      // freeze the screen dim.
      const nowMs = performance.now();
      const prevExitT = prevExitTRef.current;
      prevExitTRef.current = exitT;
      if (exitT < EXIT_BLINK_ARM) {
        blinkStartRef.current = -1;
      } else if (prevExitT < EXIT_BLINK_ARM && blinkStartRef.current < 0) {
        blinkStartRef.current = nowMs;
      }
      const blinkT =
        blinkStartRef.current < 0 ? -1 : nowMs - blinkStartRef.current;
      const blinkOff =
        blinkT >= 0 &&
        EXIT_BLINK_PATTERN_MS.some(([a, b]) => blinkT >= a && blinkT < b);
      const targetOpacity = blinkOff
        ? EXIT_BLINK_OPACITY
        : Math.max(screenOn, newBoot);
      const powerOff = clamp01(
        (exitT - EXIT_POWER_OFF_START) /
          (EXIT_POWER_OFF_END - EXIT_POWER_OFF_START),
      );
      if (
        Math.abs((mat.uniforms.uOpacity!.value as number) - targetOpacity) >
        0.001
      ) {
        mat.uniforms.uOpacity!.value = targetOpacity;
      }
      if (
        Math.abs((mat.uniforms.uPowerOff!.value as number) - powerOff) > 0.001
      ) {
        mat.uniforms.uPowerOff!.value = powerOff;
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
      {/* Studio IBL built from Lightformers (NOT a drei preset HDRI — those
          fetch from an external CDN, which corporate firewalls block and this
          site must survive). This baked cubemap is what gives the matte
          housing real soft reflections + roughness response: the single
          biggest change that stops it reading as a flat game-engine box.
          frames={1} renders the env once (static lights + demand loop). */}
      <Environment resolution={256} frames={1} environmentIntensity={0.5}>
        {/* big soft key panel, front-above */}
        <Lightformer
          form="rect"
          intensity={2.4}
          position={[1.5, 3, 3]}
          scale={[8, 5, 1]}
          rotation={[-0.3, 0, 0]}
          color="#ffffff"
        />
        {/* cool fill from the left */}
        <Lightformer
          form="rect"
          intensity={1.0}
          position={[-5, 1.5, 2]}
          scale={[3, 6, 1]}
          color="#eaf1ff"
        />
        {/* brand rim from behind-right — kept subtle + less saturated so it
            ties reflections to the accent WITHOUT washing the cream housing
            yellow (owner: scene read too yellow). */}
        <Lightformer
          form="rect"
          intensity={0.9}
          position={[4, 1.5, -3]}
          scale={[3, 6, 1]}
          color="#ffae86"
        />
        {/* soft ground bounce so undersides aren't dead */}
        <Lightformer
          form="rect"
          intensity={0.5}
          position={[0, -3, 1]}
          scale={[10, 4, 1]}
          rotation={[Math.PI / 2, 0, 0]}
          color="#ffffff"
        />
      </Environment>

      {/* Low ambient — the IBL now provides the soft fill the old 0.55
          ambient was faking. */}
      <ambientLight intensity={0.18} color="#ffffff" />
      {/* Key light — illumination only, NO cast shadow. Its directional cast
          shadow on a plate rendered a hard-edged grey "shadow plane" on the
          cream the owner flagged; grounding is now the soft radial contact
          decal below, so this light just lights the housing. */}
      <directionalLight position={[3, 5, 3]} intensity={1.0} color="#ffffff" />
      {/* Cool fill (kept low — the IBL does most of the fill now). */}
      <directionalLight position={[-3, 2, 2]} intensity={0.25} color="#eef4ff" />
      {/* Warm brand rim: a crisp orange edge separates the housing from the
          cool page and ties to the accent. Intensity dropped (0.55→0.32) so it
          stays a thin edge instead of spilling warm over the whole housing. */}
      <directionalLight position={[-2, 2.5, -4]} intensity={0.32} color="#ff4f00" />

      {/* Click-to-zoom: while the Mac floats, the whole Mac is a click target
          that auto-scrolls into the landed/booted CRT — an OPTION on top of
          normal scrolling so a pointer user can dive straight in without dragging
          through the pin. Invisible (opacity-0) hitbox.
          IMPORTANT: R3F still RAYCASTS an invisible mesh, so `visible=false`
          does NOT gate its events. The handlers must early-return themselves once
          the Mac commits to landing (pin ≥ FLOAT_CLICK_END) or on narrow (no
          float). Without that
          gate the hitbox's onClick + stopPropagation ran on every landed tile
          click and swallowed it before the tile plane (the CRT-tile-click
          regression). */}
      <mesh
        ref={zoomHitRef}
        position={[0, MAC_HOVER_Y, 0]}
        visible={false}
        onClick={(e) => {
          // Landed: the on-screen tiles own clicks — do NOT stopPropagation here.
          if (narrow || pinProgressRef.current >= FLOAT_CLICK_END) return;
          e.stopPropagation();
          document.body.style.cursor = "";
          window.dispatchEvent(new Event("mac-zoom-request"));
        }}
        onPointerOver={() => {
          if (narrow || pinProgressRef.current >= FLOAT_CLICK_END) return;
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <boxGeometry args={[2.8, 2.8, 2.8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

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
        {/* Tile interaction plane. Engages ONLY on the booted grid while no
            project is open; once a project opens it goes inert and the on-screen
            DOM controls (back button + link) own interaction, so the detail body
            is not a click target. */}
        <ScreenInteractionPlane
          projects={projects}
          onSelect={onSelectProject}
          clickEnabled={showDesktop && !selected}
          onHoverChange={setHoverIndex}
        />
      </group>

      {/* Logo orbit: a sibling of the Mac group so the cards orbit
          in WORLD space around the Mac's vertical axis (independent
          of the Mac's self-spin). ORBIT_RING_Y keeps the ring on the
          camera line (a touch below), so it circles the middle of the
          housing, "tools circling the brain", not "around the feet".
          Cards dissolve before the Mac drops so they're gone by the time
          the descent visibly starts. Mobile gets the flat
          TechStackTicker marquee instead; the orbit needs more
          horizontal real estate than a 390px viewport can give without
          cards overlapping the housing. */}
      {!narrow && (
        <group position={[0, ORBIT_RING_Y, 0]}>
          <LogoOrbit
            logos={SKILL_LOGOS}
            orbitAngleRef={orbitAngleRef}
            orbitSnapRef={orbitSnapRef}
            dissolveRef={dissolveRef}
          />
        </group>
      )}

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
    const SCREEN_W = 1.02; // nominal screen width the narrow framing was tuned on
    const TARGET_W_FILL = 0.82; // screen occupies ~82% of viewport width
    // d such that 2·d·halfTan·aspect = SCREEN_W / TARGET_W_FILL
    const zForWidth = SCREEN_W / TARGET_W_FILL / (2 * halfTan * aspect);
    // Clamp: never closer than 3.4 (avoid cropping the housing top on
    // near-square narrow boxes) nor further than 7.0 (avoid shrinking the
    // tiles on ultra-tall slivers). aspect 0.462 (390×844) → z≈5.4.
    const z = THREE.MathUtils.clamp(zForWidth, 3.4, 7.0);
    cam.position.set(0, MAC_LANDED_SCREEN_Y, z);
    cam.lookAt(0, MAC_LANDED_SCREEN_Y, 0);
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
        data-section-canvas=""
        // Initial pose matches the wide FLOAT framing (the per-frame
        // dolly in Scene overwrites this every visible frame, but aligning
        // the initial values avoids a one-frame flash before useFrame
        // runs). Camera at z=DOLLY_Z_WIDE(8.5), level at y=0.58, looking at
        // the composition center (0, 0.58, 0) so the Mac + ring are
        // vertically centered. FOV stays 28; a tighter FOV would crop the
        // wider orbit ring on the sides.
        camera={{ position: [0, DOLLY_Y_WIDE, DOLLY_Z_WIDE], fov: 28, near: 0.1, far: 40 }}
        // DPR cap 1.5 (was 1.25): the housing now carries env reflections +
        // soft shadows, and the boxy silhouette aliases at 1.25; 1.5 cleans
        // the edges. Matches the Hobbies canvas's desktop cap.
        // MOBILE: pin DPR to 1 on narrow (matches the Keypad's mobile DPR
        // discipline). Phone screens are dense (DPR 2-3); rendering the boxy
        // Mac at 1.5x device pixels on a retina phone is a heavy per-frame
        // cost for a small canvas, so the narrow path caps at 1.
        dpr={narrow ? 1 : [1, 1.5]}
        // PERF: demand frame loop; Scene's useFrame calls invalidate()
        // each visible frame to keep the loop running while on-screen,
        // and as soon as visibleRef flips false the loop quiets.
        frameloop="demand"
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          // Slightly under 1.0 so the new IBL reflections don't blow out the
          // housing highlights.
          toneMappingExposure: 0.95,
          powerPreference: "high-performance",
        }}
        onCreated={({ camera, gl, invalidate }) => {
          markSectionCanvasCreated(gl.domElement);
          camera.lookAt(0, DOLLY_LOOK_Y_WIDE, 0);
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
            page bg) while the GLB resolves: the scene mounts on approach
            with mac.glb module-preloaded, so a brief empty stage beats a
            loading placeholder. */}
        <Suspense fallback={null}>
          <Scene {...props} visibleRef={visibleRef} />
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
            target={[0, MAC_LANDED_SCREEN_Y, 0]}
            minDistance={2}
            maxDistance={20}
          />
        )}
      </Canvas>
      {TUNE_MODE && <MacTuneHUD />}
    </div>
  );
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
