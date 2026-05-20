import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, ContactShadows } from "@react-three/drei";
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
import { GroundPlane } from "./GroundPlane";
import { MoveableCursor } from "./MoveableCursor";
import { JumpToTop } from "./JumpToTop";
import { RoomHUD } from "./RoomHUD";
import { track } from "./analytics";
import { SignatureCapture } from "./SignatureCapture";
// Signature canvas + replay now live in the Footer (see
// src/portfolio/Footer.tsx). The hero scene is on a clean white-grey
// plane — the signature acts as a sign-off in the footer instead of
// a hero-band texture.
import {
  AssemblyProvider,
  AssemblyHUDSlot,
  AssemblyWireframesSlot,
} from "./loading";
import { ScrollCamera } from "./ScrollCamera";
import { PortfolioSections } from "./portfolio/PortfolioSections";
import { useScrollProgress } from "./useScrollProgress";
import { useIsMobile } from "./useIsMobile";
import { StatusBar } from "./StatusBar";
import { ScrollRail } from "./ScrollRail";

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
   * page is to scroll, so we use that as the start signal. Keydown
   * was previously also a trigger (so any key press could "enter"
   * the page); removed because it was firing on incidental key
   * presses (DevTools shortcuts, browser hotkeys) before the user
   * had actually decided to engage. */
  useEffect(() => {
    if (transitionStarted) return;
    const fire = () => {
      if (!transitionStarted) startTransition();
    };
    const opts = { once: true, passive: true } as const;
    window.addEventListener("wheel", fire, opts);
    window.addEventListener("touchstart", fire, opts);
    window.addEventListener("scroll", fire, opts);
    return () => {
      window.removeEventListener("wheel", fire);
      window.removeEventListener("touchstart", fire);
      window.removeEventListener("scroll", fire);
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
  // Content opacity — sections (everything below hero) only fade in
  // AFTER the overlay panel has fully covered the right half. Earlier
  // tuning started the fade at shrinkT 0.7 (overlay only ~70% wide),
  // which let the section marker + heading appear over the still-
  // visible room geometry. Now we wait for the shrink to complete
  // (shrinkT === 1, i.e. scrollProgress >= SHRINK_DONE), then fade
  // content in over the next ~3.5% of scroll.
  const CONTENT_FADE_LENGTH = 0.035;
  const contentOpacity = clamp01(
    (scrollProgress - SHRINK_DONE) / CONTENT_FADE_LENGTH,
  );
  // Mobile: canvas does not shrink — it just fades out post-hero so
  // sections below get the full viewport width.
  const mobileFadeT = clamp01(
    (scrollProgress - MOBILE_FADE_AT) / (MOBILE_FADE_DONE - MOBILE_FADE_AT),
  );
  const mobileCanvasOpacity = 1 - mobileFadeT;

  // Publish content opacity as a CSS variable on the document root so
  // every non-hero section's .portfolio-col can read it without
  // prop-drilling.
  useEffect(() => {
    const value = isMobile ? "1" : String(contentOpacity);
    document.documentElement.style.setProperty("--content-opacity", value);
  }, [contentOpacity, isMobile]);

  // Force the page to start at the top on every load. Otherwise a
  // reload while scrolled into a section shows the orange loading
  // screen on top of mid-page content — looks broken because the
  // wireframes appear over the about / projects card. Disable the
  // browser's automatic scroll restoration and slam to 0 on mount.
  useEffect(() => {
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);
  }, []);

  // (loading-active class is managed by AssemblyController based on
  //  climaxDone — the proper source of truth. App-level toggle removed
  //  to stop the two effects from fighting and causing chrome
  //  contrast flicker.)

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
        {/* (Old 2D RiceDotsBg removed — rice dots now live on the
            3D GroundPlane with the cursor dissolve baked into the
            shader. Having both layered together caused the "old rice
            fading in occasionally" visual bug.) */}

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
              /* Soft cast-shadow projecting LEFT onto the canvas plus
                 a 1px walnut hairline at the boundary. Reads as a
                 physical card laid over the room instead of a CSS
                 paint cut. */
              boxShadow:
                "-1px 0 0 rgba(26, 23, 20, 0.10), -36px 0 64px -28px rgba(26, 23, 20, 0.30)",
              /* Soft inner left edge — a 24px-wide gradient bleed of
                 cream so the boundary doesn't read as a guillotine
                 cut on the canvas side either. */
              backgroundImage:
                "linear-gradient(to right, rgba(248, 246, 243, 0) 0%, var(--wrapper-bg) 36px)",
              backgroundRepeat: "no-repeat",
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
          <Canvas
            camera={{
              position: [START_POS.x, START_POS.y, START_POS.z],
              fov: START_FOV,
              // Near widened 0.1 → 1 (no scene geometry sits inside
              // distance 1 from camera — minDistance is 1.2 on orbit
              // controls). Far must cover the loading-screen cover
              // dome (sphereGeometry radius 60 centred at origin):
              // from START_POS at distance ~95, the back face of the
              // dome lands at ~155. Far = 180 leaves headroom. Depth
              // precision is fine despite the wide range because
              // `logarithmicDepthBuffer: true` is set on the renderer.
              near: 1,
              far: 180,
            }}
            // High-DPR screens already supersample — MSAA on top is
            // redundant cost. Pin DPR to 1.25 on mobile (cuts fragment
            // shader work nearly in half on 3× phones) and disable AA
            // when DPR is high enough that the extra sampling buys
            // nothing visually.
            dpr={isMobile ? [1, 1.25] : [1, 1.5]}
            gl={{
              antialias: (typeof window !== "undefined"
                ? window.devicePixelRatio < 1.5
                : true),
              alpha: true,
              toneMapping: THREE.ACESFilmicToneMapping,
              // Exposure lifted 0.8 → 1.0 so the scene reads brighter
              // and less moody — combined with the cooler/brighter
              // light colours in Lighting.tsx, removes the sunset
              // cast that made the room feel like dusk.
              toneMappingExposure: 1.0,
              powerPreference: "high-performance",
              // Z-fighting fix: with the iso camera composing many
              // nearly-coplanar surfaces (mirror against wall, cat on
              // bed, ContactShadow above plane), the standard 24-bit
              // depth buffer doesn't have enough precision spread over
              // the scene depth range. Logarithmic depth gives ~64-bit
              // equivalent precision distribution. GroundPlane.tsx's
              // custom ShaderMaterial includes the matching
              // logdepthbuf chunks so its sort order stays consistent.
              logarithmicDepthBuffer: true,
            }}
            onCreated={({ gl, camera }) => {
              gl.outputColorSpace = THREE.SRGBColorSpace;
              (
                gl as unknown as { useLegacyLights?: boolean }
              ).useLegacyLights = false;
              // Real shadow maps enabled — Lighting.tsx's directional
              // light casts onto the room (per-mesh castShadow set in
              // Room.tsx). drei ContactShadows still provides the soft
              // contact halo under the room. ShaderMaterial planes
              // don't natively receiveShadow, so the plane stays clean
              // (procedural dots). PCFShadowMap (not PCFSoft) — the
              // soft variant takes 9 samples per fragment for the
              // penumbra; we trade that for cheaper hard-edged PCF
              // since shadow blur is already provided by ContactShadows.
              gl.shadowMap.enabled = true;
              gl.shadowMap.type = THREE.PCFShadowMap;
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
                <GroundPlane />
                {/* Contact shadow ABOVE the plane (y > plane.y) so it
                    renders on the plane surface. Stronger opacity +
                    bigger spread because at iso projection / FOV 15°
                    the camera is far enough that a subtle shadow
                    disappears entirely. */}
                <ContactShadows
                  position={[0, 0.005, 0]}
                  opacity={0.85}
                  scale={16}
                  blur={3.0}
                  far={3.5}
                  resolution={256}
                  color="#0a0c10"
                />
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
        </div>

        {/* Orange ring + dot cursor with parallax trail. */}
        {roomLoaded && !isMobile && <MoveableCursor hot={moveableHover} />}

        <PortfolioSections />

        <RoomHUD
          onReset={resetRoom}
          visible={true}
          interactive={sceneReady}
        />

        <AssemblyHUDSlot />

        {/* TE-spec-sheet flourishes — only after the room loads. */}
        {sceneReady && !isMobile && (
          <>
            <StatusBar onReset={resetRoom} />
            <ScrollRail />
            <JumpToTop />
          </>
        )}
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
