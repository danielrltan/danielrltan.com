import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
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
import { DeskViewController } from "./DeskViewController";
import { startAmbience } from "./audio";
import { CorruptionOverlay } from "./CorruptionOverlay";
import { RoomHUD } from "./RoomHUD";
import { track } from "./analytics";
import {
  AssemblyProvider,
  AssemblyHUDSlot,
  AssemblyWireframesSlot,
} from "./loading";

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
  const startDeskView = useCallback(() => {
    track("desk_seated");
    deskViewImplRef.current?.();
  }, []);
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
  // Flag set right before we re-dispatch a synthetic Escape after the
  // sleep-to-black fade. On that follow-up event the capture handler
  // sees the flag, clears it, and bails out so the Escape propagates
  // normally to DeskViewController (which runs the zoom-out lerp).
  const sleepDispatchRef = useRef(false);
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
  // Corruption → OS handoff. Bumping wipe `id` triggers the radial
  // wipe; bumping reverse `id` triggers the full rewind. `osOpen`
  // (the desk-view fullscreen flag) and `corruptionOsOpen` are
  // intentionally separate so the two entry paths don't tangle.
  const wipeIdRef = useRef(0);
  const reverseIdRef = useRef(0);
  const [wipeRequest, setWipeRequest] = useState<{ id: number } | null>(null);
  const [reverseRequest, setReverseRequest] = useState<{ id: number } | null>(
    null,
  );
  const [corruptionOsOpen, setCorruptionOsOpen] = useState(false);
  // Scroll-prompt visibility — flips true on first wheel event after
  // intro lands; reset back to false when a full reverse completes,
  // so a returning user sees the affordance again.
  const [hasScrolled, setHasScrolled] = useState(false);

  const handleBootReady = useCallback(() => {
    setTimeout(() => {
      wipeIdRef.current += 1;
      setWipeRequest({ id: wipeIdRef.current });
    }, 300);
  }, []);
  const handleWipeComplete = useCallback(() => {
    setCorruptionOsOpen(true);
    track("os_opened");
  }, []);
  const startCorruptionReverse = useCallback(() => {
    // Idempotent — once a reverse is in flight, further ESC presses
    // or "back to room" clicks are no-ops until it completes.
    if (reverseRequest) return;
    reverseIdRef.current += 1;
    setReverseRequest({ id: reverseIdRef.current });
    track("os_closed");
  }, [reverseRequest]);
  // Fires when phase A (un-wipe) finishes — canvas is fully solid
  // BOOT_BG, safe to drop the OS panel without exposing the room.
  const handleReverseUnwipeComplete = useCallback(() => {
    setCorruptionOsOpen(false);
    setWipeRequest(null);
  }, []);
  // Full reverse complete — overlay is idle again, allow scrolling.
  // Note: `hasScrolled` stays true — once the user has discovered the
  // affordance, no need to nag again on return trips.
  const handleReverseComplete = useCallback(() => {
    setReverseRequest(null);
  }, []);

  // Boot sequence plays the first time the user reaches the OS by
  // either entry path (seated desk view OR corruption wipe). After
  // that the OS just fades in without the cat + bar.
  const [hasBooted, setHasBooted] = useState(false);
  useEffect(() => {
    if ((deskViewActive || corruptionOsOpen) && !hasBooted) {
      const t = setTimeout(() => setHasBooted(true), 3200);
      return () => clearTimeout(t);
    }
  }, [deskViewActive, corruptionOsOpen, hasBooted]);

  // Scroll-prompt tracker — first wheel event after intro lands hides
  // the affordance. Re-armed by handleReverseComplete on round trip.
  useEffect(() => {
    if (!sceneReady || hasScrolled) return;
    const onWheel = () => {
      setHasScrolled(true);
      track("corruption_started");
    };
    window.addEventListener("wheel", onWheel, { passive: true, once: true });
    return () => window.removeEventListener("wheel", onWheel);
  }, [sceneReady, hasScrolled]);

  // Synthesised Escape lets the in-OS "room" button reuse the same
  // fromDesk transition the keyboard handler in DeskViewController
  // already runs.
  // Pause the camera in the seated pose after `fromFullscreen` lands,
  // before triggering the room zoom-out. The OS chunk re-mounts on the
  // monitor surface during the fullscreen overlay teardown, and
  // `deskViewActive` flipping in the fromDesk lerp causes more React
  // work — letting the camera sit still for ~700ms means all that
  // reconciliation lands on stationary frames instead of stuttering
  // the zoom-out itself.
  const FROM_FULLSCREEN_SETTLE_MS = 700;
  // Monitor sleep-to-black fade duration. MUST match the CSS transition
  // on the `sleeping` wrapper below (`opacity 1.2s ease`) — that's the
  // visual "monitor powering off" cue. We hold the Escape event for
  // this long before letting DeskViewController run the zoom-out, so
  // the screen goes dark first and the zoom-out only starts on the
  // empty monitor instead of fighting the fade for attention.
  const SLEEP_FADE_MS = 1200;

  const backToRoom = useCallback(() => {
    if (cameraBusyRef.current) return;
    const goRoom = () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    };
    if (osOpen) {
      cameraBusyRef.current = true;
      // Unmount overlay first so the dolly is actually visible —
      // then run fromFullscreen, settle in the seated pose, then
      // trigger the fromDesk return.
      setOsOpen(false);
      requestAnimationFrame(() => {
        fullscreenImplRef.current?.fromFullscreen(() => {
          // Hold `cameraBusyRef` true through the settle so re-presses
          // of Escape don't try to start another transition mid-pause.
          setTimeout(() => {
            cameraBusyRef.current = false;
            goRoom();
          }, FROM_FULLSCREEN_SETTLE_MS);
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
        // Re-dispatched event after the sleep fade — let it through
        // to DeskViewController so fromDesk can finally run.
        if (sleepDispatchRef.current) {
          sleepDispatchRef.current = false;
          return;
        }
        // Sleep fade already in flight from a previous press — swallow
        // additional presses so we don't stack timers / re-dispatches.
        if (sleeping) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        // First press: hold the event, fade the monitor to black,
        // THEN re-dispatch so the zoom-out doesn't compete with the
        // fade for visual attention. User reads it as "screen powers
        // off → camera pulls back" instead of the two motions
        // overlapping and reading as laggy.
        e.preventDefault();
        e.stopImmediatePropagation();
        setSleeping(true);
        setTimeout(() => {
          sleepDispatchRef.current = true;
          window.dispatchEvent(
            new KeyboardEvent("keydown", { code: "Escape" }),
          );
        }, SLEEP_FADE_MS);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [
    sceneReady,
    osOpen,
    deskViewActive,
    toggleFullscreen,
    backToRoom,
    sleeping,
    SLEEP_FADE_MS,
    corruptionOsOpen,
    startCorruptionReverse,
  ]);

  const startTransition = useCallback(() => {
    if (transitionStarted) return;
    setTransitionStarted(true);
    track("intro_started");
    // First user gesture — unlocks audio and starts the ambient loop.
    startAmbience(0.22);
  }, [transitionStarted]);

  // Snapshot of the post-intro camera pose — explicitly captured the
  // moment the intro dolly completes, so `resetRoom` has an unambiguous
  // pose to lerp back to (more reliable than `OrbitControls.position0`,
  // which gets captured during a React re-render commit and can be off
  // by a frame or two of orbit damping).
  const resetPoseRef = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  const resetAnimRef = useRef<number>(0);

  const completeTransition = useCallback(() => {
    sceneReadyRef.current = true;
    setSceneReady(true);
    track("room_entered");
    const camera = cameraRef.current;
    if (camera) {
      resetPoseRef.current = {
        position: camera.position.clone(),
        // Matches the OrbitControls `target` prop below.
        target: END_LOOK_AT.clone(),
      };
    }
  }, []);

  // Full reset: smoothly glide the camera back to its post-intro
  // framing FIRST, then remount the Room (physics + draggable
  // positions) at the end of the lerp. The Room remount is a heavy
  // React reconciliation (~50-150ms) — landing it on a still frame
  // after the camera has stopped moving is dramatically less
  // perceptible than letting it stutter the camera glide.
  const resetRoom = useCallback(() => {
    track("room_reset");
    setMoveableHover(false);

    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const pose = resetPoseRef.current;
    // Without a camera/pose to lerp to (e.g. reset pressed before
    // intro complete), just do the remount immediately.
    if (!camera || !controls || !pose) {
      setRoomResetKey((k) => k + 1);
      return;
    }

    if (resetAnimRef.current) {
      cancelAnimationFrame(resetAnimRef.current);
      resetAnimRef.current = 0;
    }

    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const startTime = performance.now();
    const duration = 1200;

    controls.enabled = false;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      // ease-out cubic — fast start, soft landing.
      const eased = 1 - Math.pow(1 - t, 3);

      camera.position.lerpVectors(startPos, pose.position, eased);
      controls.target.lerpVectors(startTarget, pose.target, eased);
      camera.lookAt(controls.target);

      if (t < 1) {
        resetAnimRef.current = requestAnimationFrame(tick);
      } else {
        controls.enabled = true;
        // Sync OrbitControls' internal spherical state to the new
        // position/target so the next drag starts from the right place.
        controls.update();
        resetAnimRef.current = 0;
        // Camera has landed — NOW do the heavy Room remount. The
        // reconciliation spike lands on a still frame instead of
        // stuttering the camera glide.
        setRoomResetKey((k) => k + 1);
      }
    };

    resetAnimRef.current = requestAnimationFrame(tick);
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
      resetRoom();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [sceneReady, resetRoom]);

  return (
    <AssemblyProvider>
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
          // Initial iso preview pose — kept in sync with IntroController
          // via shared exports. Don't hardcode values here; the intro
          // lerp reads from the same constants.
          position: [START_POS.x, START_POS.y, START_POS.z],
          fov: START_FOV,
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
          camera.lookAt(START_LOOK_AT);
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
                  // Matches `IntroController.END_LOOK_AT` exactly — if
                  // these two differ, OrbitControls re-orients the
                  // camera the instant it takes over and the user sees
                  // a snap at the end of the intro lerp.
                  target={[END_LOOK_AT.x, END_LOOK_AT.y, END_LOOK_AT.z]}
                  minDistance={1.2}
                  // Derived from END_POS/END_LOOK_AT in IntroController.
                  // Auto-tracks any future change to those vectors so
                  // the post-intro snap-clamp bug can't recur.
                  maxDistance={ORBIT_MAX_DISTANCE}
                  minPolarAngle={Math.PI * 0.1}
                  // 0.5π is the equator (camera level with target). Capping
                  // just above that keeps the orbit from dipping under the
                  // room and exposing the empty undersides of the floor /
                  // furniture.
                  maxPolarAngle={Math.PI * 0.49}
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
                  // Scroll-to-zoom is OFF — the wheel is now reserved
                  // for the corruption transition (CorruptionOverlay).
                  // Re-enable if you re-add traditional zoom controls.
                  enableZoom={false}
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
          Mounted whenever the scene is ready; the `visible` prop drives
          a fade in/out as the camera enters or leaves the room (rather
          than the HUD popping in/out when the gating condition flips).

          Always mounted — the brand mark is visible during the iso
          pre-view phase too. `interactive` flips once the intro lands,
          which fades in the reset + mouse-hint controls. */}
      <RoomHUD
        onReset={resetRoom}
        visible={!deskViewActive && !osOpen}
        interactive={sceneReady}
      />

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

      {/* Scroll-driven corruption transition. Dormant until the intro
          lerp completes (sceneReady); after that, scrolling the wheel
          fills the screen with warm-palette character blocks rising
          from the bottom. Room stays fully interactive behind it
          during phase 1. Reaches full opacity at progress = 1.0,
          where (in a later phase) it'll snap into the danny.exe OS. */}
      <CorruptionOverlay
        active={sceneReady}
        wipeRequest={wipeRequest}
        reverseRequest={reverseRequest}
        onBootReady={handleBootReady}
        onWipeComplete={handleWipeComplete}
        onReverseUnwipeComplete={handleReverseUnwipeComplete}
        onReverseComplete={handleReverseComplete}
      />

      {/* Corruption-path OS panel — mounts as soon as `wipeRequest`
          is set so the radial wipe has actual content to reveal
          (BootSequence cat on first entry, DesktopOS thereafter).
          `corruptionOsOpen` gates *interactivity* only, flipping true
          on wipe-complete. Panel unmounts when reverse's phase A
          completes (handleReverseUnwipeComplete clears wipeRequest). */}
      {sceneReady && wipeRequest && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 35,
            background: "#1a1714",
            // Block pointer events until the wipe has fully revealed
            // the OS, and again once a reverse is in flight — clicks
            // shouldn't fall through onto the OS while the canvas is
            // covering it.
            pointerEvents:
              corruptionOsOpen && !reverseRequest ? "auto" : "none",
          }}
        >
          <Suspense fallback={null}>
            {hasBooted ? (
              <DesktopOS
                width={osSize.w}
                height={osSize.h}
                isFullscreen={true}
                onToggleFullscreen={() => {}}
                onBackToRoom={startCorruptionReverse}
              />
            ) : (
              <BootSequence width={osSize.w} height={osSize.h}>
                <DesktopOS
                  width={osSize.w}
                  height={osSize.h}
                  isFullscreen={true}
                  onToggleFullscreen={() => {}}
                  onBackToRoom={startCorruptionReverse}
                />
              </BootSequence>
            )}
          </Suspense>
        </div>
      )}

      {/* Scroll-prompt — subtle bottom-center hint visible while the
          user is in the room and hasn't started corrupting yet. The
          animated mouse-wheel dot signals "there's more here" without
          dictating that they must scroll first. */}
      {sceneReady && !hasScrolled && !wipeRequest && !deskViewActive && (
        <div
          style={{
            position: "fixed",
            bottom: 36,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 60,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            color: "var(--hud-cream, #e0d8cc)",
            opacity: 0.78,
            pointerEvents: "none",
            userSelect: "none",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm, 12px)",
            letterSpacing: "var(--tracking-wide, 0.08em)",
            textTransform: "uppercase",
          }}
          aria-hidden
        >
          <style>
            {`@keyframes scrollDotBounce {
              0%   { transform: translateY(-7px); opacity: 0; }
              25%  { transform: translateY(-7px); opacity: 1; }
              70%  { transform: translateY(7px);  opacity: 1; }
              100% { transform: translateY(7px);  opacity: 0; }
            }`}
          </style>
          <svg
            width="26"
            height="40"
            viewBox="0 0 26 40"
            fill="none"
            aria-hidden
          >
            <rect
              x="2"
              y="2"
              width="22"
              height="36"
              rx="11"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <circle
              cx="13"
              cy="14"
              r="2.2"
              fill="currentColor"
              style={{
                animation: "scrollDotBounce 1.8s ease-in-out infinite",
                transformOrigin: "center",
              }}
            />
          </svg>
          <div>scroll to learn more</div>
        </div>
      )}

      <AssemblyHUDSlot />

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
    </AssemblyProvider>
  );
}
