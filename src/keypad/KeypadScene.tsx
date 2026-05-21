import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import { KeypadModel, type KeypadModelApi } from "./KeypadModel";
import { RiceBlob } from "./RiceBlob";
import { useIsMobile } from "../useIsMobile";

// Tuning mode — pass ?tune=keypad in the URL to enable OrbitControls
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
 *   Desktop — cursor offset from canvas center drives ±8° tilt
 *             around X and Y. Lerped each frame.
 *   Mobile  — no cursor; slow auto-rotate around Y at ~1 rev / 40s.
 */

// Camera + model orientation — dialed in via the ?tune=keypad
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

// Auto-rotate sweep on mobile — radians per second.
const AUTOROTATE_SPEED = (Math.PI * 2) / 40;

// Drop-in effect: model translates from this Y offset (well above
// the visible camera frame) down to 0 as sectionProgress goes 0 → 1.
// Picked empirically — needs to be larger than the visible frustum
// half-height at the lookAt distance so the model is genuinely
// off-screen at progress=0, not just clipped.
const DROP_HEIGHT = 6;
// Total time the drop-in animation takes, in milliseconds. The drop
// is driven by elapsed time since Keypad.tsx's onEnter ScrollTrigger
// stamped `dropStartTimeRef` — NOT by scroll progress — so the pace
// is identical regardless of how fast the user scrolls into the
// section.
//
// 700ms targets the "slightly faster than scroll rate" feel: at a
// typical user scroll rate of ~1500px/s, the 800px entry distance
// from "section first appears" to "section's top hits viewport top"
// takes ~500ms. A 700ms drop runs a hair slower than that — so the
// keypad is mid-landing as the user scrolls past where it should be
// and finishes landing just as the pin engages. Reads as
// "animated drop in sync with my scroll" rather than "I scroll,
// then it animates" or "I scroll, then it slowly plays out."
// easeOutCubic still applies inside this 700ms so the landing feels
// soft despite the shorter duration.
const DROP_DURATION_MS = 700;

interface CursorState {
  // 0..1 across the canvas (top-left origin to match HTML conventions).
  x: number;
  y: number;
  // Whether cursor is currently over the canvas.
  active: boolean;
}

interface KeypadSceneProps {
  // Stamped by Keypad.tsx's onEnter ScrollTrigger the moment the
  // section first enters viewport. `null` = hasn't entered yet
  // (model sits above frame, invisible). KeypadScene reads this and
  // computes drop progress purely from elapsed time, decoupling the
  // animation from scroll speed.
  dropStartTimeRef: React.MutableRefObject<number | null>;
}

export function KeypadScene({ dropStartTimeRef }: KeypadSceneProps) {
  const isMobile = useIsMobile();
  // Cursor target shared with RiceBlob (uniform driver) and with the
  // SceneContents component (parallax driver).
  const cursorRef = useRef<CursorState>({ x: 0.5, y: 0.5, active: false });
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isMobile) return;
    // Face-tracking math is VIEWPORT-relative (per spec) so the
    // model keeps tracking even when the cursor leaves the keypad
    // canvas — listener lives on document, not the canvas wrapper.
    // The RiceBlob (which IS canvas-local) reads the same ref and
    // uses .active for its on/off.
    const onMove = (e: PointerEvent) => {
      cursorRef.current = {
        x: e.clientX / Math.max(1, window.innerWidth),
        y: e.clientY / Math.max(1, window.innerHeight),
        active: true,
      };
    };
    const onLeave = () => {
      cursorRef.current = { ...cursorRef.current, active: false };
    };
    document.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
    };
  }, [isMobile]);

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
        dpr={isMobile ? [1, 1.25] : [1, 1.5]}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.setClearColor(0x000000, 0);
        }}
      >
        <SceneContents
          cursorRef={cursorRef}
          isMobile={isMobile}
          dropStartTimeRef={dropStartTimeRef}
          tuneStateRef={tuneStateRef}
          transformMode={transformMode}
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
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        fontSize: 12,
        lineHeight: 1.55,
        borderRadius: 6,
        pointerEvents: "none",
        boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        minWidth: 320,
      }}
    >
      <div style={{ marginBottom: 6, color: "#ff7e42", letterSpacing: 1 }}>
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
  isMobile,
  dropStartTimeRef,
  tuneStateRef,
  transformMode,
}: {
  cursorRef: React.MutableRefObject<CursorState>;
  isMobile: boolean;
  dropStartTimeRef: React.MutableRefObject<number | null>;
  tuneStateRef: React.MutableRefObject<TuneState>;
  transformMode: TuneTransformMode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  // Track the group as REACT STATE too (not just ref) so the
  // TransformControls JSX can re-render once the group has mounted —
  // useRef updates don't trigger renders.
  const [groupNode, setGroupNode] = useState<THREE.Group | null>(null);
  const tiltState = useRef({ x: 0, y: 0 });
  const autoRotateY = useRef(0);
  // Drop-in animation state — initialized to DROP_HEIGHT so the
  // model starts off-screen above on first frame, then lerps down
  // as the user scrolls into the section.
  const dropY = useRef(DROP_HEIGHT);
  // Captured from KeypadModel via onReady callback. Used to fire an
  // automatic dial spin during the drop-in so the knob is mid-rotation
  // when the keypad lands — feels like the device "shakes off" the
  // fall before settling. The dial's existing DIAL_DAMP decay ends
  // the spin naturally over the back half of the drop.
  const kickDialRef = useRef<((v: number) => void) | null>(null);
  const hasAutoSpunRef = useRef(false);
  const { camera } = useThree();
  // Fit is now self-contained inside KeypadModel — it computes its
  // own bounding-sphere-based scale against the camera frustum, so
  // the wrapping group here only handles ORIENTATION (base tilt +
  // parallax), not sizing.

  // Neutral lighting — clean product-shot studio. Mostly white
  // with a hint of warmth on the dial accent so the cat-face icon
  // sits in a soft glow rather than reading as a flat texture.
  // Scheme:
  //   - neutral ambient (paper-white, no tint either direction)
  //   - pure-white KEY from upper-right (casts shadow)
  //   - soft white FILL from lower-left (lifts shadow side)
  //   - barely-warm dial accent (very subtle — sells emissive
  //     without coloring the palette)
  // No cyan, no blue, no magenta, no saturated kickers.
  const lightsKey = useMemo(() => new THREE.Vector3(4, 5, 3), []);
  const lightsFill = useMemo(() => new THREE.Vector3(-3.5, -1, -1), []);

  // Keep camera looking at origin (model centroid after recenter).
  useEffect(() => {
    camera.lookAt(0, 0, 0);
  }, [camera]);

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;

    // Tune mode: skip drop-in + parallax + auto-rotate. Camera is
    // driven by OrbitControls; model rotation/position is driven by
    // TransformControls (gizmo) — DON'T overwrite either in this
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
    // This is the "guided story" pacing — the user can't speed up or
    // slow down the drop by scrolling faster or slower, so the
    // landing always feels deliberate.
    //
    // Driven by `dropStartTimeRef`, set by Keypad.tsx's onEnter
    // ScrollTrigger the moment the section first crosses into the
    // viewport. While null (section hasn't been entered), the model
    // sits at DROP_HEIGHT (above frame, invisible). easeOutCubic on
    // the local 0..1 timeline gives a soft, weighty landing.
    const startTime = dropStartTimeRef.current;
    let local: number;
    if (startTime == null) {
      local = 0;
    } else {
      const elapsed = performance.now() - startTime;
      local = Math.max(0, Math.min(1, elapsed / DROP_DURATION_MS));
    }
    const eased = 1 - Math.pow(1 - local, 3);
    g.position.y = (1 - eased) * DROP_HEIGHT;
    // We still update dropY for any external consumers expecting it,
    // but the animation is no longer lerped — local already maps
    // directly to a position via easeOutCubic, and any per-frame
    // smoothing would just slow the fixed-rate animation back down.
    dropY.current = g.position.y;

    // Auto-spin the dial mid-drop. Fires ONCE at local >= 0.3 (~480ms
    // into the 1600ms drop) so the dial is mid-rotation when the
    // keypad lands. KeypadModel's DIAL_DAMP decays it naturally over
    // the remaining ~1.1s, settling just as the model finishes
    // landing — "the device gave a quick shake on impact."
    if (!hasAutoSpunRef.current && local >= 0.3 && kickDialRef.current) {
      hasAutoSpunRef.current = true;
      kickDialRef.current(12);
    }
    // Reset latch when the user scrolls fully back above the section
    // (Keypad.tsx clears dropStartTimeRef in onLeaveBack), so a
    // re-entry replays the drop + dial spin fresh.
    if (startTime == null && hasAutoSpunRef.current) {
      hasAutoSpunRef.current = false;
    }

    if (isMobile) {
      autoRotateY.current += dt * AUTOROTATE_SPEED;
      g.rotation.x = BASE_TILT_X;
      g.rotation.y = BASE_TILT_Y + autoRotateY.current;
      g.rotation.z = BASE_TILT_Z;
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
    g.rotation.x = tiltState.current.x;
    g.rotation.y = tiltState.current.y;
    g.rotation.z = BASE_TILT_Z;
  });

  return (
    <>
      <RiceBlob cursorRef={cursorRef} />
      {/* Neutral paper-white ambient. */}
      <ambientLight intensity={0.5} color="#f4f3f0" />
      {/* Pure-white KEY from upper-right with shadow. */}
      <directionalLight
        position={[lightsKey.x, lightsKey.y, lightsKey.z]}
        intensity={1.6}
        color="#ffffff"
        castShadow
      />
      {/* Soft white fill from lower-left — lifts shadow side, no
          color cast. */}
      <directionalLight
        position={[lightsFill.x, lightsFill.y, lightsFill.z]}
        intensity={0.45}
        color="#f6f6f6"
      />
      {/* Barely-warm dial accent. Low intensity + small radius so
          it only tints the dial area, not the whole scene. Sells
          the cat-face as a soft emissive without warming the room. */}
      <pointLight
        position={[1.5, 1.0, -1.5]}
        intensity={1.4}
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
