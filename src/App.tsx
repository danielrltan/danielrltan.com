import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
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
import { LoadingScreen } from "./LoadingScreen";
import { Monitor } from "lucide-react";

// Lazy-load everything OS-related — none of it renders until the camera
// is seated at the desk, so its code (~hundreds of kB before splitting)
// stays out of the first paint. While the camera is in free-orbit the
// browser keeps idle on this bundle entirely.
const DesktopOS = lazy(() =>
  import("./desktop").then((m) => ({ default: m.DesktopOS })),
);
const BootSequence = lazy(() =>
  import("./desktop/BootSequence").then((m) => ({ default: m.BootSequence })),
);
const MonitorScreen = lazy(() =>
  import("./MonitorScreen").then((m) => ({ default: m.MonitorScreen })),
);

/**
 * Fullscreen overlay — the OS shown at full viewport size. The actual
 * zoom-in is performed by `DeskViewController.toFullscreen` (a 3D
 * camera dolly into the monitor mesh); App only mounts this overlay
 * once the camera has arrived.
 *
 * Mounts INSTANTLY (no fade) so it's atomically swapped with the
 * drei-Html-rendered OS that was on the monitor: in the same React
 * commit, `MonitorScreen` unmounts and this overlay appears at full
 * opacity. The old fade-in introduced ~200 ms where neither was
 * visible, which read as a black-monitor "snap."
 */
function FullscreenOverlay({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
      }}
    >
      <Suspense fallback={null}>{children}</Suspense>
    </div>
  );
}

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
  const fullscreenImplRef = useRef<{
    toFullscreen: (onArrive: () => void) => void;
    fromFullscreen: (onArrive?: () => void) => void;
  } | null>(null);
  // Latch that's true while a fullscreen camera lerp + overlay swap is
  // in flight. Without it, hammering the widget interleaves multiple
  // toggle attempts: DeskViewController bails on the second click
  // (anim is busy) but App's React state can still flip, leaving the
  // camera at the fullscreen pose with no overlay mounted — reads as
  // a black screen because the drei Html plane fills the viewport
  // and the surrounding scene is occluded.
  const cameraBusyRef = useRef(false);
  // True while the camera is mid-fromDesk lerp on the way out. Used
  // to fade the monitor-mounted OS to black like a real screen
  // going to sleep, before MonitorScreen unmounts at the end of the
  // lerp.
  const [sleeping, setSleeping] = useState(false);
  // Reset the sleep flag once the camera has fully landed back in
  // the room (deskViewActive flips false at end of fromDesk).
  useEffect(() => {
    if (!deskViewActive) setSleeping(false);
  }, [deskViewActive]);
  // Boot sequence plays the first time the user sits at the desk per
  // session. Subsequent re-entries skip it (the OS just fades in).
  const [hasBooted, setHasBooted] = useState(false);
  useEffect(() => {
    if (deskViewActive && !hasBooted) {
      // We're sitting at the desk for the first time. Mark booted so
      // future desk-view entries skip the BootSequence.
      // (Actual boot ticking happens inside the BootSequence comp.)
      const t = setTimeout(() => setHasBooted(true), 3200);
      return () => clearTimeout(t);
    }
  }, [deskViewActive, hasBooted]);

  // Synthesised Escape lets the in-OS "room" button reuse the same
  // fromDesk transition the keyboard handler in DeskViewController
  // already runs.
  const backToRoom = useCallback(() => {
    if (cameraBusyRef.current) return;
    const goRoom = () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    };
    if (osOpen) {
      cameraBusyRef.current = true;
      // Unmount overlay first so the dolly is actually visible —
      // then run fromFullscreen, then trigger the fromDesk return.
      setOsOpen(false);
      requestAnimationFrame(() => {
        fullscreenImplRef.current?.fromFullscreen(() => {
          cameraBusyRef.current = false;
          goRoom();
        });
      });
    } else {
      goRoom();
    }
  }, [osOpen]);

  const toggleFullscreen = useCallback(() => {
    if (cameraBusyRef.current) return;
    if (!osOpen) {
      cameraBusyRef.current = true;
      // Keep MonitorScreen mounted during the entire dolly so the
      // OS visibly grows with the camera. The fullscreen overlay
      // takes over instantly at the END of the lerp.
      fullscreenImplRef.current?.toFullscreen(() => {
        setOsOpen(true);
        cameraBusyRef.current = false;
      });
    } else {
      cameraBusyRef.current = true;
      // Unmount the fullscreen overlay FIRST so the user actually
      // sees the camera dolly back to the seated pose. If we leave
      // the overlay up during the lerp, it covers the viewport and
      // the zoom-out is invisible — the visual effect of the
      // overlay simply disappearing at the end reads as "we just
      // deleted it" with no zoom feedback.
      setOsOpen(false);
      requestAnimationFrame(() => {
        fullscreenImplRef.current?.fromFullscreen(() => {
          cameraBusyRef.current = false;
        });
      });
    }
  }, [osOpen]);

  useEffect(() => {
    const onResize = () =>
      setOsSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Keyboard shortcuts while at the desk:
  //   F      → enter fullscreen (seated, not already fullscreen)
  //   Escape → from fullscreen, take user all the way back to room
  //            (intercepts in capture phase + stopImmediatePropagation
  //             so DeskViewController's own Escape handler doesn't
  //             race us and start a half-sequence fromDesk lerp).
  useEffect(() => {
    if (!sceneReady) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (
        el instanceof HTMLElement &&
        (el.isContentEditable ||
          el.closest("input, textarea, select, [contenteditable='true']"))
      ) {
        return;
      }
      if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (deskViewActive && !osOpen) {
          e.preventDefault();
          toggleFullscreen();
        }
      } else if (e.code === "Escape" && osOpen) {
        e.preventDefault();
        e.stopImmediatePropagation();
        backToRoom();
      } else if (e.code === "Escape" && deskViewActive && !osOpen) {
        // Don't stop — DeskViewController's bubble-phase Escape
        // handler still needs to fire fromDesk. Just trip the
        // sleeping flag so the monitor OS fades to black during the
        // lerp out.
        setSleeping(true);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [sceneReady, osOpen, deskViewActive, toggleFullscreen, backToRoom]);

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

  // Once the intro lands, kick off the OS chunk downloads so they're
  // already cached when the user clicks the desk. Without this, the
  // dark-monitor → boot-screen transition has a 100-500 ms gap while
  // the chunks stream in (visible as a black flash).
  useEffect(() => {
    if (!sceneReady) return;
    void import("./desktop");
    void import("./desktop/BootSequence");
    void import("./MonitorScreen");
  }, [sceneReady]);

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
        // Two zones: in the room, hide the system cursor and let our
        // custom ring/dot do the work. At the desk, the OS uses the
        // native cursor — our custom one is unmounted below.
        // Always hide the OS cursor whenever the custom MoveableCursor
        // is mounted (room view, any phase). Desk view restores the
        // system cursor so the OS HTML overlay is usable normally.
        cursor: deskViewActive ? "auto" : "none",
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
                <DeskViewController
                  implRef={deskViewImplRef}
                  fullscreenImplRef={fullscreenImplRef}
                />
              </>
            )}

            {/* DesktopOS rendered onto the actual monitor surface in 3D.
                Only mounted while the user is seated at the desk — the
                CSS-3D plane clips through scene meshes from off-axis
                angles, so the computer effectively "goes to sleep" when
                Escape returns the camera to free-orbit. */}
            {sceneReady && deskViewActive && !osOpen && (
              // Nested Suspense so the OS lazy-chunk's brief
              // suspend-on-mount doesn't tear down the outer scene.
              // Unmounted entirely while the fullscreen overlay is
              // up — otherwise two DesktopOS instances run side by
              // side (double Spotify, double Weather fetch, etc.)
              // and the monitor-mounted one bleeds through the
              // overlay's transparent rounded corners.
              <Suspense fallback={null}>
                <MonitorScreen>
                  {/* `sleeping` wrapper — fades the OS to black like
                      a screen powering off as the camera lerps back
                      to the room. The wrapper has its own black bg
                      so the unmount at end of lerp is invisible. */}
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      background: "#000",
                      opacity: sleeping ? 0 : 1,
                      transition: "opacity 1.2s ease",
                    }}
                  >
                    {hasBooted ? (
                      <DesktopOS
                        width={1100}
                        height={660}
                        isFullscreen={osOpen}
                        onToggleFullscreen={toggleFullscreen}
                        onBackToRoom={backToRoom}
                      />
                    ) : (
                      <BootSequence width={1100} height={660}>
                        <DesktopOS
                          width={1100}
                          height={660}
                          isFullscreen={osOpen}
                          onToggleFullscreen={toggleFullscreen}
                          onBackToRoom={backToRoom}
                        />
                      </BootSequence>
                    )}
                  </div>
                </MonitorScreen>
              </Suspense>
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

      {!deskViewActive && <MoveableCursor hot={moveableHover} />}

      {/* Hint banner — appears centered at top of viewport. */}
      {sceneReady && (deskViewActive || osOpen) && !sleeping && (
        <div
          style={{
            position: "fixed",
            top: 24,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            padding: "8px 14px",
            background: "rgba(20, 18, 16, 0.65)",
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            borderRadius: 8,
            color: "#f0e0d0",
            fontFamily:
              'ui-monospace, "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace',
            fontSize: 11,
            letterSpacing: 2,
            textTransform: "uppercase",
            pointerEvents: "none",
            opacity: 0.9,
            transition: "opacity 0.3s ease",
          }}
        >
          {osOpen
            ? "press esc to return to room"
            : "press f to fullscreen"}
        </div>
      )}

      <LoadingScreen />

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

      {/* Fullscreen DesktopOS — rendered at full window dimensions so
          icons / widgets / paint canvas all reflow to use the
          available space. */}
      <FullscreenOverlay open={osOpen}>
        <DesktopOS
          width={osSize.w}
          height={osSize.h}
          isFullscreen={true}
          onToggleFullscreen={toggleFullscreen}
          onBackToRoom={backToRoom}
        />
      </FullscreenOverlay>

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
