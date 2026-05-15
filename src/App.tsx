import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Physics } from "@react-three/rapier";
import {
  EffectComposer,
  Bloom,
} from "@react-three/postprocessing";
import * as THREE from "three";
import { Room } from "./Room";
import { Lighting } from "./Lighting";
import { IntroController } from "./IntroController";
import { SceneStateProvider } from "./SceneState";
import { MoveableCursor } from "./MoveableCursor";
import { DeskViewController } from "./DeskViewController";
import { startAmbience } from "./audio";
import { DesktopOS } from "./desktop";
import { BootSequence } from "./desktop/BootSequence";
import { MonitorScreen } from "./MonitorScreen";
import { Monitor } from "lucide-react";

export default function App() {
  const roomGroupRef = useRef<THREE.Group | null>(null);
  const sceneReadyRef = useRef(false);
  const isHoveringRef = useRef(false);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const deskViewActiveRef = useRef(false);
  const [transitionStarted, setTransitionStarted] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [moveableHover, setMoveableHover] = useState(false);
  const [roomResetKey, setRoomResetKey] = useState(0);
  // State mirror of `deskViewActiveRef` — flips React when DeskView opens
  // or closes. Gates the on-monitor DesktopOS mount so it doesn't render
  // when the camera isn't seated (otherwise the CSS-3D plane clips
  // through other meshes from off-axis angles).
  const [deskViewActive, setDeskViewActive] = useState(false);
  const [osOpen, setOsOpen] = useState(false);
  const [osSize, setOsSize] = useState(() => ({
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  const deskViewImplRef = useRef<(() => void) | null>(null);
  const startDeskView = useCallback(() => deskViewImplRef.current?.(), []);

  useEffect(() => {
    const onResize = () =>
      setOsSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!sceneReady) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape" && osOpen) {
        setOsOpen(false);
        return;
      }
      if (e.code === "KeyO" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const el = e.target;
        if (
          el instanceof HTMLElement &&
          (el.isContentEditable || el.closest("input, textarea, select"))
        )
          return;
        setOsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sceneReady, osOpen]);

  const startTransition = useCallback(() => {
    if (transitionStarted) return;
    setTransitionStarted(true);
    // First user gesture — unlocks audio and starts the ambient loop.
    startAmbience(0.22);
  }, [transitionStarted]);

  const completeTransition = useCallback(() => {
    sceneReadyRef.current = true;
    setSceneReady(true);
  }, []);

  // Shift + left button = pan; release Shift = left rotates again (slow rotateSpeed below).
  useEffect(() => {
    if (!sceneReady) return;
    const applyShiftPan = (shift: boolean) => {
      const c = controlsRef.current;
      if (!c) return;
      c.mouseButtons.LEFT = shift ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "ShiftLeft" && e.code !== "ShiftRight") return;
      applyShiftPan(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "ShiftLeft" && e.code !== "ShiftRight") return;
      if (!e.shiftKey) applyShiftPan(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [sceneReady]);

  // Full room + physics reset (capture so Room's KeyR → key mesh handler does not run).
  useEffect(() => {
    if (!sceneReady) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyR" || e.repeat) return;
      if (e.ctrlKey || e.metaKey) return;
      // Reset is disabled while seated at the desk (and through the
      // fromDesk return lerp — the ref stays true until that completes).
      if (deskViewActiveRef.current) return;
      const el = e.target;
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable || el.closest("input, textarea, select"))
      ) {
        return;
      }
      e.preventDefault();
      setMoveableHover(false);
      setRoomResetKey((k) => k + 1);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [sceneReady]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        cursor: sceneReady ? "none" : "pointer",
      }}
      onClick={startTransition}
      onPointerEnter={() => {
        isHoveringRef.current = true;
      }}
      onPointerLeave={() => {
        isHoveringRef.current = false;
        setMoveableHover(false);
      }}
    >
      <Canvas
        camera={{
          position: [25, 25, 25],
          fov: 11,
          near: 0.1,
          far: 200,
        }}
        gl={{
          antialias: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.8,
        }}
        onCreated={({ scene, gl, camera }) => {
          scene.background = new THREE.Color("#330a05");
          gl.outputColorSpace = THREE.SRGBColorSpace;
          (gl as unknown as { useLegacyLights?: boolean }).useLegacyLights =
            false;
          // Cap DPR at 1.5 — retina screens drop 50%+ of GPU fill rate for
          // almost no perceptible difference at this art style.
          gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
          // Shadow maps are the single biggest perf cost; warm point-light
          // falloff is doing the visual job already.
          gl.shadowMap.enabled = false;
          // Single perspective camera throughout: starts at [20,20,20] with
          // FOV 8 (looks identical to ortho) and smoothly lerps to
          // [3.5,2.5,3.5] FOV 50 on the click transition — no swap.
          cameraRef.current = camera as THREE.PerspectiveCamera;
          camera.lookAt(0, 0.6, 0);
        }}
      >
        <SceneStateProvider
          value={{
            sceneReadyRef,
            deskViewActiveRef,
            setDeskViewActive,
            setMoveableHover,
            startDeskView,
          }}
        >
          <Suspense fallback={null}>
            <Lighting />
            <Physics
              gravity={[0, -9.81, 0]}
              timeStep={1 / 60}
              numSolverIterations={3}
              numInternalPgsIterations={1}
              allowedLinearError={0.0025}
              contactNaturalFrequency={22}
            >
              <Room key={roomResetKey} roomGroupRef={roomGroupRef} />
            </Physics>
            <IntroController
              cameraRef={cameraRef}
              roomGroupRef={roomGroupRef}
              isHoveringRef={isHoveringRef}
              transitionStarted={transitionStarted}
              onComplete={completeTransition}
            />
            {sceneReady && (
              <>
                <OrbitControls
                  ref={controlsRef}
                  makeDefault
                  target={[0, 0.8, 0]}
                  minDistance={1.2}
                  maxDistance={8}
                  minPolarAngle={Math.PI * 0.1}
                  maxPolarAngle={Math.PI * 0.55}
                  enableDamping
                  dampingFactor={0.05}
                  rotateSpeed={0.36}
                  panSpeed={1.0}
                  mouseButtons={{
                    LEFT: THREE.MOUSE.ROTATE,
                    MIDDLE: THREE.MOUSE.DOLLY,
                    RIGHT: THREE.MOUSE.PAN,
                  }}
                  touches={{
                    ONE: THREE.TOUCH.ROTATE,
                    TWO: THREE.TOUCH.DOLLY_PAN,
                  }}
                  enableZoom
                  zoomSpeed={1.2}
                  zoomToCursor={false}
                  enablePan
                />
                <DeskViewController implRef={deskViewImplRef} />
              </>
            )}

            {/* DesktopOS rendered onto the actual monitor surface in 3D.
                Only mounted while the user is seated at the desk — the
                CSS-3D plane clips through scene meshes from off-axis
                angles, so the computer effectively "goes to sleep" when
                Escape returns the camera to free-orbit. */}
            {sceneReady && deskViewActive && (
              <MonitorScreen>
                <BootSequence width={1100} height={660}>
                  <DesktopOS width={1100} height={660} />
                </BootSequence>
              </MonitorScreen>
            )}

            <EffectComposer>
              <Bloom
                mipmapBlur
                luminanceThreshold={1.0}
                intensity={0.7}
                radius={0.85}
              />
            </EffectComposer>
          </Suspense>
        </SceneStateProvider>
      </Canvas>

      {sceneReady && <MoveableCursor hot={moveableHover} />}

      {/* OS launcher chip hidden for prod — the OS is reached by clicking
          the keyboard / monitor in the 3D scene. Press `O` still toggles
          the fullscreen overlay variant if needed during dev. */}
      {false && sceneReady && !osOpen && (
        <button
          onClick={() => setOsOpen(true)}
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(20, 18, 16, 0.55)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            color: "#f0e0d0",
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: 0.3,
            cursor: "pointer",
            zIndex: 20,
            fontFamily:
              "ui-monospace, 'JetBrains Mono', 'SF Mono', monospace",
          }}
        >
          <Monitor size={14} />
          Open OS
          <span
            style={{
              marginLeft: 6,
              padding: "2px 5px",
              borderRadius: 4,
              background: "rgba(255,255,255,0.08)",
              fontSize: 10,
              opacity: 0.7,
            }}
          >
            O
          </span>
        </button>
      )}

      {/* DesktopOS overlay */}
      {osOpen && (
        <div style={{ position: "absolute", inset: 0, zIndex: 50 }}>
          <DesktopOS
            width={osSize.w}
            height={osSize.h}
            onClose={() => setOsOpen(false)}
          />
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          color: "white",
          textTransform: "uppercase",
          letterSpacing: "2px",
          fontSize: "14px",
          fontFamily: "sans-serif",
          opacity: transitionStarted ? 0 : 0.5,
          transition: "opacity 0.5s ease",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
      </div>
    </div>
  );
}
