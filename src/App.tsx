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

export default function App() {
  const roomGroupRef = useRef<THREE.Group | null>(null);
  const sceneReadyRef = useRef(false);
  const isHoveringRef = useRef(false);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [transitionStarted, setTransitionStarted] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [moveableHover, setMoveableHover] = useState(false);
  const [roomResetKey, setRoomResetKey] = useState(0);
  const deskViewImplRef = useRef<(() => void) | null>(null);
  const startDeskView = useCallback(() => deskViewImplRef.current?.(), []);

  const startTransition = useCallback(() => {
    if (!transitionStarted) setTransitionStarted(true);
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
        shadows
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
          // Single perspective camera throughout: starts at [20,20,20] with
          // FOV 8 (looks identical to ortho) and smoothly lerps to
          // [3.5,2.5,3.5] FOV 50 on the click transition — no swap.
          cameraRef.current = camera as THREE.PerspectiveCamera;
          camera.lookAt(0, 0.6, 0);
        }}
      >
        <SceneStateProvider
          value={{ sceneReadyRef, setMoveableHover, startDeskView }}
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
                  maxDistance={7}
                  maxPolarAngle={Math.PI * 0.48}
                  enableDamping={false}
                  rotateSpeed={0.36}
                  panSpeed={0.65}
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
                  zoomSpeed={0.8}
                  enablePan
                />
                <DeskViewController implRef={deskViewImplRef} />
              </>
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
