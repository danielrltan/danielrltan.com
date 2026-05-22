import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Lenis from "lenis";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Physics } from "@react-three/rapier";
import * as THREE from "three";
import { Room } from "./Room";
import { Lighting } from "./Lighting";
import {
  IntroController,
  END_POS,
  END_FOV,
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
import { HeroSignature } from "./hero/HeroSignature";
import { ScrollWireframeRoom } from "./loading/ScrollWireframeRoom";
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
// Mobile: canvas takes the FULL viewport during hero (was 55vh — felt
// like a tiny preview thumbnail rather than a hero scene). Fade is
// driven by raw scroll-pixels relative to the viewport height so the
// canvas dissolves as the user scrolls past the first screen and About
// enters the frame. Pre-2026-05: tied to total scrollProgress, which
// broke when total page height changed.
const MOBILE_FADE_START_VH = 0.55; // start fading at 55% of viewport scrolled
const MOBILE_FADE_END_VH = 1.0;    // fully gone once past one viewport

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Hero (3D signature) fade — returns 1 while the user is at the top
 * of the page and ramps to 0 as they scroll past the first viewport.
 * The signature lives in `position: fixed` so this is the only way
 * to "leave it behind" as the user scrolls into About.
 *
 * scrollY-based for the same reason as `useMobileHeroFade`: page
 * height changes shouldn't shift these breakpoints.
 */
const HERO_FADE_START_VH = 0.45;
const HERO_FADE_END_VH = 0.9;
function useHeroFade(): number {
  const [t, setT] = useState(1);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const vh = window.innerHeight || 1;
      const ratio = window.scrollY / vh;
      const fade = clamp01(
        (ratio - HERO_FADE_START_VH) /
          (HERO_FADE_END_VH - HERO_FADE_START_VH),
      );
      setT(1 - fade);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return t;
}

/**
 * Room canvas fade — visible only during the About section.
 *   < 0.9vh scrolled : hidden  (Hero)
 *   0.9 .. 1.3vh     : fading in
 *   1.3 .. 1.55vh    : visible (About)
 *   1.55 .. 1.85vh   : fading out
 *   > 1.85vh         : hidden  (all subsequent sections)
 *
 * Fade-out tightened so the room is FULLY GONE before the Macintosh
 * section (which starts pinning at ~2.0vh on a 900px viewport)
 * enters the viewport. Earlier tuning had the room at ~90% opacity
 * during Mac entry, which made the two 3D scenes overlap visually
 * and read as a broken transition. Now there's a clean ~0.3vh gap
 * between "room fully invisible" and "Mac fully pinned" — the
 * SectionGate curtain (see App JSX) fills that gap with a deliberate
 * typographic moment.
 */
// Hard-swap point: at pin 0.50 the wireframe envelope + cover dome
// drop to 0 within 2% of pin range, and the room is revealed beneath
// them. The room's own canvas-wrapper opacity is a wider window so
// it ramps in slightly before the swap (subliminal) and out alongside
// the About pin's release.
//
// In scrollY-vh terms (anchored to 0.9..2.20vh About range):
//   pin 0.50 = 0.9 + 0.50 * 1.30 = 1.55vh
//   pin 0.52 = 1.576vh
const ROOM_FADE_IN_START_VH = 1.50;
const ROOM_FADE_IN_END_VH = 1.58;
const ROOM_FADE_OUT_START_VH = 2.10;
const ROOM_FADE_OUT_END_VH = 2.30;
/**
 * Wireframe-canvas-visibility hook — returns 1 while the wireframe
 * envelope (defined in ScrollWireframeRoom) is active, 0 otherwise.
 * Used to keep the room canvas wrapper from going opacity 0 during
 * the wireframe-only beat (where roomOpacity itself is still 0).
 *
 * Anchored to the same scrollY/vh thresholds:
 *   0.9vh    : wireframe pin start
 *   1.615vh  : wireframe envelope returns to 0
 */
function useWireframeCanvasFade(): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const vh = window.innerHeight || 1;
      const ratio = window.scrollY / vh;
      // Visible from 0.9vh to 1.615vh, with a soft 0.02vh fade at
      // each edge so the canvas doesn't flick on/off if scroll
      // happens to land on the boundary.
      const on = ratio >= 0.88 && ratio <= 1.64;
      setT(on ? 1 : 0);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return t;
}

function useRoomFade(): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const vh = window.innerHeight || 1;
      const ratio = window.scrollY / vh;
      const fadeIn = clamp01(
        (ratio - ROOM_FADE_IN_START_VH) /
          (ROOM_FADE_IN_END_VH - ROOM_FADE_IN_START_VH),
      );
      const fadeOut = clamp01(
        (ratio - ROOM_FADE_OUT_START_VH) /
          (ROOM_FADE_OUT_END_VH - ROOM_FADE_OUT_START_VH),
      );
      setT(fadeIn * (1 - fadeOut));
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  return t;
}

/**
 * Mobile hero fade — returns 0 while the user is in the hero
 * viewport, ramps to 1 as they scroll past the first screen.
 *
 * Computed from `window.scrollY / window.innerHeight` (not the
 * normalised `scrollProgress`) because the page total height changes
 * as sections grow/shrink — a percentage-of-page fade would shift
 * around. Anchoring to the viewport height means "one screen scrolled
 * = canvas fully gone", which is the intent.
 *
 * No-ops when isMobile is false so desktop pays nothing.
 */
function useMobileHeroFade(isMobile: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!isMobile) {
      setT(0);
      return;
    }
    let raf = 0;
    const update = () => {
      const vh = window.innerHeight || 1;
      const ratio = window.scrollY / vh;
      const next = clamp01(
        (ratio - MOBILE_FADE_START_VH) /
          (MOBILE_FADE_END_VH - MOBILE_FADE_START_VH),
      );
      setT(next);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [isMobile]);
  return t;
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

  // About-pin scroll progress (0..1). Used to drive the scroll-driven
  // wireframe overlay inside the room canvas — wireframes assemble
  // as the user scrolls into About, peak mid-pin, fade back out as
  // the user approaches the Mac handoff. Updated by a scroll
  // listener below; consumed by <ScrollWireframeRoom> via ref.
  const aboutProgressRef = useRef(0);
  useEffect(() => {
    let raf = 0;
    const ABOUT_START_VH = 0.9;  // matches room fade-in start
    const ABOUT_END_VH = 2.20;   // matches room fade-out end
    const update = () => {
      const vh = window.innerHeight || 1;
      const ratio = window.scrollY / vh;
      const span = ABOUT_END_VH - ABOUT_START_VH;
      const p = (ratio - ABOUT_START_VH) / span;
      aboutProgressRef.current = Math.max(0, Math.min(1, p));
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const startTransition = useCallback(() => {
    if (transitionStarted) return;
    setTransitionStarted(true);
    track("intro_started");
    // Audio no longer auto-starts here — it's gated behind the
    // explicit mute toggle in RoomHUD which defaults to OFF.
  }, [transitionStarted]);

  // Lenis smooth scroll is owned by src/portfolio/Keypad.tsx
  // (module-scope `ensureLenis()` singleton — it pre-dates this file
  // and was already wired to ScrollTrigger.update + gsap.ticker).
  // Initializing a SECOND Lenis here meant TWO smooth-scroll engines
  // were both trying to drive window.scrollY, both calling
  // ScrollTrigger.update, both adding to gsap.ticker — they fought
  // over the scroll value and the keypad section's drop-in trigger
  // never received clean monotonic progress, so the keypad failed
  // to render on first scroll. Single source of truth restored.

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

  /* Listen for keypad cursor-hover signals. The keypad section lives
   * in its OWN Canvas (outside the room's SceneStateProvider scope)
   * so it can't call setMoveableHover via context. It dispatches a
   * window-level `keypad-cursor-hover` CustomEvent on every cap /
   * dial / sidebtn pointer enter/leave; we mirror that into the
   * shared moveableHover state so the orange ring goes "hot" the
   * same way it does for room-scene draggables. */
  useEffect(() => {
    const onKeypadHover = (e: Event) => {
      const ev = e as CustomEvent<{ hot: boolean }>;
      setMoveableHover(!!ev.detail?.hot);
    };
    window.addEventListener("keypad-cursor-hover", onKeypadHover);
    return () =>
      window.removeEventListener("keypad-cursor-hover", onKeypadHover);
  }, []);

  /* First scroll / wheel / touch input triggers the intro tilt. No
   * more "click to begin" gate — the natural impulse on a portfolio
   * page is to scroll, so we use that as the start signal. Keydown
   * was previously also a trigger (so any key press could "enter"
   * the page); removed because it was firing on incidental key
   * presses (DevTools shortcuts, browser hotkeys) before the user
   * had actually decided to engage.
   *
   * Gated on `html.loading-active`: while the wireframe assembly is
   * still painting, ANY of these events would kick off the intro
   * tilt — moving the camera into the room behind the wireframes
   * before the user can see the loaded scene. That made the loading
   * screen feel "clickable" (scroll/touch/wheel all started the
   * intro). Once `loading-active` is removed (climaxDone fires),
   * the first input fires the intro normally.
   *
   * We drop `{ once: true }` here so the listener survives an
   * event that arrives during loading — otherwise the first stray
   * wheel/scroll during loading consumes the registration and the
   * user's real scroll once loading completes does nothing. */
  useEffect(() => {
    if (transitionStarted) return;
    // FIX: was firing on the first wheel/touch/scroll input — which
    // happens at scrollY ≈ 0, where the room canvas is still at
    // opacity 0 (ROOM_FADE_IN_START_VH = 0.9). The 1.5s intro dolly
    // played behind an invisible canvas; by the time the user
    // scrolled into the room's visibility window the camera was
    // already at END pose. Net effect: cinematic reveal never read.
    //
    // Now gates on scrollY crossing 0.75vh (just before fade-in
    // starts at 0.9vh) AND on `roomLoaded` so the dolly only begins
    // when the user is actually looking at the room.
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
  // overlayWidthVw was driving the canvas-overlay-panel (now removed
  // — see deletion above with full-width room change). Kept the
  // shrinkT calculation since other things still reference it.
  void lerp;
  void PINNED_WIDTH_VW;
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
  // Mobile: canvas occupies the full viewport during hero and fades
  // out as the user scrolls past the first screen. Computed from raw
  // window.scrollY / innerHeight rather than scrollProgress so the
  // fade is locked to "one screen scrolled", not a percentage of total
  // page (which changes as sections grow/shrink).
  const mobileFadeT = useMobileHeroFade(isMobile);
  const mobileCanvasOpacity = 1 - mobileFadeT;

  // Room/Hero scroll choreography under the new curiosity-cabinet
  // design (see docs/superpowers/specs/2026-05-21-portfolio-redesign-
  // design.md):
  //   - Hero (3D signature) is visible at viewport top (scrollProgress
  //     0..HERO_END), then fades out as the user scrolls.
  //   - Room is HIDDEN during Hero, fades in over the About section,
  //     and fades back out when the user scrolls past About.
  // Thresholds are scrollY-based (in viewport units) rather than
  // scrollProgress-based so they survive page-height changes from
  // section content growing/shrinking. ROOM_VISIBLE_START is "Hero
  // ends" and ROOM_VISIBLE_END is "About ends." Tuned empirically;
  // bump if either section gets taller.
  const heroOpacity = useHeroFade();
  const roomOpacity = useRoomFade();
  // Canvas-wrapper opacity must include the WIREFRAME window too —
  // otherwise the canvas is invisible during scroll 0.9..1.615vh
  // (wireframes assembling) because roomOpacity is still 0 there.
  // Wireframe phase spans 0.9..1.615vh on a 900px viewport.
  const canvasOpacity = Math.max(roomOpacity, useWireframeCanvasFade());

  // Publish content opacity as a CSS variable on the document root so
  // every non-hero section's .portfolio-col can read it without
  // prop-drilling.
  useEffect(() => {
    const value = isMobile ? "1" : String(contentOpacity);
    document.documentElement.style.setProperty("--content-opacity", value);
  }, [contentOpacity, isMobile]);

  // (Page scroll-to-top on load is now handled SYNCHRONOUSLY in
  //  src/main.tsx, before React mounts. Running it in a useEffect
  //  here was too late — the browser had already restored scroll
  //  by the time the effect fired, and useScrollProgress + Lenis
  //  had latched onto that non-zero starting position.)

  // (loading-active class is managed by AssemblyController based on
  //  climaxDone — the proper source of truth. App-level toggle removed
  //  to stop the two effects from fighting and causing chrome
  //  contrast flicker.)

  return (
    <AssemblyProvider>
      <div
        className="app-wrapper"
        style={{
          position: "relative",
          minHeight: "100vh",
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

        {/* The canvas-overlay-panel (50vw cream rectangle that visually
            shrunk the room to a half-viewport) is now gone. User
            asked: "you don't have to stick with the half/half
            layout." Room fills the full viewport during About; the
            section content overlays editorially on top instead of
            being relegated to a right-half column. See
            .portfolio-about CSS for the new overlay positioning. */}
        {/* Hero signature — covers full viewport. Visible at scroll top,
            fades out as the user enters About. Positioned BELOW the
            HUD (z-index 9999) and ABOVE the room canvas (z-index 0)
            so the loading-state orange paints around it via the wrapper
            bg and the 3D version sits in front of the soon-to-fade-in
            room. */}
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            pointerEvents: "none",
            opacity: heroOpacity,
            transition: "opacity 200ms linear",
            zIndex: 2,
          }}
        >
          <HeroSignature />
        </div>
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            // Canvas wrapper is now ALWAYS full-width (or full mobile
            // band). The right portion is visually covered by the
            // overlay panel above. This stops Three.js from running
            // its internal resize observer on every scroll frame.
            width: "100vw",
            // Mobile hero: full-viewport canvas (was 55vh, which made
            // the room read as a tiny preview). Combined with the
            // scroll-pixel-based fade in useMobileHeroFade, the room
            // dissolves cleanly as the user scrolls into About.
            height: "100vh",
            // Room is now ONLY visible during the About section (per
            // the curiosity-cabinet redesign). roomOpacity is 0 during
            // Hero, fades to 1 through About, fades back to 0 as the
            // user scrolls into Skills/Macintosh.
            opacity: (isMobile ? mobileCanvasOpacity : 1) * canvasOpacity,
            pointerEvents:
              (isMobile && mobileCanvasOpacity < 0.05) || canvasOpacity < 0.05
                ? "none"
                : "auto",
            zIndex: 0,
          }}
        >
          <Canvas
            camera={{
              // Was START_POS/START_FOV — kicked off the 1.5s dolly
              // intro on transitionStarted. User feedback: the dolly
              // was "unnecessary." Camera now starts at the final
              // canonical pose, IntroController is a no-op tilt
              // resetter, no zoom-in animation.
              position: [END_POS.x, END_POS.y, END_POS.z],
              fov: END_FOV,
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
              // lookAt slightly biased toward the room model's
              // visual center of mass (not just world origin). The
              // room's actual geometry extends asymmetrically from
              // origin — looking at (0, 0.8, 0) put the visible
              // room in the right 2/3 of the viewport. Biasing
              // toward (1.5, 1.2, 1.5) re-centers it. END_LOOK_AT
              // still drives OrbitControls + reset behaviour
              // (re-syncs cleanly when control transfers).
              camera.lookAt(1.5, 1.2, 1.5);
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
                {/* Shadow catcher. The GroundPlane uses a custom
                    ShaderMaterial that doesn't include three.js's
                    shadowmap chunks, so it can't natively receive
                    shadows from the directional light. Drei's
                    ContactShadows (a fake depth-capture approach)
                    failed to render at all in this scene — likely a
                    drei version / orthocam frustum quirk. This is
                    the classic shadow-catcher pattern instead: a
                    transparent plane sitting just above the
                    GroundPlane that ONLY draws the shadow regions
                    via `shadowMaterial`. Non-shadowed pixels stay
                    transparent so the rice-dot ground beneath shows
                    through unchanged. Driven by the real
                    directionalLight in Lighting.tsx (castShadow +
                    shadow camera ±3.2). */}
                <mesh
                  position={[0, 0.005, 0]}
                  rotation={[-Math.PI / 2, 0, 0]}
                  receiveShadow
                  renderOrder={1}
                >
                  <planeGeometry args={[20, 20]} />
                  <shadowMaterial transparent opacity={0.28} />
                </mesh>
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
                  {/* Room visibility is now handled by the
                      ScrollWireframeRoom's cover dome — an opaque
                      cream sphere pinned to the camera that hides
                      the room during the wireframe-only beat and
                      fades in lockstep with the wireframes. The
                      Room itself stays mounted + visible always
                      (no group.visible toggle, no pop-in seam). */}
                  <Room key={roomResetKey} roomGroupRef={roomGroupRef} />
                </Physics>
                {/* Scroll-driven wireframe annotation layer. Reads
                    aboutProgressRef per frame, draws orange line-
                    segment AABBs over the room that assemble +
                    disassemble with scroll. */}
                <ScrollWireframeRoom progressRef={aboutProgressRef} />
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
