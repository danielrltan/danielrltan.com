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
import { useIsMobile } from "./useIsMobile";

// Canvas shrink window — tightened so the room is at 50vw BEFORE the
// about-section content enters the viewport. Previous window (0.06 →
// 0.14) left the canvas at ~73vw at scroll progress 0.10, which is
// where the about marker was already rendering — the section number
// landed on top of the bed/chair and read as broken layout.
const SHRINK_AT = 0.015;
const SHRINK_DONE = 0.07;
const PINNED_WIDTH_VW = 50;
// Mobile: canvas pins to the top half of the viewport during the hero,
// then fades out as the user scrolls into the first section so portfolio
// content occupies the full width below.
const MOBILE_FADE_AT = 0.04;
const MOBILE_FADE_DONE = 0.12;

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
  // Set once Room finishes loading (post-Suspense). Drives the signature
  // replay independently of the intro tilt — the signature should play
  // automatically when the room appears, not wait for a user gesture.
  const [roomLoaded, setRoomLoaded] = useState(false);
  const [moveableHover, setMoveableHover] = useState(false);
  const [roomResetKey, setRoomResetKey] = useState(0);
  const scrollProgress = useScrollProgress();
  const isMobile = useIsMobile();

  const startTransition = useCallback(() => {
    if (transitionStarted) return;
    setTransitionStarted(true);
    track("intro_started");
    // Audio no longer auto-starts here — it's gated behind the
    // explicit mute toggle in RoomHUD which defaults to OFF.
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

  /* First scroll / wheel / touch input triggers the intro tilt. No
   * more "click to begin" gate — the natural impulse on a portfolio
   * page is to scroll, so we use that as the start signal. */
  useEffect(() => {
    if (transitionStarted) return;
    const fire = () => {
      if (!transitionStarted) startTransition();
    };
    const opts = { once: true, passive: true } as const;
    window.addEventListener("wheel", fire, opts);
    window.addEventListener("touchstart", fire, opts);
    window.addEventListener("scroll", fire, opts);
    window.addEventListener("keydown", fire, opts);
    return () => {
      window.removeEventListener("wheel", fire);
      window.removeEventListener("touchstart", fire);
      window.removeEventListener("scroll", fire);
      window.removeEventListener("keydown", fire);
    };
  }, [transitionStarted, startTransition]);

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
  // Right-side overlay width — grows from 0 to (100-PINNED)vw as the
  // user scrolls, "covering" the right portion of the (always full-
  // width) canvas with the wrapper-bg colour. Replaces the previous
  // CSS width-resize on the canvas wrapper, which forced Three.js to
  // recompute the renderer + camera projection every scroll frame →
  // visible snap.
  const overlayWidthVw = lerp(0, 100 - PINNED_WIDTH_VW, shrinkT);
  // Mobile: canvas does not shrink — it just fades out post-hero so
  // sections below get the full viewport width.
  const mobileFadeT = clamp01(
    (scrollProgress - MOBILE_FADE_AT) / (MOBILE_FADE_DONE - MOBILE_FADE_AT),
  );
  const mobileCanvasOpacity = 1 - mobileFadeT;

  return (
    <AssemblyProvider>
      <div
        style={{
          position: "relative",
          minHeight: "100vh",
          background: "var(--wrapper-bg)",
          cursor: "none",
        }}
        onPointerEnter={() => {
          isHoveringRef.current = true;
        }}
        onPointerLeave={() => {
          isHoveringRef.current = false;
          setMoveableHover(false);
        }}
      >
        {/* Right-side overlay panel that grows from 0 to (100-PINNED)vw
            as the user scrolls. Sits ABOVE the canvas and OPAQUE in
            wrapper-bg colour so it visually "covers" the right portion
            of the (always full-width) canvas. The portfolio sections
            then render on top of this overlay. Replaces the previous
            approach of resizing the Canvas wrapper width on scroll —
            that forced Three.js to recompute renderer.setSize +
            projection matrix every frame, which is the source of the
            visible scroll snap. */}
        {!isMobile && (
          <div
            aria-hidden
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              width: `${overlayWidthVw}vw`,
              height: "100vh",
              background: "var(--wrapper-bg)",
              zIndex: 1,
              pointerEvents: "none",
            }}
          />
        )}
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            // Canvas wrapper is now ALWAYS full-width (or full mobile
            // band). The right portion is visually covered by the
            // overlay panel above. This stops Three.js from running
            // its internal resize observer on every scroll frame.
            width: isMobile ? "100vw" : "100vw",
            height: isMobile ? "55vh" : "100vh",
            opacity: isMobile ? mobileCanvasOpacity : 1,
            pointerEvents: isMobile && mobileCanvasOpacity < 0.05 ? "none" : "auto",
            zIndex: 0,
          }}
        >
          <SignatureCanvas />
          {/* Signature plays as soon as the room mesh streams in — no
              longer waits for the intro tilt / scroll. */}
          <SignatureReplay trigger={roomLoaded} delayMs={400} />
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
                <RoomLoadedSignal onLoaded={() => setRoomLoaded(true)} />
                <Lighting />
                {/* Mobile: keep the Physics provider mounted (Room's
                    <RigidBody>s require it) but pause the sim — near-zero
                    CPU, and drag/throw on touch is awkward anyway. */}
                <Physics
                  paused={isMobile}
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
      </div>
    </AssemblyProvider>
  );
}

/** Renders nothing; just calls onLoaded once it mounts. Because it's a
 *  child of <Suspense> alongside <Room>, it only mounts after the GLB
 *  has streamed in and Room's useGLTF has resolved — which is what we
 *  want for "the room is on screen now, play the signature." */
function RoomLoadedSignal({ onLoaded }: { onLoaded: () => void }) {
  useEffect(() => {
    onLoaded();
  }, [onLoaded]);
  return null;
}
