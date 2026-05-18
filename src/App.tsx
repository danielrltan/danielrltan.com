import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Physics } from "@react-three/rapier";
import * as THREE from "three";
import { Room } from "./Room";
import { Lighting } from "./Lighting";
import { IntroController } from "./IntroController";
import { SceneStateProvider } from "./SceneState";
import { MoveableCursor } from "./MoveableCursor";
import { DeskViewController } from "./DeskViewController";
import { startAmbience } from "./audio";
import { LoadingScreen } from "./LoadingScreen";
import { RoomHUD } from "./RoomHUD";

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
 * Fullscreen overlay — the OS shown at full viewport size.
 *
 * Mounting (enter): atomic — overlay appears opaque the same React
 * commit that MonitorScreen unmounts, so the swap is instant at
 * the end of the toFullscreen camera dolly.
 *
 * Unmounting (exit): a brief opacity fade-out (~280 ms) BEFORE the
 * actual unmount. During that window, MonitorScreen has time to
 * re-render its drei `<Html>` portal + DesktopOS subtree, so the
 * user never sees a dark monitor flash between overlay-gone and
 * MonitorScreen-ready.
 */
function FullscreenOverlay({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [opaque, setOpaque] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      setOpaque(true);
    } else {
      setOpaque(false);
      const t = setTimeout(() => setMounted(false), 320);
      return () => clearTimeout(t);
    }
  }, [open]);
  if (!mounted) return null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 50,
        opacity: opaque ? 1 : 0,
        transition: "opacity 280ms ease",
        pointerEvents: opaque ? "auto" : "none",
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
        // Background color now lives on the wrapper (not the Canvas's
        // scene.background) so the giant "Daniel Tan" text below can
        // show through wherever the 3D scene is transparent.
        background: "#330a05",
        // Two zones: in the room, hide the system cursor and let our
        // custom ring/dot do the work. At the desk, the OS uses the
        // native cursor — our custom one is unmounted below.
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
      {/* Brand watermark — a giant "Daniel Tan" sits behind the canvas
          and bleeds off the viewport edges. Subtle warm amber tint at
          very low alpha so it reads as a watermark rather than copy.
          `pointerEvents: none` so 3D interactions pass through. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          userSelect: "none",
          overflow: "hidden",
        }}
        aria-hidden
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            // Tuned to keep the full wordmark on-screen at typical
            // desktop widths (~95% viewport at 1440px) with mild
            // bleed-off on ultra-wide; previous value (25vw / 380px
            // cap) was overflowing well past both edges.
            fontSize: "clamp(94px, 25vw, 410px)",
            fontWeight: 800,
            letterSpacing: "-0.08em",
            color: "rgba(255, 176, 119, 0.06)",
            whiteSpace: "nowrap",
            lineHeight: 1,
            // Optical centering: "Daniel" (6 chars) sits left of the
            // geometric mid-point while " Tan" (4 chars incl. space)
            // sits right, so when the room silhouette crops both
            // halves the visible mass on the right reads heavier.
            // Small leftward nudge counteracts the perception.
            transform: "translateX(-1.2%)",
          }}
        >
          Daniel Tan
        </span>
      </div>
      <Canvas
        camera={{
          position: [25, 25, 25],
          fov: 11,
          near: 0.1,
          far: 200,
        }}
        gl={{
          antialias: true,
          // Transparent canvas so the watermark above shows through.
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 0.8,
        }}
        onCreated={({ gl, camera }) => {
          // scene.background intentionally unset (null) — the wrapper
          // div carries the maroon, leaving the canvas itself
          // transparent so the watermark text reads through.
          gl.outputColorSpace = THREE.SRGBColorSpace;
          (gl as unknown as { useLegacyLights?: boolean }).useLegacyLights =
            false;
          // Cap DPR at 1.5 — retina screens drop 50%+ of GPU fill rate for
          // almost no perceptible difference at this art style.
          gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
          // Shadow maps are the single biggest perf cost; warm point-light
          // falloff is doing the visual job already.
          gl.shadowMap.enabled = false;
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

            {/* Post-processing removed — the bloom pass + extra
                render targets were a real per-frame cost for an
                effect the warm point-light falloff already implies. */}
          </Suspense>
        </SceneStateProvider>
      </Canvas>

      {!deskViewActive && <MoveableCursor hot={moveableHover} />}

      {/* Persistent room chrome: brand, reset, mouse controls.
          Hidden once the camera leaves the room (desk view / OS). */}
      {sceneReady && !deskViewActive && !osOpen && (
        <RoomHUD onReset={() => setRoomResetKey((k) => k + 1)} />
      )}

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
            color: "var(--hud-cream)",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            letterSpacing: "var(--tracking-wide)",
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
          bottom: 28,
          left: "50%",
          transform: "translateX(-50%)",
          color: "var(--hud-amber)",
          textShadow: "0 0 12px var(--hud-amber-soft)",
          textTransform: "uppercase",
          letterSpacing: "var(--tracking-widest)",
          fontSize: "var(--text-base)",
          fontFamily: "var(--font-mono)",
          opacity: transitionStarted ? 0 : 0.7,
          transition: "opacity 0.5s ease",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        click to begin
      </div>
    </div>
  );
}
