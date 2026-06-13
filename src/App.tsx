import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import type { RootState } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import {
  END_POS,
  END_FOV,
  END_LOOK_AT,
  ORBIT_MAX_DISTANCE,
} from "./IntroController";
import { GroundPlane } from "./GroundPlane";
import { MoveableCursor } from "./MoveableCursor";
import { JumpToTop } from "./JumpToTop";
import { RoomHUD } from "./RoomHUD";
import { track } from "./analytics";
// Dev-only signature capture tool (reachable only via ?sign=1). Lazy so its
// code never ships in the main bundle for normal visitors.
const SignatureCapture = lazy(() =>
  import("./SignatureCapture").then((m) => ({ default: m.SignatureCapture })),
);
// Room is lazy so its GLB-loading chunk streams in just after the hero
// paints (the room itself still gates on the GLB download, which
// index.html preloads). The room is now a static baked diorama - no
// physics, so the heavy rapier WASM payload is gone entirely.
const Room = lazy(() => import("./Room").then((m) => ({ default: m.Room })));
import { AssemblyProvider } from "./loading";
import { HeroSignature } from "./hero/HeroSignature";
import { ScrollWireframeRoom } from "./loading/ScrollWireframeRoom";
import { ScrollCamera } from "./ScrollCamera";
import { PortfolioSections } from "./portfolio/PortfolioSections";
import { useIsMobile } from "./useIsMobile";
import { StatusBar } from "./StatusBar";

// Mobile hero canvas fades over scroll-pixels relative to viewport
// height so total page height changes don't shift the window.
const MOBILE_FADE_START_VH = 0.55;
const MOBILE_FADE_END_VH = 1.0;

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

// Hero wrapper opacity: held high through the disassembly so the
// inner transform pipeline (mask-erode, ring contract, scan-band)
// drives the visible motion; the wrapper only fades after the
// disassembly has done its work. Quiet final fade 0.85→1.05vh.
const HERO_FADE_START_VH = 0.85;
const HERO_FADE_END_VH = 1.05;
// Disassembly transition window: the hero composition decomposes
// (mask-erode + scale-recede on wordmark, contract + dissolve on ring)
// from 0.30vh to ~0.95vh, then a thin orange scan-band sweeps the
// viewport from 0.85vh→1.05vh at the handoff to the wireframe beat.
// Decoupled from --hero-opacity so the wrapper can hold opacity:1
// while the inner transforms do the work. Pure CSS, zero per-frame JS.
const HERO_DISSOLVE_START_VH = 0.30;
const HERO_DISSOLVE_END_VH = 1.00;
const ROOM_FADE_IN_START_VH = 1.50;
const ROOM_FADE_IN_END_VH = 1.58;
const ROOM_FADE_OUT_START_VH = 2.80;
const ROOM_FADE_OUT_END_VH = 2.95;
const WIREFRAME_VISIBLE_START_VH = 0.88;
const WIREFRAME_VISIBLE_END_VH = 1.64;
const ABOUT_PROGRESS_START_VH = 0.9;
const ABOUT_PROGRESS_END_VH = 2.20;
// Content opacity ramp window (page scroll fraction).
const CONTENT_FADE_START = 0.07;
const CONTENT_FADE_END = 0.105;

// Rate-limit constant for the scroll-driven reveal signals. The raw
// targets below are bound directly to window.scrollY, so a fast flick
// would otherwise teleport the hero dissolve / room fade / wireframe
// build straight to their end state — the user never SEES the animation.
// We ease each eased signal toward its raw target at this fixed
// exponential rate so the SPEED is capped (thresholds, windows, and
// sequence are untouched). ~2.5 → ≈400ms to settle, matching the feel
// of GSAP `scrub: 1`. Tunable.
const PROGRESS_EASE_RATE = 2.5;
// The room canvas FADE-OUT (handing off to the Kit/Mac section) eases at a
// STEEPER rate than the shared reveal rate above. The shared rate's gentle
// exponential tail near zero left the room lingering as a faint, slowly-
// dissolving "ghost" over the section behind it (~1.5s to read as gone),
// which looked messy. A faster downward rate + a snap-to-zero floor makes
// the room leave cleanly once it starts to go. The fade-IN (room reveal
// during About) keeps the gentle shared rate, so nothing pops in.
const CANVAS_FADE_OUT_RATE = 6;
// Below this eased opacity a fade-out snaps straight to 0 instead of
// crawling down the exponential's asymptote (where the room is still
// faintly visible but reads as "stuck" dissolving). Also means the room
// is fully gone before its canvas frameloop sleeps, so the frozen last
// frame is never seen.
const CANVAS_FADE_OUT_SNAP = 0.015;
// Clamp per-frame dt so a long idle / tab-switch (where rAF stops
// firing) doesn't produce one giant catch-up jump on the next tick.
const MAX_TICK_DT = 0.05;

// Canvas camera config. END_POS/END_FOV never change, so hoist to
// module scope to avoid a per-render object allocation. Far 300
// accommodates the near-ortho camera distance (~173 from origin) +
// the wireframe cover dome (radius 20 around camera) + room extent.
const CAMERA_CONFIG = {
  position: [END_POS.x, END_POS.y, END_POS.z] as [number, number, number],
  fov: END_FOV,
  near: 1,
  far: 300,
};

/**
 * Single continuous rAF loop. Each frame it recomputes the raw
 * scroll-derived targets and eases the reveal signals toward them at a
 * fixed rate (PROGRESS_EASE_RATE) so a fast flick can't teleport through
 * the reveals — only the SPEED is capped; thresholds/windows/sequence are
 * unchanged. Writes ALL derived fade/progress values to CSS variables on
 * documentElement AND to refs. R3F consumers read the refs in their
 * per-frame loops; DOM elements bind opacity to `var(--*-opacity)`.
 * App.tsx never re-renders on scroll. The prior version had five
 * setState-backed hooks reconciling the whole Canvas tree per scroll frame.
 *
 * The loop is continuous (not scroll-coalesced) on purpose: the eased
 * values must keep catching up to their targets for ~400ms after the user
 * stops scrolling, which a scroll-only listener could not do.
 */
function installScrollChoreography(): {
  aboutProgressRef: React.MutableRefObject<number>;
  scrollProgressRef: React.MutableRefObject<number>;
} {
  const aboutProgressRef: React.MutableRefObject<number> = { current: 0 };
  const scrollProgressRef: React.MutableRefObject<number> = { current: 0 };

  if (typeof window === "undefined") {
    return { aboutProgressRef, scrollProgressRef };
  }

  const root = document.documentElement;
  // 768 matches useIsMobile's breakpoint, so the canvas fade + the
  // pointer-events gate below cover exactly the devices on which
  // RoomPhysics is paused (was 720, leaving 721-768px widths with a
  // hit-testable but physics-dead room canvas).
  const isMobileQuery = window.matchMedia("(max-width: 768px)");

  // Raw scroll-derived targets. computeTargets() reproduces the exact
  // math/thresholds the old update() used (no easing applied here);
  // tick() then rate-limits each eased signal toward these.
  type Targets = {
    heroOpacity: number;
    heroToAbout: number;
    finalCanvasOpacity: number; // mobile fade folded into canvas composite
    aboutProgress: number;
    contentOpacity: number;
    scrollProgress: number; // raw — ScrollCamera damps internally
    isMobile: boolean;
  };

  const computeTargets = (): Targets => {
    const vh = window.innerHeight || 1;
    const ratio = window.scrollY / vh;
    const scrollMax = Math.max(
      1,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    const scrollProgress = clamp01(window.scrollY / scrollMax);

    // Hero opacity (3D signature): 1 at top, fades to 0 as user
    // scrolls past first viewport.
    const heroFade = clamp01(
      (ratio - HERO_FADE_START_VH) /
        (HERO_FADE_END_VH - HERO_FADE_START_VH),
    );
    const heroOpacity = 1 - heroFade;

    // Disassembly progress (0..1): drives the wordmark mask-erode,
    // ring contraction, and scan-band sweep. Linear across the
    // dissolve window; CSS does the easing per-element via
    // calc() pipelines tuned to feel staggered (wordmark front-loaded
    // 0.0→0.7, ring tightens 0.4→0.85, scan-band 0.78→1.0).
    const heroToAbout = clamp01(
      (ratio - HERO_DISSOLVE_START_VH) /
        (HERO_DISSOLVE_END_VH - HERO_DISSOLVE_START_VH),
    );

    // Room fade window: visible only during About.
    const fadeIn = clamp01(
      (ratio - ROOM_FADE_IN_START_VH) /
        (ROOM_FADE_IN_END_VH - ROOM_FADE_IN_START_VH),
    );
    const fadeOut = clamp01(
      (ratio - ROOM_FADE_OUT_START_VH) /
        (ROOM_FADE_OUT_END_VH - ROOM_FADE_OUT_START_VH),
    );
    const roomOpacity = fadeIn * (1 - fadeOut);

    // Wireframe canvas-visibility window: keeps the canvas
    // wrapper opaque during wireframe-assemble beat (where
    // roomOpacity itself is still 0).
    const wireframeOn =
      ratio >= WIREFRAME_VISIBLE_START_VH && ratio <= WIREFRAME_VISIBLE_END_VH
        ? 1
        : 0;
    const canvasOpacity = Math.max(roomOpacity, wireframeOn);

    // Mobile hero canvas fade: 0 in hero, ramps to 1 after.
    const mobileFade = clamp01(
      (ratio - MOBILE_FADE_START_VH) /
        (MOBILE_FADE_END_VH - MOBILE_FADE_START_VH),
    );
    const mobileCanvasOpacity = 1 - mobileFade;

    // About progress (consumed by ScrollWireframeRoom per frame).
    const aboutSpan = ABOUT_PROGRESS_END_VH - ABOUT_PROGRESS_START_VH;
    const aboutProgress = clamp01(
      (ratio - ABOUT_PROGRESS_START_VH) / aboutSpan,
    );

    const contentOpacity = clamp01(
      (scrollProgress - CONTENT_FADE_START) /
        (CONTENT_FADE_END - CONTENT_FADE_START),
    );

    const isMobile = isMobileQuery.matches;
    const finalCanvasOpacity =
      (isMobile ? mobileCanvasOpacity : 1) * canvasOpacity;

    return {
      heroOpacity,
      heroToAbout,
      finalCanvasOpacity,
      aboutProgress,
      contentOpacity,
      scrollProgress,
      isMobile,
    };
  };

  // Previously-eased values for the eased signals. Seeded from the first
  // target so there is no ease-in flash on initial load / refresh-at-offset.
  const seed = computeTargets();
  const prevEased = {
    heroOpacity: seed.heroOpacity,
    heroToAbout: seed.heroToAbout,
    finalCanvasOpacity: seed.finalCanvasOpacity,
    aboutProgress: seed.aboutProgress,
    contentOpacity: seed.contentOpacity,
  };

  // Frame-rate-independent exponential ease toward a target.
  const ease = (prev: number, target: number, dt: number) =>
    prev + (target - prev) * (1 - Math.exp(-dt * PROGRESS_EASE_RATE));

  // Stepped pixelation bucket for the hero dive. Maps the eased
  // hero→about progress onto the SVG mosaic filters defined in
  // HeroSignature (#hero-px-1..5, cells 4→32px): the hero's rendered
  // pixels resample into progressively chunkier blocks as the zoom
  // deepens. Bucket 0 = no filter (resting hero pays zero filter cost).
  // SVG filter parameters can't be driven by CSS vars, hence the
  // attribute steps instead of a continuous ramp — the quantised jumps
  // read as authentic pixel-art degradation under the smooth scale.
  const HERO_PX_STEPS = [0.08, 0.26, 0.44, 0.62, 0.8];
  let lastHeroPx = -1;
  const applyHeroPx = (p: number) => {
    let bucket = 0;
    for (let i = 0; i < HERO_PX_STEPS.length; i++) {
      if (p > HERO_PX_STEPS[i]!) bucket = i + 1;
    }
    if (bucket === lastHeroPx) return;
    lastHeroPx = bucket;
    if (bucket === 0) root.removeAttribute("data-hero-px");
    else root.setAttribute("data-hero-px", String(bucket));
  };

  // Largest remaining gap between an eased signal and its target after the
  // most recent tick. The loop uses it to know when easing has settled so it
  // can stop ticking (and stop reading layout) until the next scroll/resize.
  let convergenceDelta = 1;

  const tick = (dt: number) => {
    const t = computeTargets();

    // scrollProgress stays RAW — ScrollCamera already damps internally,
    // so easing here would double-damp the camera.
    scrollProgressRef.current = t.scrollProgress;

    const heroOpacity = ease(prevEased.heroOpacity, t.heroOpacity, dt);
    const heroToAbout = ease(prevEased.heroToAbout, t.heroToAbout, dt);
    // Canvas opacity: gentle shared rate on the way IN (anti-teleport on the
    // room reveal), steeper rate + snap-to-zero on the way OUT so the room
    // doesn't ghost over the Kit section. See CANVAS_FADE_OUT_RATE.
    const canvasFalling = t.finalCanvasOpacity < prevEased.finalCanvasOpacity;
    let finalCanvasOpacity =
      prevEased.finalCanvasOpacity +
      (t.finalCanvasOpacity - prevEased.finalCanvasOpacity) *
        (1 -
          Math.exp(
            -dt * (canvasFalling ? CANVAS_FADE_OUT_RATE : PROGRESS_EASE_RATE),
          ));
    if (t.finalCanvasOpacity === 0 && finalCanvasOpacity < CANVAS_FADE_OUT_SNAP) {
      finalCanvasOpacity = 0;
    }
    const aboutProgress = ease(prevEased.aboutProgress, t.aboutProgress, dt);
    const contentOpacity = ease(prevEased.contentOpacity, t.contentOpacity, dt);

    prevEased.heroOpacity = heroOpacity;
    prevEased.heroToAbout = heroToAbout;
    prevEased.finalCanvasOpacity = finalCanvasOpacity;
    prevEased.aboutProgress = aboutProgress;
    prevEased.contentOpacity = contentOpacity;

    aboutProgressRef.current = aboutProgress;

    // Pointer-events stays a hard threshold but is derived from the
    // EASED canvas opacity so it flips in step with the visible fade.
    // MOBILE: the room canvas is NEVER hit-testable. RoomPhysics is
    // paused on phones (no drag/throw to receive), but the wrapper
    // still flipped to `auto` while the wireframe beat was visible —
    // and since the canvas spans the full fixed viewport with
    // touch-action:none + OrbitControls' one-finger rotate, every
    // swipe in that scroll window was swallowed and the page read as
    // completely stuck. Sections (<main>) are pointer-events:none
    // pass-throughs, so there was nothing above it to save the touch.
    const canvasInteractive =
      t.isMobile || finalCanvasOpacity < 0.05 ? "none" : "auto";

    root.style.setProperty("--hero-opacity", heroOpacity.toFixed(3));
    root.style.setProperty("--hero-to-about", heroToAbout.toFixed(3));
    // Hero hit-testability follows its visibility. The wordmark + bottom
    // chips re-enable pointer-events inside the none'd hero layer (for
    // the inhale hover / scroll button), but <main> is ALSO a
    // pointer-events:none pass-through — so once the hero faded out,
    // its invisible wordmark kept catching pointers anywhere a section
    // below didn't explicitly opt in (found via a dead trophy-wall
    // hover that resolved to .hero-mega-wordmark).
    root.style.setProperty(
      "--hero-pointer-events",
      heroOpacity < 0.05 ? "none" : "auto",
    );
    applyHeroPx(heroToAbout);
    root.style.setProperty("--canvas-opacity", finalCanvasOpacity.toFixed(3));
    root.style.setProperty("--canvas-pointer-events", canvasInteractive);
    root.style.setProperty(
      "--content-opacity",
      t.isMobile ? "1" : contentOpacity.toFixed(3),
    );

    convergenceDelta = Math.max(
      Math.abs(t.heroOpacity - heroOpacity),
      Math.abs(t.heroToAbout - heroToAbout),
      Math.abs(t.finalCanvasOpacity - finalCanvasOpacity),
      Math.abs(t.aboutProgress - aboutProgress),
      Math.abs(t.contentOpacity - contentOpacity),
    );
  };

  // Seed the CSS vars/refs from the initial target with dt large enough
  // to land exactly on it (no ease-in on first paint).
  tick(MAX_TICK_DT);

  // Drive tick() from a rAF loop that EASES toward the target, but lets it
  // SLEEP once the eased values have settled AND no scroll/resize happened
  // recently — so we are NOT recomputing targets + reading layout
  // (scrollHeight) every frame for the whole page lifetime. A passive
  // scroll/resize listener wakes it; it then keeps ticking for SETTLE_MS
  // after the last input AND until the ease has converged, so the reveal
  // finishes catching up after the user stops scrolling (the whole point of
  // the rate-limit) before the loop idles again.
  const SETTLE_MS = 650; // comfortably longer than the ~400ms ease
  const CONVERGE_EPS = 0.0004; // below one /1000 CSS-var step
  let lastTs = performance.now();
  let lastInput = lastTs;
  let running = false;

  const loop = (ts: number) => {
    const dt = Math.min(MAX_TICK_DT, (ts - lastTs) / 1000);
    lastTs = ts;
    tick(dt);
    if (performance.now() - lastInput < SETTLE_MS || convergenceDelta > CONVERGE_EPS) {
      requestAnimationFrame(loop);
    } else {
      running = false; // settled + idle: nothing reads layout until next input
    }
  };
  const wake = () => {
    lastInput = performance.now();
    if (!running) {
      running = true;
      lastTs = performance.now();
      requestAnimationFrame(loop);
    }
  };
  window.addEventListener("scroll", wake, { passive: true });
  window.addEventListener("resize", wake, { passive: true });

  return { aboutProgressRef, scrollProgressRef };
}

export default function App() {
  if (
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("sign") === "1"
  ) {
    return (
      <Suspense fallback={null}>
        <SignatureCapture />
      </Suspense>
    );
  }

  const sceneReadyRef = useRef(false);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [transitionStarted, setTransitionStarted] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  // Set once Room finishes loading (post-Suspense). Drives the signature
  // replay independently of the intro tilt; the signature should play
  // automatically when the room appears, not wait for a user gesture.
  const [roomLoaded, setRoomLoaded] = useState(false);
  const [moveableHover, setMoveableHover] = useState(false);
  const isMobile = useIsMobile();

  const scrollChoreoRef = useRef<ReturnType<typeof installScrollChoreography> | null>(null);
  if (scrollChoreoRef.current === null) {
    scrollChoreoRef.current = installScrollChoreography();
  }
  const aboutProgressRef = scrollChoreoRef.current.aboutProgressRef;
  const scrollProgressRef = scrollChoreoRef.current.scrollProgressRef;

  const startTransition = useCallback(() => {
    if (transitionStarted) return;
    setTransitionStarted(true);
    track("intro_started");
  }, [transitionStarted]);

  // Lenis smooth scroll is owned by src/portfolio/Keypad.tsx via a
  // module-scope singleton (initializing a second one here would have
  // two scroll engines fighting over window.scrollY).

  const completeTransition = useCallback(() => {
    sceneReadyRef.current = true;
    setSceneReady(true);
    track("room_entered");
  }, []);

  /* The intro camera dolly was removed (camera starts at END pose), so
   * "transition started" completes immediately. Kept as an effect so
   * sceneReady still flips one tick after the triggering scroll, which
   * is when OrbitControls + ScrollCamera mount. */
  useEffect(() => {
    if (transitionStarted) completeTransition();
  }, [transitionStarted, completeTransition]);

  /* Keypad canvas dispatches a window `keypad-cursor-hover` CustomEvent
   * and we mirror it into shared moveableHover state (drives the custom
   * cursor's hot ring). This is the only thing left that flips it now
   * that the room is non-interactive. */
  useEffect(() => {
    const onKeypadHover = (e: Event) => {
      const ev = e as CustomEvent<{ hot: boolean }>;
      setMoveableHover(!!ev.detail?.hot);
    };
    window.addEventListener("keypad-cursor-hover", onKeypadHover);
    return () =>
      window.removeEventListener("keypad-cursor-hover", onKeypadHover);
  }, []);

  /* Disable the browser context menu site-wide (no right-click). */
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  /* First meaningful scroll (after the room is loaded and past
   * loading-active) triggers the intro. Gated on scrollY crossing
   * 0.75vh so the intro dolly begins when the user is actually
   * looking at the room, not at scrollY ≈ 0 where the canvas is
   * still faded out. */
  useEffect(() => {
    if (transitionStarted) return;
    const check = () => {
      if (transitionStarted) return;
      if (document.documentElement.classList.contains("loading-active")) return;
      if (!roomLoaded) return;
      const vhRatio = window.scrollY / Math.max(1, window.innerHeight);
      if (vhRatio >= 0.75) startTransition();
    };
    const onScroll = () => requestAnimationFrame(check);
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [transitionStarted, startTransition, roomLoaded]);

  /* Warm the lazy section-scene chunks (Macintosh / Hobbies / Keypad) during
   * idle time once the room is loaded, so they're cached well before the user
   * scrolls down to them. Without this prefetch the React.lazy split would
   * risk a blank scene on a fast first scroll-past. These import specifiers
   * resolve to the same modules the section wrappers lazy-load, so Rollup
   * serves one shared chunk per scene (no duplicate fetch). */
  useEffect(() => {
    if (!roomLoaded) return;
    const warm = () => {
      void import("./macintosh/MacintoshScene");
      void import("./other/HobbiesScene");
      void import("./keypad/KeypadScene");
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const id = w.requestIdleCallback(warm);
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(warm, 1500);
    return () => clearTimeout(t);
  }, [roomLoaded]);

  // RoomLoadedSignal's effect depends on onLoaded; a new function each
  // render re-runs the effect and re-calls setRoomLoaded after it is
  // already true. setMoveableHover is a plain useState setter (stable).
  const handleRoomLoaded = useCallback(() => setRoomLoaded(true), []);

  // Avoid a per-render allocation of the WebGL config.
  const glConfig = useMemo(
    () => ({
      antialias:
        typeof window !== "undefined" ? window.devicePixelRatio < 1.5 : true,
      alpha: true,
      // NO tone mapping: the baked room atlases already have AgX baked
      // in; re-tonemapping would wash them out. (The room renders unlit.)
      toneMapping: THREE.NoToneMapping,
      powerPreference: "high-performance" as const,
      // Z-fighting fix: many nearly-coplanar surfaces (mirror against
      // wall, cat on bed) under the iso camera need more depth precision
      // than the default 24-bit buffer provides. GroundPlane's
      // ShaderMaterial mirrors the logdepthbuf chunks so its sort order
      // stays consistent.
      logarithmicDepthBuffer: true,
    }),
    []
  );

  // onCreated fires once; extracted for reference hygiene. Body is
  // verbatim from the inline arrow to avoid any behavior change.
  const handleCanvasCreated = useCallback(({ gl, camera }: RootState) => {
    gl.outputColorSpace = THREE.SRGBColorSpace;
    cameraRef.current = camera as THREE.PerspectiveCamera;
    camera.lookAt(END_LOOK_AT);
  }, []);

  return (
    <AssemblyProvider>
      <div
        className="app-wrapper"
        style={{
          position: "relative",
          minHeight: "100vh",
          cursor: "none",
        }}
        onPointerLeave={() => setMoveableHover(false)}
      >
        {/* Hero signature: fixed full viewport. Sits between the room
            canvas (z 0) and the HUD (z 9999). Opacity driven by
            --hero-opacity from the consolidated scroll listener. */}
        <div
          className="scroll-layer--hero"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            pointerEvents: "none",
            // NO opacity transition here: --hero-opacity is already
            // eased per-frame by the scroll choreography; a CSS
            // transition on top continuously re-targets 200ms behind
            // the eased value (double smoothing), which read as
            // lag/stutter when reversing scroll direction at the hero.
            zIndex: 2,
          }}
        >
          <HeroSignature />
        </div>
        <div
          className="scroll-layer--canvas"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            zIndex: 0,
          }}
        >
          <Canvas
            camera={CAMERA_CONFIG}
            // No real-time shadows: the baked room is unlit
            // MeshBasicMaterial (can't cast/receive). A fake painted
            // shadow plane (FakeShadow) grounds it instead.
            // PERF: cap DPR by device class. Desktop caps at 1.25 (on
            // 2-3× retina the room canvas was rendering at 1.5×, ~44%
            // more fragment-shader work for little gain. The room is
            // matte under iso projection). MOBILE caps at a flat 1.0:
            // phone GPUs are markedly weaker and this is a multi-WebGL,
            // GSAP-pinned page, so rendering the always-on room at native
            // 1× (vs 1.25× on a 3× screen = ~56% fewer fragments) is the
            // single biggest mobile GPU win and keeps the scroll smooth.
            // MSAA still on when DPR < 1.5.
            dpr={isMobile ? [1, 1] : [1, 1.25]}
            gl={glConfig}
            onCreated={handleCanvasCreated}
          >
            <Suspense fallback={null}>
                <RoomLoadedSignal onLoaded={handleRoomLoaded} />
                {/* PERF: the room canvas is only ever visible during the
                    hero intro + About beat (scroll ratio < ~3vh). Past
                    that its wrapper opacity is pinned 0, yet R3F's
                    default frameloop="always" kept rendering the full
                    Room scene + Rapier physics + OrbitControls +
                    ScrollWireframeRoom every frame behind the invisible
                    layer, capping the WHOLE page at ~15fps from About
                    onward (the Mac/projects section inherited this floor
                    and then stacked its own canvas on top, which is why
                    it read as "incredibly laggy"). This gate flips the
                    room canvas to frameloop="never" once the room has
                    scrolled out, freeing the budget for the Mac scene.
                    It re-wakes (and invalidates) the instant the user
                    scrolls back up. */}
                <RoomFrameloopGate />
                <GroundPlane />
                {/* Fake contact shadow: the baked room is unlit
                    MeshBasicMaterial and can't cast a real-time shadow,
                    so a soft elliptical radial-gradient texture on a
                    plane grounds it instead (no lights). */}
                <FakeShadow />
                {/* Static baked diorama. The ScrollWireframeRoom cover
                    dome handles the wireframe-only beat so there's no
                    pop-in seam. */}
                <Room />
                <ScrollWireframeRoom progressRef={aboutProgressRef} />
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
                      progressRef={scrollProgressRef}
                    />
                  </>
                )}
              </Suspense>
          </Canvas>
        </div>

        {/* Orange ring + dot cursor with parallax trail. */}
        {roomLoaded && !isMobile && <MoveableCursor hot={moveableHover} />}

        <PortfolioSections />

        <RoomHUD visible={true} />

        {/* TE-spec-sheet flourishes: only after the room loads.
            StatusBar (section + pixel scroll meter) and JumpToTop
            render on every breakpoint. (The right-edge ScrollRail was
            removed in the pixel retrofuturism pass: it duplicated the
            StatusBar's progress readout.) */}
        {sceneReady && (
          <>
            <StatusBar />
            <JumpToTop />
          </>
        )}
      </div>
    </AssemblyProvider>
  );
}

/** Renders nothing; just calls onLoaded once it mounts. Because it's a
 *  child of <Suspense> alongside <Room>, it only mounts after the GLB
 *  has streamed in and Room's useGLTF has resolved, which is what we
 *  want for "the room is on screen now, play the signature." */
function RoomLoadedSignal({ onLoaded }: { onLoaded: () => void }) {
  useEffect(() => {
    onLoaded();
  }, [onLoaded]);
  return null;
}

// Scroll ratio (scrollY / innerHeight) past which the room is fully
// faded out and never seen again on the way down. ROOM_FADE_OUT_END_VH
// is 2.95; the +0.25vh margin keeps the room live just past the end of
// its fade-out so the final faded frames still render, then the loop
// quiets for every section below (Mac, Work, Other, …).
const ROOM_SLEEP_RATIO = ROOM_FADE_OUT_END_VH + 0.25;

/**
 * PERF gate for the always-on room canvas. Watches the scroll ratio via
 * a passive listener (no per-frame work of its own) and, once the room
 * has scrolled fully out (past the About beat), puts the whole room
 * pipeline to sleep:
 *
 *   1. `setFrameloop("never")` halts R3F's automatic render loop.
 *   2. `onSleepChange(true)` pauses Rapier <Physics>. This step is what
 *      makes (1) stick. A running Rapier sim calls `invalidate()` every
 *      frame, which re-renders the canvas even under "never"/"demand".
 *      Pausing it removes the only continuous invalidator, so the loop
 *      genuinely idles.
 *
 * Together they stop the room scene draw (~150 draw calls/frame), the
 * physics step, OrbitControls damping, and the ScrollCamera /
 * ScrollWireframeRoom useFrames while the user is on Mac / Work / Other.
 * That recovers the budget the Mac/projects section was starved of. On
 * the wake edge it restores "always", invalidates one frame, and
 * un-pauses physics so scrolling back up resumes seamlessly.
 */
function RoomFrameloopGate() {
  const setFrameloop = useThree((s) => s.setFrameloop);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let asleep = false;
    let raf = 0;
    const apply = () => {
      const ratio = window.scrollY / Math.max(1, window.innerHeight);
      const shouldSleep = ratio > ROOM_SLEEP_RATIO;
      if (shouldSleep && !asleep) {
        asleep = true;
        setFrameloop("never");
      } else if (!shouldSleep && asleep) {
        asleep = false;
        setFrameloop("always");
        // Two frames on wake: a static MeshBasicMaterial scene needs one
        // paint, and a second on the next rAF guards against a blank
        // frame if the resize/layout hasn't settled.
        invalidate();
        requestAnimationFrame(() => invalidate());
      }
    };
    const onScroll = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [setFrameloop, invalidate]);
  return null;
}

/**
 * Fake contact shadow for the static baked room. The baked meshes are
 * unlit MeshBasicMaterial (they neither cast nor receive real-time
 * shadows), so this is a generated soft elliptical dark radial-gradient
 * texture on a plane just under the room at floor height - no lights,
 * cheap, fully controllable. Positioned so the fixed iso camera sees it
 * grounding the room toward the viewer.
 */
function FakeShadow() {
  const texture = useMemo(() => {
    const SIZE = 256;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d")!;
    const g = ctx.createRadialGradient(
      SIZE / 2,
      SIZE / 2,
      0,
      SIZE / 2,
      SIZE / 2,
      SIZE / 2,
    );
    g.addColorStop(0, "rgba(13,14,16,0.6)");
    g.addColorStop(0.55, "rgba(13,14,16,0.45)");
    g.addColorStop(0.82, "rgba(13,14,16,0.16)");
    g.addColorStop(1, "rgba(13,14,16,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, SIZE, SIZE);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, []);

  useEffect(() => () => texture.dispose(), [texture]);

  // Centered under the room footprint (room AABB center x=-0.02, z=-0.17;
  // size 4.7 x 5.1, floor at y~0) but sized LARGER (7 x 7.5) so the soft
  // penumbra spills past the room's opaque carpet onto the bare dotted
  // ground, reading as a contact shadow grounding the room. y just above
  // the GroundPlane (y=0). Owner fine-tunes position/size/opacity.
  return (
    <mesh
      position={[-0.02, 0.012, -0.17]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={1}
    >
      <planeGeometry args={[7, 7.5]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
