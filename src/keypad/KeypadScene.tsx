import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { KeypadModel, type KeypadModelApi } from "./KeypadModel";
import { RiceBlob } from "./RiceBlob";
import {
  RipplePost,
  createPulseChannel,
  stampPulse,
  type PulseChannel,
} from "./RipplePost";
import { useIsMobile } from "../useIsMobile";

// Tuning mode: pass ?tune=keypad in the URL to enable OrbitControls
// + a live values HUD so you can drag the keypad to the orientation
// you want, then copy the values back into CAMERA_POS / BASE_TILT_Y.
const TUNE_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("tune") === "keypad";

/**
 * Dedicated R3F canvas for the keypad section. Lives in its own
 * scene + camera so the room canvas's intro / orbit / postprocessing
 * machinery doesn't have to know about it.
 *
 * Composition:
 *   <RiceBlob/>      cursor-anchored rice fluid backdrop (z=-4)
 *   <group>          base orientation + parallax tilt
 *     <KeypadModel/> the gltf + click/hover/spin logic
 *
 * Parallax:
 *   Desktop: cursor offset from canvas center drives ±8° tilt
 *             around X and Y. Lerped each frame.
 *   Mobile: no cursor; slow auto-rotate around Y at ~1 rev / 40s.
 */

// Camera + model orientation: dialed in via the ?tune=keypad
// playground. Drag the gizmo to tweak; the HUD shows the live values.
// Combined: camera looks down at ~45° from front-left, model tilted
// forward + twisted + slight roll → 3/4 "laying on a desk" view
// with the orange side-buttons visible and dial reading large.
const CAMERA_POS: [number, number, number] = [-0.15, 4.72, 4.73];
const BASE_TILT_X = THREE.MathUtils.degToRad(32.7);
const BASE_TILT_Y = THREE.MathUtils.degToRad(11.1);
const BASE_TILT_Z = THREE.MathUtils.degToRad(-18.2);

// Face-tracking tilt range. Model rotates TOWARD the cursor (head-
// follows-hand), capped at this many degrees on each axis.
const PARALLAX_X = THREE.MathUtils.degToRad(15);
const PARALLAX_Y = THREE.MathUtils.degToRad(15);
const PARALLAX_LERP_RATE = 6;

// Cartoony WOBBLE: pressing the knob jiggles the WHOLE keypad with a
// decaying oscillation on rotation (x + z, slightly out of phase for an
// organic shake) plus a squash-and-stretch scale pulse. Pacing is tuned
// to MATCH the RipplePost shockwave (slow fluid decay, ~1.8s) rather
// than snapping faster than it - low frequency + gentle damping so the
// sway and the ripple settle together. Layered on the tilt/float.
const WOBBLE_DURATION = 2.2; // seconds before the slot frees
const WOBBLE_FREQ = 12; // rad/s (~1.9 Hz, slow fluid sway)
const WOBBLE_DAMP = 2.8; // gentle decay, matched to the shockwave
const WOBBLE_ROT_AMP = THREE.MathUtils.degToRad(7); // peak tilt jiggle
const WOBBLE_SCALE_AMP = 0.05; // peak squash-and-stretch

// prefers-reduced-motion: read once at module load. When set, the idle
// float below is fully disabled (the keypad holds a dead-still pose).
const PREFERS_REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Idle float: once the keypad has LANDED it drifts with a gentle
// vertical bob + a barely-there pitch/roll sway so it reads as
// "suspended in the scene, alive" rather than dead-still. Time-driven
// (a clamped-dt accumulator, never scroll-bound), eased IN by the drop
// progress so it only begins after the landing, and frozen entirely
// under prefers-reduced-motion. Deliberately NO yaw drift: a yaw
// oscillation would read like the auto-spin that was just removed.
// Co-prime-ish periods keep the three axes from beating into lockstep.
const FLOAT_BOB_PERIOD = 5.0; // s per rise+fall cycle (calm float)
const FLOAT_BOB_AMP = 0.12; // world units of vertical travel
const FLOAT_PITCH_PERIOD = 6.7;
const FLOAT_PITCH_AMP = THREE.MathUtils.degToRad(1.8);
const FLOAT_ROLL_PERIOD = 8.3;
const FLOAT_ROLL_AMP = THREE.MathUtils.degToRad(1.3);

// Drop-in effect: model translates from this Y offset (well above
// the visible camera frame) down to 0 as sectionProgress goes 0 → 1.
// Picked empirically. Needs to be larger than the visible frustum
// half-height at the lookAt distance so the model is genuinely
// off-screen at progress=0, not just clipped.
const DROP_HEIGHT = 6;
// Total time the drop-in animation takes, in milliseconds. The drop
// is driven by elapsed time since Keypad.tsx's onEnter ScrollTrigger
// stamped `dropStartTimeRef` (NOT by scroll progress), so the pace
// is identical regardless of how fast the user scrolls into the
// section.
//
// 700ms targets the "slightly faster than scroll rate" feel: at a
// typical user scroll rate of ~1500px/s, the 800px entry distance
// from "section first appears" to "section's top hits viewport top"
// takes ~500ms. A 700ms drop runs a hair slower than that, so the
// keypad is mid-landing as the user scrolls past where it should be
// and finishes landing just as the pin engages. Reads as
// "animated drop in sync with my scroll" rather than "I scroll,
// then it animates" or "I scroll, then it slowly plays out."
// easeOutCubic still applies inside this 700ms so the landing feels
// soft despite the shorter duration.
// The drop ramp is driven from Keypad.tsx via pinProgressRef.

interface CursorState {
  // 0..1 across the canvas (top-left origin to match HTML conventions).
  x: number;
  y: number;
  // Whether cursor is currently over the canvas.
  active: boolean;
}

interface KeypadSceneProps {
  // Pin progress 0..1 driven by Keypad.tsx's GSAP ScrollTrigger pin
  // (scrub:true). 0 = section just engaged the pin; 1 = section is
  // about to release. KeypadScene reads this each frame and drives
  // its drop animation from pin progress 0.00 → 0.30, then settles
  // for the remaining dwell.
  pinProgressRef: React.MutableRefObject<number>;
  /** 0..1 target opacity for the RiceBlob's orange glow layer.
   *  Keypad.tsx ramps this from 0 to 1 once the drop-in animation
   *  has completed, so the orange wash never appears behind an
   *  empty section. */
  glowOpacityRef?: React.MutableRefObject<number>;
}

export function KeypadScene({ pinProgressRef, glowOpacityRef }: KeypadSceneProps) {
  const isMobile = useIsMobile();
  // Cursor target shared with RiceBlob (uniform driver) and with the
  // SceneContents component (parallax driver).
  const cursorRef = useRef<CursorState>({ x: 0.5, y: 0.5, active: false });
  // Canvas-LOCAL cursor (0..1 within the keypad canvas rect) for the RiceBlob.
  // The viewport-relative cursorRef above drifts the rice glow once the section
  // scrolls (the canvas no longer fills the viewport), so the blob is fed this
  // rect-relative one instead, which maps 1:1 onto the screen-aligned plane.
  const riceCursorRef = useRef<CursorState>({ x: 0.5, y: 0.5, active: false });
  const wrapperRef = useRef<HTMLDivElement>(null);
  // PERF: visibility ref so useFrame inside SceneContents can short-
  // circuit while the section is off-screen. The keypad sits at the
  // bottom of the page. For most of the scroll it's not visible and
  // a full WebGL submit per frame is wasted. canvasInvalidateRef
  // pokes the demand loop alive on the visible-edge transition.
  const visibleRef = useRef<boolean>(false);
  const canvasInvalidateRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const next = entry.isIntersecting;
          const was = visibleRef.current;
          visibleRef.current = next;
          if (next && !was && canvasInvalidateRef.current) {
            canvasInvalidateRef.current();
          }
        }
      },
      { rootMargin: "25% 0px 25% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (isMobile) return;
    // Face-tracking math is VIEWPORT-relative (per spec) so the
    // model keeps tracking even when the cursor leaves the keypad
    // canvas; listener lives on document, not the canvas wrapper.
    // The RiceBlob (which IS canvas-local) reads the same ref and
    // uses .active for its on/off.
    const onMove = (e: PointerEvent) => {
      cursorRef.current = {
        x: e.clientX / Math.max(1, window.innerWidth),
        y: e.clientY / Math.max(1, window.innerHeight),
        active: true,
      };
      // Canvas-local for the rice glow: accurate at any scroll position.
      const rect = wrapperRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        riceCursorRef.current = {
          x: (e.clientX - rect.left) / rect.width,
          y: (e.clientY - rect.top) / rect.height,
          active: true,
        };
      }
    };
    const onLeave = () => {
      cursorRef.current = { ...cursorRef.current, active: false };
      riceCursorRef.current = { ...riceCursorRef.current, active: false };
    };
    document.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, [isMobile]);

  // INTERACTION ENERGY (the wow pass): presses radiate a shockwave
  // ring through the rice field, and the pool charges orange while the
  // cursor is over an interactive part. Both flow through the SAME
  // backdrop shader the cursor already lives in, so every effect reads
  // as one system. Pulses are stamped at the live cursor position
  // (viewport UV — the convention the RiceBlob shader already uses).
  const pulsesRef = useRef<PulseChannel>(createPulseChannel());
  useEffect(() => {
    const onInteract = (e: Event) => {
      if (PREFERS_REDUCED_MOTION) return;
      const ev = e as CustomEvent<{ strength?: number }>;
      // Ring-buffer stamp: rapid presses each spawn their OWN ripple
      // (in-flight waves always complete; nothing restarts from the
      // middle on spam clicks). The RipplePost reads this channel and
      // refracts the whole viewport from the press point.
      stampPulse(
        pulsesRef.current,
        ev.detail?.strength ?? 1,
        cursorRef.current.x,
        cursorRef.current.y,
      );
      canvasInvalidateRef.current?.();
    };
    const onHover = () => {
      // Wake the demand render loop on hover changes so the hover feedback (dial
      // scale, cap dip) gets a frame. This previously also set a hotRef, but the
      // RiceBlob rewrite dropped its hotRef/layer props, so nothing reads it now
      // — the wake-poke is the only live purpose left.
      canvasInvalidateRef.current?.();
    };
    window.addEventListener("keypad-interact", onInteract);
    window.addEventListener("keypad-cursor-hover", onHover);
    return () => {
      window.removeEventListener("keypad-interact", onInteract);
      window.removeEventListener("keypad-cursor-hover", onHover);
    };
  }, []);

  // Tune HUD lives outside the Canvas (DOM overlay). Reads camera
  // + model state via a shared ref written each frame by SceneContents.
  const tuneStateRef = useRef<TuneState>({
    pos: new THREE.Vector3(),
    target: new THREE.Vector3(),
    spherical: new THREE.Spherical(),
    modelRot: new THREE.Euler(),
  });
  const [transformMode, setTransformMode] = useState<TuneTransformMode>(
    "rotate",
  );

  // Keyboard shortcuts (Blender-style) for the tune mode. Only
  // active when ?tune=keypad is in the URL.
  useEffect(() => {
    if (!TUNE_MODE) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "r") setTransformMode("rotate");
      else if (e.key === "g" || e.key === "t") setTransformMode("translate");
      else if (e.key === "s") setTransformMode("scale");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div ref={wrapperRef} className="keypad-canvas-wrapper">
      <Canvas
        camera={{ position: CAMERA_POS, fov: 32, near: 0.1, far: 50 }}
        // PERF (mobile): the RiceBlob is a full-screen fragment-heavy
        // shader (per-pixel noise + three glow blobs) that runs every
        // visible frame. Fragment cost scales with the rendered pixel
        // count, so on a 3x-DPR phone even a 1.25 cap means ~1.6x the
        // work of DPR 1. The backdrop is a soft gradient + soft grain,
        // supersampling buys almost no perceptible sharpness there, so
        // pin mobile to DPR 1. Desktop keeps [1, 1.5] for crisp caps.
        dpr={isMobile ? 1 : [1, 1.5]}
        // PERF: demand frame loop. SceneContents.useFrame calls
        // invalidate() while visible, and short-circuits while off-
        // screen so no WebGL submit happens until the user scrolls
        // toward the bottom of the page.
        frameloop="demand"
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
          powerPreference: "high-performance",
        }}
        onCreated={({ gl, invalidate }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.setClearColor(0x000000, 0);
          canvasInvalidateRef.current = invalidate;
        }}
      >
        <SceneContents
          cursorRef={cursorRef}
          riceCursorRef={riceCursorRef}
          isMobile={isMobile}
          pinProgressRef={pinProgressRef}
          glowOpacityRef={glowOpacityRef}
          tuneStateRef={tuneStateRef}
          transformMode={transformMode}
          visibleRef={visibleRef}
          pulsesRef={pulsesRef}
        />
      </Canvas>
      {TUNE_MODE && (
        <TuneHud tuneStateRef={tuneStateRef} transformMode={transformMode} />
      )}
    </div>
  );
}

interface TuneState {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  spherical: THREE.Spherical;
  // Model rotation (rad). Written by SceneContents each frame so the
  // HUD can show it.
  modelRot: THREE.Euler;
}

type TuneTransformMode = "rotate" | "translate" | "scale";

function TuneHud({
  tuneStateRef,
  transformMode,
}: {
  tuneStateRef: React.MutableRefObject<TuneState>;
  transformMode: TuneTransformMode;
}) {
  // Tick state each frame (rAF) to re-render the readout.
  const [, force] = useState(0);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      force((n) => (n + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const s = tuneStateRef.current;
  const fmt = (n: number) => n.toFixed(2);
  const deg = (rad: number) => ((rad * 180) / Math.PI).toFixed(1);
  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        zIndex: 50,
        background: "rgba(20, 20, 20, 0.86)",
        color: "#f3f3f3",
        padding: "14px 18px",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.55,
        borderRadius: 6,
        pointerEvents: "none",
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        minWidth: 320,
      }}
    >
      <div style={{ marginBottom: 6, color: "#ff4f00", letterSpacing: 1 }}>
        KEYPAD ORIENTATION TUNER
      </div>
      <div style={{ marginBottom: 8, opacity: 0.9 }}>
        mode = <b style={{ color: "#ffcc66" }}>{transformMode}</b>
      </div>
      <div style={{ color: "#a4d2ff" }}>camera</div>
      <div>
        &nbsp;pos&nbsp;&nbsp;&nbsp;= [{fmt(s.pos.x)}, {fmt(s.pos.y)},{" "}
        {fmt(s.pos.z)}]
      </div>
      <div>
        &nbsp;spher = r={fmt(s.spherical.radius)} θ={deg(s.spherical.theta)}° φ=
        {deg(s.spherical.phi)}°
      </div>
      <div style={{ marginTop: 8, color: "#a4d2ff" }}>model rotation (deg)</div>
      <div>
        &nbsp;X = {deg(s.modelRot.x)}° &nbsp;Y = {deg(s.modelRot.y)}° &nbsp;Z ={" "}
        {deg(s.modelRot.z)}°
      </div>
      <div style={{ marginTop: 10, fontSize: 11, opacity: 0.7 }}>
        keys: <b>R</b>=rotate &nbsp;<b>T</b>/<b>G</b>=translate &nbsp;
        <b>S</b>=scale
        <br />
        drag gizmo rings to rotate &middot; drag empty = orbit cam &middot;
        right-drag = pan &middot; wheel = zoom
        <br />
        tell Claude the values when happy.
      </div>
    </div>
  );
}

function SceneContents({
  cursorRef,
  riceCursorRef,
  isMobile,
  pinProgressRef,
  glowOpacityRef,
  tuneStateRef,
  transformMode,
  visibleRef,
  pulsesRef,
}: {
  cursorRef: React.MutableRefObject<CursorState>;
  riceCursorRef: React.MutableRefObject<CursorState>;
  isMobile: boolean;
  pinProgressRef: React.MutableRefObject<number>;
  glowOpacityRef?: React.MutableRefObject<number>;
  tuneStateRef: React.MutableRefObject<TuneState>;
  transformMode: TuneTransformMode;
  visibleRef: React.MutableRefObject<boolean>;
  pulsesRef: React.MutableRefObject<PulseChannel>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  // Track the group as REACT STATE too (not just ref) so the
  // TransformControls JSX can re-render once the group has mounted;
  // useRef updates don't trigger renders.
  const [groupNode, setGroupNode] = useState<THREE.Group | null>(null);
  const tiltState = useRef({ x: 0, y: 0 });
  // Drop-in animation state: initialized to DROP_HEIGHT so the
  // model starts off-screen above on first frame, then lerps down
  // as the user scrolls into the section.
  const dropY = useRef(DROP_HEIGHT);
  // Monotonic float clock (clamped-dt accumulator) so the idle bob/sway
  // advances smoothly and never pops when the demand-loop canvas resumes
  // after being scrolled off-screen (a raw clock delta could jump).
  const floatTimeRef = useRef(0);
  // Captured from KeypadModel via onReady callback. Used to fire an
  // automatic dial spin during the drop-in so the knob is mid-rotation
  // when the keypad lands, feels like the device "shakes off" the
  // fall before settling. The dial's existing DIAL_DAMP decay ends
  // the spin naturally over the back half of the drop.
  const kickDialRef = useRef<((v: number) => void) | null>(null);
  const hasAutoSpunRef = useRef(false);
  const hasLandedPulseRef = useRef(false);
  // performance.now() stamp of the last knob press (-1 = idle); drives
  // the whole-keypad cartoony wobble in the frame loop.
  const wobbleStartRef = useRef(-1);
  const { camera, invalidate } = useThree();

  // Knob press -> jiggle the whole device. KeypadModel dispatches
  // "keypad-knob-press" on dial click; gated by reduced motion.
  useEffect(() => {
    const onKnob = () => {
      if (PREFERS_REDUCED_MOTION) return;
      wobbleStartRef.current = performance.now();
      invalidate();
    };
    window.addEventListener("keypad-knob-press", onKnob);
    return () => window.removeEventListener("keypad-knob-press", onKnob);
  }, [invalidate]);
  // Fit is now self-contained inside KeypadModel. It computes its
  // own bounding-sphere-based scale against the camera frustum, so
  // the wrapping group here only handles ORIENTATION (base tilt +
  // parallax), not sizing.

  // Neutral lighting: clean product-shot studio. Mostly white
  // with a hint of warmth on the dial accent so the cat-face icon
  // sits in a soft glow rather than reading as a flat texture.
  // Scheme:
  //   - neutral ambient (paper-white, no tint either direction)
  //   - pure-white KEY from upper-right (casts shadow)
  //   - soft white FILL from lower-left (lifts shadow side)
  //   - barely-warm dial accent (very subtle, sells emissive
  //     without coloring the palette)
  // No cyan, no blue, no magenta, no saturated kickers.
  // REVERTED to the earlier directional scheme (user: the IBL/Environment pass
  // made the keypad "even more dull / flat"). A bright pure-white KEY from the
  // upper-right is what gives the brushed metal + white caps their crisp
  // highlight POP; the soft baked-cubemap fill read evenly lit = lifeless.
  const lightsKey = useMemo(() => new THREE.Vector3(4, 5, 3), []);
  const lightsFill = useMemo(() => new THREE.Vector3(-3.5, -1, -1), []);

  // Keep camera looking at origin (model centroid after recenter).
  useEffect(() => {
    camera.lookAt(0, 0, 0);
  }, [camera]);

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    // PERF: skip per-frame work when off-screen. The keypad section
    // is at the bottom of the page. For most of the scroll lifetime
    // the user isn't anywhere near it, and useFrame was running every
    // tick on a faded canvas.
    if (!TUNE_MODE && visibleRef.current === false) return;
    invalidate();

    // Tune mode: skip drop-in + parallax + auto-rotate. Camera is
    // driven by OrbitControls; model rotation/position is driven by
    // TransformControls (gizmo). DON'T overwrite either in this
    // branch. Write current state into the shared ref so the HUD
    // can display it.
    if (TUNE_MODE) {
      const s = tuneStateRef.current;
      s.pos.copy(camera.position);
      s.target.set(0, 0, 0);
      s.spherical.setFromVector3(camera.position);
      s.modelRot.copy(g.rotation);
      return;
    }

    // Drop-in: model falls from DROP_HEIGHT above the frame to 0
    // (resting) over a FIXED DURATION, regardless of scroll speed.
    // This is the "guided story" pacing: the user can't speed up or
    // slow down the drop by scrolling faster or slower, so the
    // landing always feels deliberate.
    //
    // Driven by `pinProgressRef`, written by Keypad.tsx's GSAP pin
    // (scrub:true). Pin progress 0..1 across the entire pin window;
    // the drop animation uses the first 30% of pin progress so the
    // keypad is landed by the time the user is 1/3 through the pin,
    // leaving the back 70% for the dwell / interact beat.
    //
    // easeOutCubic on the local 0..1 timeline gives a soft landing.
    const pinP = pinProgressRef.current;
    const DROP_PIN_RANGE = 0.30;
    const local = Math.max(0, Math.min(1, pinP / DROP_PIN_RANGE));
    const eased = 1 - Math.pow(1 - local, 3);
    g.position.y = (1 - eased) * DROP_HEIGHT;
    dropY.current = g.position.y;

    // Idle float: gentle bob + sway, faded in by the drop `eased` (so
    // it only starts once landed) and off under reduced motion. Applied
    // to BOTH the touch (static) and desktop (cursor-tracked) paths below
    // so the keypad always feels alive once it has landed. The bob is
    // added to position here; the pitch/roll sway is applied per-path
    // alongside the base/tracked rotation.
    floatTimeRef.current += Math.min(dt, 0.05);
    const ft = floatTimeRef.current;
    const floatGate = PREFERS_REDUCED_MOTION ? 0 : eased;
    const floatPitch =
      Math.sin((ft / FLOAT_PITCH_PERIOD) * Math.PI * 2) *
      FLOAT_PITCH_AMP *
      floatGate;
    const floatRoll =
      Math.sin((ft / FLOAT_ROLL_PERIOD) * Math.PI * 2) *
      FLOAT_ROLL_AMP *
      floatGate;
    g.position.y +=
      Math.sin((ft / FLOAT_BOB_PERIOD) * Math.PI * 2) * FLOAT_BOB_AMP * floatGate;

    // Cartoony knob-press WOBBLE: a fast decaying oscillation layered on
    // top of the rotation (x + z, out of phase) plus a squash-stretch
    // scale pulse. Always applied (set to neutral when idle) so the
    // group scale resets cleanly after the jiggle settles.
    let wobX = 0;
    let wobZ = 0;
    let wobScaleXZ = 1;
    let wobScaleY = 1;
    const wStart = wobbleStartRef.current;
    if (wStart > 0) {
      const age = (performance.now() - wStart) / 1000;
      if (age < WOBBLE_DURATION) {
        const decay = Math.exp(-age * WOBBLE_DAMP);
        wobX = Math.sin(age * WOBBLE_FREQ) * WOBBLE_ROT_AMP * decay;
        wobZ =
          Math.sin(age * WOBBLE_FREQ * 1.27 + 1.1) *
          WOBBLE_ROT_AMP *
          0.85 *
          decay;
        const sq = Math.sin(age * WOBBLE_FREQ) * WOBBLE_SCALE_AMP * decay;
        wobScaleY = 1 - sq; // squash down...
        wobScaleXZ = 1 + sq * 0.5; // ...bulge sideways
      } else {
        wobbleStartRef.current = -1;
      }
    }
    g.scale.set(wobScaleXZ, wobScaleY, wobScaleXZ);

    // Auto-spin the dial mid-drop. Fires ONCE at local >= 0.3 so the
    // dial is mid-rotation when the keypad lands. KeypadModel's
    // DIAL_DAMP decays it naturally over the remaining drop frames,
    // settling just as the model touches down.
    if (!hasAutoSpunRef.current && local >= 0.3 && kickDialRef.current) {
      hasAutoSpunRef.current = true;
      kickDialRef.current(12);
    }
    // LANDING THUD: the moment the drop settles, one strong shockwave
    // ring radiates through the rice field from beneath the keypad —
    // the device visibly displaces the space it lands in. Same pulse
    // channel the press interactions use.
    if (!hasLandedPulseRef.current && eased >= 0.995) {
      hasLandedPulseRef.current = true;
      if (!PREFERS_REDUCED_MOTION) {
        stampPulse(pulsesRef.current, 1.35, 0.5, 0.58);
      }
    }
    // Reset the auto-spin + landing latches when the user scrolls fully
    // back above the pin (pin progress = 0). Re-entering replays the
    // drop, dial kick, and thud fresh.
    if (pinP <= 0.001) {
      hasAutoSpunRef.current = false;
      hasLandedPulseRef.current = false;
    }

    if (isMobile) {
      // Hold the desktop resting pose (the 3/4 "laying on a desk" view)
      // instead of a continuous Y spin. Matches how the keypad sits on
      // desktop when the cursor is inactive. Touch has no cursor, so
      // there is no face-tracking parallax; this static base tilt IS the
      // desktop look at rest. The idle float (bob on position above +
      // pitch/roll sway here) keeps it gently alive in place.
      g.rotation.x = BASE_TILT_X + floatPitch + wobX;
      g.rotation.y = BASE_TILT_Y;
      g.rotation.z = BASE_TILT_Z + floatRoll + wobZ;
      return;
    }

    // Face-tracking (NOT parallax). Model rotates TOWARD the cursor,
    // like a head following a hand. The spec's signs (`x`, `-y`)
    // assume a head-on camera with no base tilt; in our scene the
    // model has BASE_TILT_X=32.7° baked in (looking down at the lying-
    // flat keypad), which flips the screen-space mapping of both
    // axes. Empirically:
    //   cursor RIGHT  → model's right side must face the cursor →
    //     world rotation.y must DECREASE (model rotates CW from above)
    //   cursor UP     → cap-row must tilt up toward cursor →
    //     world rotation.x must DECREASE (less forward tilt)
    // So both signs are flipped vs the naive spec.
    const c = cursorRef.current;
    const x = c.active ? (c.x - 0.5) * 2 : 0;  // -1..1
    const y = c.active ? (c.y - 0.5) * 2 : 0;  // -1..1
    const targetX = BASE_TILT_X + y * PARALLAX_X;
    const targetY = BASE_TILT_Y + -x * PARALLAX_Y;
    const k = 1 - Math.exp(-dt * PARALLAX_LERP_RATE);
    tiltState.current.x += (targetX - tiltState.current.x) * k;
    tiltState.current.y += (targetY - tiltState.current.y) * k;
    // Cursor-tracked tilt + the idle float sway + the knob-press wobble
    // riding on top, so the keypad keeps a gentle life even when the
    // cursor is still.
    g.rotation.x = tiltState.current.x + floatPitch + wobX;
    g.rotation.y = tiltState.current.y;
    g.rotation.z = BASE_TILT_Z + floatRoll + wobZ;
  });

  return (
    <>
      {/* Cursor pool — a faithful port of the jump-menu MercuryAura effect, so
          the keypad blob reads EXACTLY like the jump menu: a faint orange rice
          field + a lit metaball pool + a thin orange membrane following the
          cursor. Single plane (no front-wisp layer) to match the jump menu. */}
      <RiceBlob
        cursorRef={riceCursorRef}
        glowOpacityRef={glowOpacityRef}
        isMobile={isMobile}
      />
      {/* Screen-space spacetime ripple. Takes over the render loop
          (scene -> FBO -> refracted fullscreen pass), so it is mounted
          ONLY outside tune mode, where R3F's auto-render must stay live
          for OrbitControls / TransformControls. Press ripples refract
          the entire viewport - keypad, grains and screen alike.

          PERF (mobile): the whole pass is ABSENT on phones. The FBO
          round-trip (render scene to an offscreen target, then a
          fullscreen refraction shader to the canvas) doubles the per-
          frame fill cost — and on touch there are no cursor presses
          driving ripples anyway, so it only ever blits 1:1. Dropping it
          lets R3F's normal auto-render draw the scene straight to the
          canvas. The keypad + static orange wash read the same at phone
          size for far less GPU. */}
      {!TUNE_MODE && !isMobile && (
        <RipplePost pulsesRef={pulsesRef} samples={4} />
      )}
      {/* Cool paper-white ambient (no warm/muddy tint). Lifts the shadow side a
          touch brighter than the old 0.5 so the dark body never reads moody. */}
      <ambientLight intensity={0.6} color="#f4f5f7" />
      {/* Pure-white KEY from the upper-right WITH shadow — the dominant light and
          the source of the crisp highlight that makes the brushed metal + white
          caps POP. Brightened over the original 1.6 → 1.9 for the "more popped"
          ask. Intensities sit under the clip point (NoToneMapping + the RipplePost
          lin2srgb output pass) so the white caps keep their form. */}
      <directionalLight
        position={[lightsKey.x, lightsKey.y, lightsKey.z]}
        intensity={1.9}
        color="#ffffff"
        castShadow
      />
      {/* Soft white FILL from the lower-left — lifts the shadow side without a
          colour cast so the key's contrast stays readable, not crushed. */}
      <directionalLight
        position={[lightsFill.x, lightsFill.y, lightsFill.z]}
        intensity={0.55}
        color="#f6f6f6"
      />
      {/* Barely-warm dial accent: small radius + low-ish intensity so it only
          tints the dial / cat-face into a soft emissive glow, not the whole
          scene. Restored with the directional revert (the IBL pass had dropped
          it, which is part of why the dial read flat). */}
      <pointLight
        position={[1.5, 1.0, -1.5]}
        intensity={1.5}
        color="#ffb98c"
        distance={2.4}
        decay={2}
      />
      <group
        ref={(g) => {
          groupRef.current = g;
          setGroupNode(g);
        }}
        rotation={[BASE_TILT_X, BASE_TILT_Y, BASE_TILT_Z]}
      >
        <KeypadModel
          onReady={(api: KeypadModelApi) => {
            kickDialRef.current = api.kickDial;
          }}
        />
      </group>
      {TUNE_MODE && (
        <>
          <OrbitControls
            makeDefault
            target={[0, 0, 0]}
            enableDamping
            dampingFactor={0.08}
            rotateSpeed={0.8}
            panSpeed={0.8}
            zoomSpeed={0.8}
            minDistance={2}
            maxDistance={20}
          />
          {groupNode && (
            <TransformControls
              object={groupNode}
              mode={transformMode}
              size={1.1}
            />
          )}
        </>
      )}
    </>
  );
}
