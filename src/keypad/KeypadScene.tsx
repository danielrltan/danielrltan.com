import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { DIAL_DAMP, KeypadModel, type KeypadModelApi } from "./KeypadModel";
import { RiceBlob } from "./RiceBlob";
import {
  RipplePost,
  createPulseChannel,
  stampPulse,
  type PulseChannel,
} from "./RipplePost";
import { KnobSparks } from "./KnobSparks";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useIsMobile } from "../useIsMobile";
import { isLowTier } from "../capabilityTier";
import { isTuneMode } from "../tuneMode";
import { clampDt, reducedMotion } from "../motion";
import { markSectionCanvasCreated } from "../useSectionCanvasMount";
import type { KeypadDropState } from "../portfolio/Keypad";

// Tuning mode: pass ?tune=keypad in the URL to enable OrbitControls
// + a live values HUD so you can drag the keypad to the orientation
// you want, then copy the values back into CAMERA_POS / BASE_TILT_Y.
const TUNE_MODE = isTuneMode("keypad");

/**
 * Dedicated R3F canvas for the keypad section, with its own scene +
 * camera (mounted on approach by Keypad.tsx).
 *
 * Composition:
 *   <RiceBlob/>      cursor-anchored rice fluid backdrop (z=-4)
 *   <group>          base orientation + parallax tilt
 *     <KeypadModel/> the gltf + click/hover/spin logic
 *
 * Motion:
 *   Drop-in: the model waits HIDDEN above the canvas, then a
 *            800 ms time-based pull + float settle (DROP_* below) once Keypad.tsx
 *            arms it. Nothing here is scroll-linked.
 *   Desktop: face-tracking, the model turns toward the viewport cursor
 *            (±15° on X and Y, damped at PARALLAX_LERP_RATE).
 *   Touch:   no cursor; holds the base pose. (The canvas does not mount
 *            at <=768px, but coarse-pointer tablets above it land here.)
 *   Both:    idle float once landed; the knob press wobbles the device.
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

// prefers-reduced-motion is read LIVE (reducedMotion.value from src/motion.ts)
// so an OS toggle applies without a reload. When set: the model rests from its
// first frame (no drop, thud or dial kick), and the idle float, knob wobble and
// press ripples are all off (the keypad holds a dead-still pose).

// Idle float: once the keypad has LANDED it drifts with a gentle
// vertical bob + a barely-there pitch/roll sway so it reads as
// "suspended in the scene, alive" rather than dead-still. Time-driven
// (a clamped-dt accumulator, never scroll-bound). Its clock only starts at
// the end of the drop timeline, so every axis begins at phase 0, and its
// amplitude fades in over FLOAT_FADE_S: no pop out of the rebound. Frozen
// entirely under prefers-reduced-motion. Deliberately NO yaw drift: a yaw
// oscillation would read like the auto-spin that was just removed.
// Co-prime-ish periods keep the three axes from beating into lockstep.
const FLOAT_BOB_PERIOD = 5.0; // s per rise+fall cycle (calm float)
const FLOAT_BOB_AMP = 0.12; // world units of vertical travel
const FLOAT_PITCH_PERIOD = 6.7;
const FLOAT_PITCH_AMP = THREE.MathUtils.degToRad(1.8);
const FLOAT_ROLL_PERIOD = 8.3;
const FLOAT_ROLL_AMP = THREE.MathUtils.degToRad(1.3);
const FLOAT_FADE_S = 1.0; // float amplitude fade-in after the landing

// DROP-IN: "one and done, a surprise" (owner, 2026-10-04; replaces spec W6's
// "hovering, then drops", whose parked keypad sat half in view, bobbing, for
// as long as the user scrolled slowly or paused before the trigger line).
//   HIDDEN (before the arm): the model waits just ABOVE the canvas, its
//                 bottom edge PARK_BOTTOM_FRAC of the canvas height above the
//                 top edge, so the canvas clips it out entirely: the section
//                 arrives as the rice stage (its glow already up on approach)
//                 with no keypad.
//   Then a time-based timeline, armed ONCE by Keypad.tsx when the section top
//   crosses DROP_TRIGGER_VH (held while an overlay covers the page), advanced
//   by clamped frame dt (frame-rate independent), never scroll-bound.
//   "A quick pull down, still kind of floating" (owner, 2026-10-05: the old
//   accelerating fall + outBack recoil + squash + 1.35 thud ripple read as a
//   SLAM). 800 ms:
//   0 -> 560 ms   PULL: from out of frame on an ease-out (quartic), so it is
//                 fastest while it ENTERS the stage and decelerates into
//                 place: no impact frame, nothing to stop dead.
//   250 ms        TOUCHDOWN, ~90% of the travel done: a soft ripple through
//                 the rice (stampPulse at LAND_PULSE, a third of a press) +
//                 one full turn of the dial (kickDial), so the cat lands
//                 upright. No squash.
//   250 ms ->     FLOAT BOUNCE (owner, 2026-10-06: "a soft float bounce to
//                 really sell that levitating effect"): from the touchdown the
//                 model rides an air cushion, a damped sine that carries the
//                 pull's downward motion into a sag below rest, floats back up
//                 past it, and dies out over ~3.5 s (BOUNCE_*). A slight lean
//                 while it descends (PULL_TILT) levels out as it arrives.
//   800 ms        LANDED: the idle float clock starts (the bounce keeps
//                 fading out underneath it; `t` runs on to DROP_BOUNCE_END_S).
// A late or fast arrival (Keypad.tsx sets dropRef.rate > 1) plays the same
// timeline compressed, so the landing still happens inside the pin.
// Every value is a named constant so the owner can tune the feel here.
// Hidden pose: the model's bottom edge sits this fraction of the canvas height
// ABOVE the canvas top (negative = above), so not a pixel shows before the
// drop. Derived per canvas size from the projected rest pose (parkHeight),
// clamped to [PARK_MIN, PARK_MAX] units.
const PARK_BOTTOM_FRAC = -0.04;
const PARK_MIN = 0.8;
const PARK_MAX = 10;
// Probe offset (world units) used only to measure px-per-unit in parkHeight.
const PARK_PROBE = 4;
const DROP_ARRIVE_S = 0.56; // the pull's travel is done (ease-out quartic)
const DROP_FALL_S = 0.25; // touchdown beat (~90% travelled): soft ripple + nudge
const DROP_TOTAL_S = 0.8; // landed; float bob may begin
// Float bounce from the touchdown: -AMP·sin(2πτ/PERIOD)·e^(-DAMP·τ). With
// these values the first sag bottoms out ~0.1 below rest (the idle bob is
// 0.12), the float back up overshoots ~0.04 and the next sag ~0.016.
const BOUNCE_AMP = 0.15; // world units
const BOUNCE_PERIOD = 1.4; // s per sag + float
const BOUNCE_DAMP = 1.3; // 1/s: each half swing ~40% of the last
const DROP_BOUNCE_END_S = DROP_FALL_S + 3.5; // e^(-1.3·3.5) ≈ 1%: done
const PULL_TILT = THREE.MathUtils.degToRad(3); // lean while descending, 0 at rest
const LAND_PULSE = { strength: 0.45, x: 0.5, y: 0.58 } as const; // soft touchdown ripple
// Dial nudge at touchdown: exactly one full turn. The dial's velocity decays
// exponentially at DIAL_DAMP, so its total travel is v / DIAL_DAMP; 2π·DAMP
// spins it once and the cat face lands upright again (3 rad/s left it upside
// down).
const LAND_DIAL_KICK = Math.PI * 2 * DIAL_DAMP;

/** Remaining pull (1 = parked, 0 = arrived) at drop time t: an ease-out
 *  quartic, fastest at the start (while the model is still entering). */
function pullLeft(t: number): number {
  const u = Math.min(1, Math.max(0, t / DROP_ARRIVE_S));
  return Math.pow(1 - u, 4);
}

/** Model Y offset (world units, 0 = rest) at drop time t (s), pulled down from
 *  `height`, plus the float bounce from the touchdown. The bounce starts at 0
 *  moving DOWN, so it continues the pull's descent instead of reversing it,
 *  and is ~1% of its amplitude at DROP_BOUNCE_END_S, so it ends with no step. */
function dropOffsetY(t: number, height: number): number {
  if (t >= DROP_BOUNCE_END_S) return 0;
  const tau = Math.max(0, t - DROP_FALL_S);
  const bounce =
    BOUNCE_AMP * Math.sin((tau / BOUNCE_PERIOD) * Math.PI * 2) * Math.exp(-BOUNCE_DAMP * tau);
  return height * pullLeft(t) - bounce;
}

/** Parked height (world units above rest) that puts the model's bottom edge
 *  at PARK_BOTTOM_FRAC of the canvas height, measured by projecting the
 *  base-tilt pose at rest and at PARK_PROBE. Called once per canvas size,
 *  pre-drop. Restores the group's transform. */
function parkHeight(
  g: THREE.Group,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): number {
  const pos = g.position.y;
  const rot = g.rotation.clone();
  const scl = g.scale.clone();
  g.rotation.set(BASE_TILT_X, BASE_TILT_Y, BASE_TILT_Z);
  g.scale.setScalar(1);
  g.position.y = 0;
  g.updateMatrixWorld(true);
  const rest = projectToViewport(g, camera, canvas);
  g.position.y = PARK_PROBE;
  g.updateMatrixWorld(true);
  const high = projectToViewport(g, camera, canvas);
  const fallback = (PARK_MIN + PARK_MAX) / 2;
  const r = canvas.getBoundingClientRect();
  let h = fallback;
  if (rest && high && r.height > 0) {
    const pxPerUnit = (rest.bottom - high.bottom) / PARK_PROBE;
    if (pxPerUnit > 0) {
      // Linear first guess, then refine by re-projecting: perspective makes
      // px-per-unit shrink with height, so the linear guess parks the model
      // too LOW (its underside peeked out under the marquee). Secant steps
      // on the real projected bottom edge converge in 2-3 iterations.
      const target = r.top + PARK_BOTTOM_FRAC * r.height;
      h = (rest.bottom - target) / pxPerUnit;
      let h0 = 0, b0 = rest.bottom;
      for (let i = 0; i < 4; i++) {
        g.position.y = h;
        g.updateMatrixWorld(true);
        const p = projectToViewport(g, camera, canvas);
        if (!p) break;
        if (Math.abs(p.bottom - target) < 1) break;
        const slope = (p.bottom - b0) / (h - h0 || 1e-6);
        h0 = h;
        b0 = p.bottom;
        if (!(slope < 0)) break;
        h += (target - p.bottom) / slope;
      }
    }
  }
  g.position.y = pos;
  g.rotation.copy(rot);
  g.scale.copy(scl);
  g.updateMatrixWorld(true);
  return Math.min(PARK_MAX, Math.max(PARK_MIN, h));
}

/** Measurement mirror for the e2e probes (like window.__heroMotion). A cheap
 *  frame counter ticks on every visible frame; the payloads (trigger, contact
 *  and settle bboxes) are written only at those beats. */
interface KeypadMotionDebug {
  frame: number;
  triggerTop: number | null;
  coverWaitMs?: number | null;
  /** Parked height (world units above rest) the fall starts from. */
  parkHeight?: number;
  /** Timeline rate (1 = 800 ms; > 1 = compressed late/fast arrival). */
  rate?: number;
  approachPxS?: number | null;
  /** Live model Y offset from rest (world units), written every frame. */
  offsetY?: number;
  contact: null | {
    frame: number;
    t: number;
    scrollY: number;
    pinActive: boolean;
    pulseFrame: number;
    kickFrame: number | null;
    bbox: ViewportBox | null;
  };
  settle: null | { frame: number; scrollY: number; bbox: ViewportBox | null };
  reducedMotion: boolean;
}
interface ViewportBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
const debugMirror = (): KeypadMotionDebug => {
  const w = window as unknown as { __keypadMotion?: KeypadMotionDebug };
  return (w.__keypadMotion ??= {
    frame: 0,
    triggerTop: null,
    contact: null,
    settle: null,
    reducedMotion: false,
  });
};
const _v = new THREE.Vector3();
// Vertex budget per bbox: a strided sample keeps the two probe frames cheap
// (well under a millisecond) at a few px of bbox accuracy.
const BBOX_SAMPLE_VERTS = 6000;
/** Screen-space bbox (viewport px) of an object's rendered geometry, from a
 *  strided sample of its mesh vertices. Only called on two probe frames. */
function projectToViewport(
  obj: THREE.Object3D,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): ViewportBox | null {
  const meshes: THREE.Mesh[] = [];
  let total = 0;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    const pos = m.isMesh ? m.geometry?.getAttribute("position") : undefined;
    if (pos && m.visible) {
      meshes.push(m);
      total += pos.count;
    }
  });
  if (!total) return null;
  const stride = Math.max(1, Math.ceil(total / BBOX_SAMPLE_VERTS));
  const r = canvas.getBoundingClientRect();
  const out = { top: Infinity, bottom: -Infinity, left: Infinity, right: -Infinity };
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i += stride) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld).project(camera);
      const x = r.left + ((_v.x + 1) / 2) * r.width;
      const y = r.top + ((1 - _v.y) / 2) * r.height;
      if (x < out.left) out.left = x;
      if (x > out.right) out.right = x;
      if (y < out.top) out.top = y;
      if (y > out.bottom) out.bottom = y;
    }
  }
  return {
    top: Math.round(out.top),
    bottom: Math.round(out.bottom),
    left: Math.round(out.left),
    right: Math.round(out.right),
  };
}

interface CursorState {
  // 0..1 across the canvas (top-left origin to match HTML conventions).
  x: number;
  y: number;
  // Whether cursor is currently over the canvas.
  active: boolean;
}

interface KeypadSceneProps {
  /** Drop timeline state owned by Keypad.tsx (so it outlives this canvas).
   *  Keypad.tsx arms it at the trigger line; this scene advances `t` by
   *  frame dt and fires the contact beat once. */
  dropRef: React.MutableRefObject<KeypadDropState>;
  /** 0..1 target opacity for the RiceBlob's orange glow layer. Keypad.tsx
   *  sets it to 1 on APPROACH (before the drop), so the stage is already
   *  blooming when the model falls. */
  glowOpacityRef?: React.MutableRefObject<number>;
}

export function KeypadScene({ dropRef, glowOpacityRef }: KeypadSceneProps) {
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
      if (reducedMotion.value) return;
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
        data-section-canvas=""
        camera={{ position: CAMERA_POS, fov: 32, near: 0.1, far: 50 }}
        // No re-measure on scroll: R3F's pointer mapping uses event
        // offsetX/offsetY (canvas-local), so a stale page-relative rect is
        // harmless, and re-measuring on every scroll stop re-rendered the
        // Canvas root mid-scroll. Size changes still come via ResizeObserver.
        resize={{ scroll: false }}
        // PERF (mobile): the RiceBlob is a full-screen fragment-heavy
        // shader (per-pixel noise + three glow blobs) that runs every
        // visible frame. Fragment cost scales with the rendered pixel
        // count, so on a 3x-DPR phone even a 1.25 cap means ~1.6x the
        // work of DPR 1. The backdrop is a soft gradient + soft grain,
        // supersampling buys almost no perceptible sharpness there, so
        // pin mobile to DPR 1. Desktop keeps [1, 1.5] for crisp caps.
        dpr={isMobile || isLowTier() ? 1 : [1, 1.5]}
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
          markSectionCanvasCreated(gl.domElement);
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.setClearColor(0x000000, 0);
          canvasInvalidateRef.current = invalidate;
          // The visibility observer may have flipped to visible before this
          // ran (canvas mounted on arrival), dropping its wake poke.
          if (visibleRef.current) invalidate();
        }}
      >
        <SceneContents
          cursorRef={cursorRef}
          riceCursorRef={riceCursorRef}
          isMobile={isMobile}
          dropRef={dropRef}
          glowOpacityRef={glowOpacityRef}
          tuneStateRef={tuneStateRef}
          transformMode={transformMode}
          visibleRef={visibleRef}
          pulsesRef={pulsesRef}
        />
      </Canvas>
      <KnobSparks />
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
  dropRef,
  glowOpacityRef,
  tuneStateRef,
  transformMode,
  visibleRef,
  pulsesRef,
}: {
  cursorRef: React.MutableRefObject<CursorState>;
  riceCursorRef: React.MutableRefObject<CursorState>;
  isMobile: boolean;
  dropRef: React.MutableRefObject<KeypadDropState>;
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
  // Start at the base pose: starting at 0 made the first frames snap the
  // model flat, then ease it back to the base tilt.
  const tiltState = useRef({ x: BASE_TILT_X, y: BASE_TILT_Y });
  // Parked height, cached per canvas size (see parkHeight).
  const startHRef = useRef({ h: (PARK_MIN + PARK_MAX) / 2, w: 0, hgt: 0 });
  // Monotonic float clock (clamped-dt accumulator) so the idle bob/sway
  // advances smoothly and never pops when the demand-loop canvas resumes
  // after being scrolled off-screen (a raw clock delta could jump). It only
  // advances once the drop has landed.
  const floatTimeRef = useRef(0);
  // Captured from KeypadModel via onReady. The landing kicks the dial at the
  // contact frame so the knob spins off the impact, then DIAL_DAMP (in
  // KeypadModel) winds it down.
  const kickDialRef = useRef<((v: number) => void) | null>(null);
  // Skip the drop clock on the scene's first rendered frame and on the first
  // armed frame: their dt spans the mount/shader-compile hitch or the idle
  // demand loop's gap before the arm wake-up, not animation time.
  const firstFrameRef = useRef(true);
  const startedRef = useRef(false);
  // performance.now() stamp of the last knob press (-1 = idle); drives
  // the whole-keypad cartoony wobble in the frame loop.
  const wobbleStartRef = useRef(-1);
  const { camera, invalidate, gl, size } = useThree();

  // Knob press -> jiggle the whole device. KeypadModel dispatches
  // "keypad-knob-press" on dial click; gated by reduced motion.
  useEffect(() => {
    const onKnob = () => {
      if (reducedMotion.value) return;
      wobbleStartRef.current = performance.now();
      invalidate();
    };
    window.addEventListener("keypad-knob-press", onKnob);
    return () => window.removeEventListener("keypad-knob-press", onKnob);
  }, [invalidate]);

  // Demand-loop wake-ups. (1) On mount: after a cut jump straight to Contact
  // the canvas mounts on arrival, and the visibility observer can flip before
  // onCreated has handed over `invalidate`, losing its wake poke. (2) When
  // the drop arms, in case the loop is idle at that moment.
  useEffect(() => {
    invalidate();
    const onArmed = () => invalidate();
    window.addEventListener("keypad-drop-armed", onArmed);
    return () => window.removeEventListener("keypad-drop-armed", onArmed);
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

    // DROP-IN timeline (see the DROP_* constants). Armed by Keypad.tsx at
    // the trigger line; advanced here by clamped frame dt, so the pace is
    // the same at 60 and 120 Hz and independent of scroll speed. The state
    // lives in Keypad.tsx, so a remounted canvas shows the landed pose.
    const dbg = debugMirror();
    dbg.frame++;
    const d = dropRef.current;
    const rm = reducedMotion.value;
    dbg.reducedMotion = rm;
    if (rm) {
      // Reduced motion: the model rests from its first frame. Spend the
      // contact latch so no thud or dial kick ever fires.
      d.t = Math.max(d.t, DROP_BOUNCE_END_S);
      d.contactFired = true;
    } else if (d.armed && d.t < DROP_BOUNCE_END_S) {
      // Plain clampDt (MAX_DT 0.1 s): the drop keeps its 800 ms wall-clock
      // length down to 10 fps. Contact is a latch, so a large step still
      // fires it, just on that frame.
      if (!firstFrameRef.current && startedRef.current) d.t += clampDt(dt) * d.rate;
      startedRef.current = true;
      if (dbg.triggerTop == null) {
        dbg.triggerTop = d.triggerTop;
        dbg.coverWaitMs = d.coverWaitMs;
        dbg.rate = d.rate;
        dbg.approachPxS = d.approachPxS;
      }
    }
    firstFrameRef.current = false;
    const dropT = d.t;
    // Re-derive the parked height when the canvas size changes, but only
    // before the fall is under way (never mid-drop, never once landed).
    const sh = startHRef.current;
    if (dropT === 0 && (sh.w !== size.width || sh.hgt !== size.height)) {
      sh.h = parkHeight(g, camera, gl.domElement);
      sh.w = size.width;
      sh.hgt = size.height;
      dbg.parkHeight = Math.round(sh.h * 100) / 100;
    }
    g.position.y = dropOffsetY(dropT, sh.h);

    // No pre-drop hover: the model waits out of frame (see HIDDEN above). While
    // it is pulled down it leans slightly, levelling out as it arrives.
    const hoverPitch = rm || dropT >= DROP_TOTAL_S ? 0 : PULL_TILT * pullLeft(dropT);
    const hoverRoll = 0;

    // TOUCHDOWN: the frame the pull crosses DROP_FALL_S. A soft ripple from
    // beneath the keypad + a small dial nudge, both in THIS frame, so the
    // ripple still has a visible cause (the device settling into the space).
    if (!d.contactFired && dropT >= DROP_FALL_S) {
      d.contactFired = true;
      stampPulse(pulsesRef.current, LAND_PULSE.strength, LAND_PULSE.x, LAND_PULSE.y);
      const kick = kickDialRef.current;
      if (kick) kick(LAND_DIAL_KICK);
      const st = ScrollTrigger.getById("keypad-pin");
      dbg.contact = {
        frame: dbg.frame,
        t: Math.round(dropT * 1000) / 1000,
        scrollY: Math.round(window.scrollY),
        pinActive: !!st?.isActive,
        pulseFrame: dbg.frame,
        kickFrame: kick ? dbg.frame : null,
        bbox: null,
      };
      g.updateMatrixWorld(true);
      dbg.contact.bbox = projectToViewport(g, camera, gl.domElement);
    }

    // Idle float: gentle bob + sway, only once landed and off under reduced
    // motion. Its clock starts at the landing (phase 0) and its amplitude
    // fades in, so it never pops out of the rebound. Applied to BOTH the
    // touch (static) and desktop (cursor-tracked) paths below. The bob is
    // added to position here; the pitch/roll sway is applied per-path
    // alongside the base/tracked rotation.
    const landed = dropT >= DROP_TOTAL_S;
    if (landed && !rm) floatTimeRef.current += clampDt(dt);
    const ft = floatTimeRef.current;
    const fadeIn = Math.min(1, ft / FLOAT_FADE_S);
    const floatGate = rm || !landed ? 0 : fadeIn * fadeIn * (3 - 2 * fadeIn);
    const floatPitch =
      Math.sin((ft / FLOAT_PITCH_PERIOD) * Math.PI * 2) *
        FLOAT_PITCH_AMP *
        floatGate +
      hoverPitch;
    const floatRoll =
      Math.sin((ft / FLOAT_ROLL_PERIOD) * Math.PI * 2) *
        FLOAT_ROLL_AMP *
        floatGate +
      hoverRoll;
    g.position.y +=
      Math.sin((ft / FLOAT_BOB_PERIOD) * Math.PI * 2) * FLOAT_BOB_AMP * floatGate;
    dbg.offsetY = g.position.y;

    // Cartoony knob-press WOBBLE: a decaying oscillation layered on top of
    // the rotation (x + z, out of phase) plus a squash-stretch scale pulse.
    // The landing squash rides the SAME scale path (summed into `sq`), so a
    // press during the landing composes instead of overwriting it. Always
    // applied (neutral when idle) so the group scale resets cleanly.
    let wobX = 0;
    let wobZ = 0;
    let sq = 0;
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
        sq += Math.sin(age * WOBBLE_FREQ) * WOBBLE_SCALE_AMP * decay;
      } else {
        wobbleStartRef.current = -1;
      }
    }
    // squash down... bulge sideways (half as much, roughly volume-keeping)
    g.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);

    // SETTLE record for the probes: the first landed frame.
    if (landed && dbg.contact && !dbg.settle) {
      g.updateMatrixWorld(true);
      dbg.settle = {
        frame: dbg.frame,
        scrollY: Math.round(window.scrollY),
        bbox: projectToViewport(g, camera, gl.domElement),
      };
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
    const k = 1 - Math.exp(-clampDt(dt) * PARALLAX_LERP_RATE);
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
      {!TUNE_MODE && !isMobile && !isLowTier() && (
        // Weak GPU (low tier) takes the SAME path as mobile: skip the RipplePost
        // refraction pass entirely (its 4× MSAA FBO round-trip is the keypad's
        // biggest fill cost) and let R3F auto-render the scene straight to the
        // canvas. The pulses just stop refracting — a clean, disclosed fallback.
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
