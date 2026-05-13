import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Physics } from "@react-three/rapier";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { Room } from "./Room";
import { Lighting } from "./Lighting";
import { IntroController } from "./IntroController";
import { SceneStateProvider } from "./SceneState";
import { MoveableCursor } from "./MoveableCursor";

export default function App() {
  const roomGroupRef = useRef<THREE.Group | null>(null);
  const sceneReadyRef = useRef(false);
  const isHoveringRef = useRef(false);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [transitionStarted, setTransitionStarted] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  const [moveableHover, setMoveableHover] = useState(false);

  const startTransition = useCallback(() => {
    if (!transitionStarted) setTransitionStarted(true);
  }, [transitionStarted]);

  const completeTransition = useCallback(() => {
    sceneReadyRef.current = true;
    setSceneReady(true);
  }, []);

  // While Shift is held, middle mouse switches from orbit -> pan.
  useEffect(() => {
    if (!sceneReady) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || !controlsRef.current) return;
      controlsRef.current.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Shift" || !controlsRef.current) return;
      controlsRef.current.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
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
          value={{ sceneReadyRef, setMoveableHover }}
        >
          <Suspense fallback={null}>
            <Lighting />
            <Physics gravity={[0, -9.81, 0]}>
              <Room roomGroupRef={roomGroupRef} />
            </Physics>
            <IntroController
              cameraRef={cameraRef}
              roomGroupRef={roomGroupRef}
              isHoveringRef={isHoveringRef}
              transitionStarted={transitionStarted}
              onComplete={completeTransition}
            />
            {sceneReady && (
              <OrbitControls
                ref={controlsRef}
                makeDefault
                target={[0, 0.8, 0]}
                minDistance={2}
                maxDistance={7}
                maxPolarAngle={Math.PI * 0.48}
                mouseButtons={{
                  LEFT: undefined as unknown as THREE.MOUSE,
                  MIDDLE: THREE.MOUSE.ROTATE,
                  RIGHT: THREE.MOUSE.PAN,
                }}
                touches={{
                  ONE: undefined as unknown as THREE.TOUCH,
                  TWO: THREE.TOUCH.DOLLY_ROTATE,
                }}
                enableZoom
                zoomSpeed={0.8}
                enablePan
                panSpeed={0.6}
              />
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
