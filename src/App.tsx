import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Physics } from "@react-three/rapier";
import * as THREE from "three";
import { Room } from "./Room";
import { Lighting } from "./Lighting";
import {
  IntroController,
  START_POS,
  START_FOV,
  START_LOOK_AT,
  END_LOOK_AT,
  ORBIT_MAX_DISTANCE,
} from "./IntroController";
import { SceneStateProvider } from "./SceneState";
import { MoveableCursor } from "./MoveableCursor";
import { startAmbience } from "./audio";
import { RoomHUD } from "./RoomHUD";
import { track } from "./analytics";
import { SignatureCanvas } from "./SignatureCanvas";
import { SignatureCapture } from "./SignatureCapture";
import { SignatureReplay } from "./SignatureReplay";
import {
  AssemblyProvider,
  AssemblyHUDSlot,
  AssemblyWireframesSlot,
} from "./loading";
import { ScrollCamera } from "./ScrollCamera";
import { PortfolioSections } from "./portfolio/PortfolioSections";
import { useScrollProgress } from "./useScrollProgress";

const SHRINK_AT = 0.06;
const SHRINK_DONE = 0.14;
const PINNED_WIDTH_VW = 50;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

export default function App() {
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("sign") === "1"
  ) {
    return <SignatureCapture />;
  }

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
  const scrollProgress = useScrollProgress();

  const startTransition = useCallback(() => {
    if (transitionStarted) return;
    setTransitionStarted(true);
    track("intro_started");
    startAmbience(0.22);
  }, [transitionStarted]);

  const completeTransition = useCallback(() => {
    sceneReadyRef.current = true;
    setSceneReady(true);
    track("room_entered");
  }, []);

  const resetRoom = useCallback(() => {
    track("room_reset");
    setMoveableHover(false);
    setRoomResetKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!sceneReady) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "KeyR" || e.repeat) return;
      if (e.ctrlKey || e.metaKey) return;
      const el = e.target;
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable || el.closest("input, textarea, select"))
      ) {
        return;
      }
      e.preventDefault();
      resetRoom();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [sceneReady, resetRoom]);

  const noopSetDeskViewActive = useCallback(() => {}, []);
  const noopStartDeskView = useCallback(() => {}, []);

  const shrinkT = clamp01(
    (scrollProgress - SHRINK_AT) / (SHRINK_DONE - SHRINK_AT),
  );
  const canvasWidthVw = lerp(100, PINNED_WIDTH_VW, shrinkT);

  return (
    <AssemblyProvider>
      <div
        style={{
          position: "relative",
          minHeight: "100vh",
          background: "var(--wrapper-bg)",
          cursor: "none",
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
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: `${canvasWidthVw}vw`,
            height: "100vh",
            transition: "width 350ms cubic-bezier(0.4, 0.2, 0.2, 1)",
            zIndex: 0,
          }}
        >
          <SignatureCanvas />
          <SignatureReplay trigger={sceneReady} delayMs={600} />
          <Canvas
            camera={{
              position: [START_POS.x, START_POS.y, START_POS.z],
              fov: START_FOV,
              near: 0.1,
              far: 200,
            }}
            gl={{
              antialias: true,
              alpha: true,
              toneMapping: THREE.ACESFilmicToneMapping,
              toneMappingExposure: 0.8,
            }}
            onCreated={({ gl, camera }) => {
              gl.outputColorSpace = THREE.SRGBColorSpace;
              (
                gl as unknown as { useLegacyLights?: boolean }
              ).useLegacyLights = false;
              gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
              gl.shadowMap.enabled = false;
              cameraRef.current = camera as THREE.PerspectiveCamera;
              camera.lookAt(START_LOOK_AT);
            }}
          >
            <SceneStateProvider
              value={{
                sceneReadyRef,
                deskViewActiveRef,
                setDeskViewActive: noopSetDeskViewActive,
                setMoveableHover,
                startDeskView: noopStartDeskView,
              }}
            >
              <AssemblyWireframesSlot />
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
                      target={[END_LOOK_AT.x, END_LOOK_AT.y, END_LOOK_AT.z]}
                      minDistance={1.2}
                      maxDistance={ORBIT_MAX_DISTANCE}
                      minPolarAngle={Math.PI * 0.1}
                      maxPolarAngle={Math.PI * 0.49}
                      enableDamping
                      dampingFactor={0.05}
                      rotateSpeed={0.36}
                      panSpeed={1.0}
                      mouseButtons={{
                        MIDDLE: THREE.MOUSE.ROTATE,
                        RIGHT: THREE.MOUSE.PAN,
                      }}
                      touches={{
                        TWO: THREE.TOUCH.DOLLY_PAN,
                      }}
                      enableZoom={false}
                      zoomToCursor={false}
                      enablePan
                    />
                    <ScrollCamera
                      cameraRef={cameraRef}
                      controlsRef={controlsRef}
                      progress={scrollProgress}
                    />
                  </>
                )}
              </Suspense>
            </SceneStateProvider>
          </Canvas>
          <MoveableCursor hot={moveableHover} />
        </div>

        <PortfolioSections />

        <RoomHUD
          onReset={resetRoom}
          visible={true}
          interactive={sceneReady}
        />

        <AssemblyHUDSlot />

        <div
          style={{
            position: "fixed",
            bottom: 32,
            left: "50%",
            transform: "translateX(-50%)",
            color: "var(--wrapper-ink)",
            textTransform: "uppercase",
            letterSpacing: "var(--tracking-widest)",
            fontSize: "var(--text-base)",
            fontFamily: "var(--font-mono)",
            opacity: transitionStarted ? 0 : 0.85,
            transition: "opacity 0.5s ease",
            pointerEvents: "none",
            userSelect: "none",
            zIndex: 30,
          }}
        >
          click to begin
        </div>
      </div>
    </AssemblyProvider>
  );
}
