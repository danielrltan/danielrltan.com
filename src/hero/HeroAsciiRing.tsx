import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
// Vendored from three/examples (one-line willReadFrequently fix; see
// ./AsciiEffect.js header) so the per-frame getImageData readback that drives
// the ring doesn't stall the GPU.
import { AsciiEffect } from "./AsciiEffect.js";

/**
 * Big bold ASCII ring: hero's primary motion centerpiece.
 *
 * APPROACH: Option (a): AsciiEffect wrapped inside R3F.
 * --------------------------------------------------------
 * We keep AsciiEffect (the postFX that walks the rasterised image and
 * rewrites every cell as a glyph) but mount it inside an R3F <Canvas>.
 * The <Canvas> creates and owns the WebGLRenderer; an inner
 * <RingScene> component:
 *   1. Reads `gl, scene, camera, size` from useThree().
 *   2. Lazily instantiates one AsciiEffect that wraps `gl`.
 *   3. Mounts the AsciiEffect's div (a <table> of glyphs) into the
 *      Canvas's parent container, hides the original <canvas>, and
 *      keeps the table sized in lockstep with size changes.
 *   4. Takes over the render loop via `useFrame((_, dt) => …, 1)` and
 *      calls `ascii.render(scene, camera)` instead of the default
 *      WebGL render. (Priority 1 disables R3F's auto-render; see
 *      https://docs.pmnd.rs/react-three-fiber/api/hooks#taking-over-the-render-loop)
 *
 * That gives us full R3F ergonomics (declarative scene, useThree hooks,
 * automatic disposal of geometry/material via JSX unmount) AND keeps
 * AsciiEffect doing what it does best: the deliberate-ASCII look that
 * a custom shader would have to fake at much higher complexity.
 *
 * CURSOR-DRIVEN DEFORMATION
 * -------------------------
 * The torus material is MeshPhongMaterial (preserves the original
 * lighting/brightness response that drives AsciiEffect's glyph density)
 * augmented via onBeforeCompile to inject vertex displacement:
 *   - uMouseNdc: vec2:  mouse in [-1, 1] NDC, lerped 0.12/frame for
 *                       viscous inertia.
 *   - uMouseStrength: f: 0 when cursor offscreen, 1 when active.
 *   - uTime: f:          drives a low-frequency ripple so the surface
 *                        feels alive even at rest near the cursor.
 *   - uFalloff: f:       radius of influence in NDC space.
 *
 * For each vertex: project to NDC in the vertex shader, take XY
 * distance from uMouseNdc, smoothstep falloff (1 → 0 across uFalloff),
 * then displace along the local surface normal by a magnitude that's a
 * mix of (a) pull toward the cursor and (b) a time-driven sinusoid for
 * the "liquid breathing" feel. The result reads as a soft wave of
 * deformation following the cursor, not spiky, not jarring.
 *
 * No React state in the loop; all per-frame work is refs + uniforms.
 */

interface Props {
  /** Brand orange for the glyphs. */
  color?: string;
  /** Seconds per full revolution. Default 26: slow, organic. */
  spinDuration?: number;
}

// PERF (mobile): AsciiEffect.render() does a synchronous GPU→CPU
// getImageData() readback EVERY frame to rebuild the glyph table, and
// that readback cost scales with the backing-store pixel count. Phone
// GPUs are far weaker and this canvas runs `frameloop="always"` over
// the whole hero, so on small/coarse-pointer devices we cap the
// backing store at DPR 1 (vs up to 2× on desktop = ~4× the pixels to
// read back) and drop the torus tessellation; the silhouette is
// quantised into ASCII glyphs anyway, so the lower poly count is
// invisible while halving the vertex shader's per-frame displacement
// work. Evaluated once at module scope (the breakpoint doesn't change
// within a session without a reload).
const IS_SMALL_SCREEN =
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;

export function HeroAsciiRing({
  color = "#e87040",
  spinDuration = 26,
}: Props) {
  return (
    <div className="hero-ascii-ring" aria-hidden>
      <Canvas
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
          // Important: AsciiEffect reads premultiplied pixel data; the
          // default CSS bg handles transparency, so a clear color of
          // (0,0,0,0) is correct here.
          preserveDrawingBuffer: false,
        }}
        camera={{ position: [0, 0, 6.2], fov: 22, near: 0.1, far: 100 }}
        // Mobile caps the backing store at 1× to slash the per-frame
        // AsciiEffect readback; desktop keeps up to 2× for crisp glyphs.
        dpr={IS_SMALL_SCREEN ? 1 : [1, 2]}
        // `frameloop="always"` is fine; we override the render itself via
        // priority frame, so the default render is suppressed.
        frameloop="always"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
        // R3F sets a default tone-mapped clear; we want pure alpha so
        // the AsciiEffect sees the torus on transparent.
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <RingScene color={color} spinDuration={spinDuration} />
      </Canvas>
    </div>
  );
}

/**
 * Inner R3F scene: owns the torus mesh, the AsciiEffect lifecycle,
 * the cursor uniforms, and the manual render call.
 */
function RingScene({
  color,
  spinDuration,
}: {
  color: string;
  spinDuration: number;
}) {
  const { gl, scene, camera, size } = useThree();
  const tiltGroupRef = useRef<THREE.Group>(null);
  const torusRef = useRef<THREE.Mesh>(null);
  const asciiRef = useRef<AsciiEffect | null>(null);
  const lastTRef = useRef(performance.now() / 1000);
  const asciiDtAccRef = useRef(0); // accumulator for 30fps readback cap
  // Entrance: timestamp (s) the ring's reveal began, or null until the hero
  // first reveals (loading scrim lifts). Drives the crossfade-in + the
  // face-on → tilt-back rotation. Runs once.
  const entranceStartRef = useRef<number | null>(null);
  // When the load gate (scrim gone + composition visible) was first met, so
  // we can wait ENTRANCE_DELAY past it before igniting — a beat AFTER the
  // loading screen clears, not right on its fade-out.
  const gateMetAtRef = useRef<number | null>(null);
  const ENTRANCE_DELAY = 0.5; // seconds after the loading screen is gone
  // Tracks the offscreen→onscreen edge so the first resumed frame forces a
  // fresh ascii.render() (no stale-frame flash when scrolling back up).
  const wasOffscreenRef = useRef(true);
  // Last dimensions actually applied via ascii.setSize. setSize is NOT
  // cheap: it rebuilds the glyph-table DOM (innerHTML) and clears the
  // readback canvas, which painted a visible one-frame jump every time
  // the ring resumed from offscreen (the "ring glitches around when I
  // scroll back up" bug: each offscreen boundary crossing forced a
  // mid-frame rebuild at an UNCHANGED size). Cache lets the resume path
  // skip the rebuild unless the container truly resized while asleep.
  const asciiSizeRef = useRef({ w: 0, h: 0 });
  // Resting orientation (the scene's tilt). The entrance rotates the tilt
  // group from 0 (face-on, facing the camera) to these over the reveal.
  const TILT_X = (38 * Math.PI) / 180;
  const TILT_Z = (-12 * Math.PI) / 180;
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // DEV: ?introFreeze=<seconds> freezes the entrance at a fixed elapsed time
  // (et) and bypasses the load gate, so the sub-second reveal can be
  // screenshotted at specific moments for review. null in production.
  const INTRO_FREEZE = (() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("introFreeze");
    if (raw == null) return null;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : null;
  })();

  // PERF: the hero composition is `position: fixed`, so this component
  // NEVER unmounts; even at the footer it kept running AsciiEffect every
  // frame. AsciiEffect.render() walks the rasterised WebGL image via a
  // synchronous getImageData() readback (a GPU→CPU stall, and the source
  // of the recurring "Canvas2D willReadFrequently" warning) to rewrite
  // the glyph table. Once the hero has scrolled out of view there is
  // nothing to see, so we skip the whole render (spin + readback). A
  // passive scroll listener flips a ref; no per-frame layout reads, no
  // React state, no visual change while the ring is on screen.
  const offscreenRef = useRef(false);
  useEffect(() => {
    // Hidden once the hero composition has fully dissolved. The
    // consolidated scroll choreography fades the hero out by ~1.05vh; we
    // gate slightly past that (1.2vh) so the ring keeps animating through
    // the entire visible hero + dissolve and only sleeps once it's truly
    // gone.
    const OFFSCREEN_VH = 1.2;
    let raf = 0;
    const apply = () => {
      const ratio = window.scrollY / Math.max(1, window.innerHeight);
      offscreenRef.current = ratio >= OFFSCREEN_VH;
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
  }, []);

  // ---------------------------------------------------------------
  // Mouse uniforms: refs so the pointer listener can write to them
  // without re-rendering; the material reads from them every frame.
  // ---------------------------------------------------------------
  const mouseTargetRef = useRef(new THREE.Vector2(2, 2)); // offscreen sentinel
  const mouseSmoothedRef = useRef(new THREE.Vector2(2, 2));
  const mouseStrengthTargetRef = useRef(0);
  const mouseStrengthSmoothedRef = useRef(0);

  // ---------------------------------------------------------------
  // Material: MeshPhongMaterial with vertex displacement injected via
  // onBeforeCompile. Memo so it survives re-renders; geometry + material
  // are explicitly disposed via the cleanup effect below.
  // ---------------------------------------------------------------
  const { material, uniforms } = useMemo(() => {
    // Mark dirty signals: these uniforms are also stored on the
    // material's `.userData.shader` after the first compile so we can
    // update them per frame from useFrame.
    const u = {
      uMouseNdc: { value: new THREE.Vector2(2, 2) },
      uMouseStrength: { value: 0 },
      uTime: { value: 0 },
      // Radius of influence in NDC. 0.55 = roughly a third of the
      // viewport diagonal; tuned so the cursor only deforms locally,
      // not the entire ring.
      uFalloff: { value: 0.55 },
      // Peak displacement in world units. Tuned with the torus tube
      // radius (0.30): 0.13 is ~43% of the tube radius which reads as
      // a strong, visible pull without breaking the silhouette.
      uPullAmp: { value: 0.13 },
      // Amplitude of the time-driven ripple on top of the pull. Small
      // (0.025) so it adds life without becoming the dominant motion.
      uRippleAmp: { value: 0.025 },
    };

    const mat = new THREE.MeshPhongMaterial({
      color: 0x202020,
      specular: 0xffffff,
      shininess: 36,
    });

    mat.onBeforeCompile = (shader) => {
      // Hook our uniforms into the compiled program.
      shader.uniforms.uMouseNdc = u.uMouseNdc;
      shader.uniforms.uMouseStrength = u.uMouseStrength;
      shader.uniforms.uTime = u.uTime;
      shader.uniforms.uFalloff = u.uFalloff;
      shader.uniforms.uPullAmp = u.uPullAmp;
      shader.uniforms.uRippleAmp = u.uRippleAmp;

      // Inject uniform declarations + a helper at the top of the
      // vertex shader.
      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        /* glsl */ `
          #include <common>
          uniform vec2 uMouseNdc;
          uniform float uMouseStrength;
          uniform float uTime;
          uniform float uFalloff;
          uniform float uPullAmp;
          uniform float uRippleAmp;
        `,
      );

      // Inject displacement at the begin_vertex chunk: the place
      // three.js exposes for transforming the vertex position before
      // projection. We project the un-displaced vertex to NDC, measure
      // distance to the cursor in NDC space, then displace the local
      // position along the surface normal by a smooth falloff.
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `
          #include <begin_vertex>

          // Project the resting vertex to NDC so the cursor-distance
          // calculation matches what the user actually sees on screen.
          vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
          vec4 clipPos = projectionMatrix * viewMatrix * worldPos;
          vec2 ndc = clipPos.xy / max(clipPos.w, 0.0001);

          float d = distance(ndc, uMouseNdc);
          // Smooth falloff: 1 at the cursor, 0 past uFalloff.
          float fall = 1.0 - smoothstep(0.0, uFalloff, d);
          // Sharpen so the peak feels concentrated. pow shapes the
          // wave from a soft dome into a more focal pull.
          fall = pow(fall, 1.6);

          // Liquid breathing: a low-freq sin riding on the falloff so
          // even the steady-state cursor proximity has subtle motion.
          float ripple = sin(uTime * 1.8 + d * 9.0) * uRippleAmp * fall;

          // Pull magnitude: direction is the outward surface normal in
          // local space. This makes the torus tube swell outward toward
          // the cursor zone, reading as a liquid bulge rather than a
          // sideways shear.
          float pull = uPullAmp * fall * uMouseStrength;

          transformed += normal * (pull + ripple);
        `,
      );

      // Stash so we have a direct handle to the live uniform refs
      // post-compile (some three.js versions copy uniforms on compile).
      mat.userData.shader = shader;
    };

    // Force a re-compile if onBeforeCompile changes (it won't here, but
    // safe to set):
    mat.customProgramCacheKey = () => "hero-ring-cursor-pull-v3";

    return { material: mat, uniforms: u };
  }, []);

  // ---------------------------------------------------------------
  // AsciiEffect lifecycle: instantiate once after we have gl + a DOM
  // parent. Mount its DOM as a sibling of the <canvas>, hide the
  // canvas itself (the WebGL output is consumed by AsciiEffect, the
  // user sees only the glyph table).
  // ---------------------------------------------------------------
  useEffect(() => {
    const canvasEl = gl.domElement;
    const container = canvasEl.parentElement;
    if (!container) return;

    const ascii = new AsciiEffect(gl, "@%#*+=-:. ", {
      invert: false,
      resolution: 0.16,
      scale: 1,
    });
    asciiRef.current = ascii;

    const dom = ascii.domElement;
    dom.style.position = "absolute";
    dom.style.inset = "0";
    dom.style.width = "100%";
    dom.style.height = "100%";
    dom.style.color = color;
    dom.style.background = "transparent";
    dom.style.userSelect = "none";
    dom.style.pointerEvents = "none";
    dom.style.opacity = "0"; // hidden until the entrance crossfades it in
    container.appendChild(dom);

    // Hide the raw WebGL canvas: AsciiEffect re-renders its content as
    // text. Leaving the canvas visible would double the silhouette.
    canvasEl.style.visibility = "hidden";

    // Initial sizing.
    ascii.setSize(container.clientWidth, container.clientHeight);
    asciiSizeRef.current = {
      w: container.clientWidth,
      h: container.clientHeight,
    };

    return () => {
      if (dom.parentNode === container) container.removeChild(dom);
      canvasEl.style.visibility = "";
      asciiRef.current = null;
    };
    // Re-create only if the color changes (cheap; AsciiEffect doesn't
    // expose a color setter on its own).
  }, [gl, color]);

  // Keep AsciiEffect dimensions in sync with the R3F canvas size.
  useEffect(() => {
    const ascii = asciiRef.current;
    if (!ascii) return;
    ascii.setSize(size.width, size.height);
    asciiSizeRef.current = { w: size.width, h: size.height };
  }, [size.width, size.height]);

  // ---------------------------------------------------------------
  // Pointer tracking: document-level so the cursor influence reaches
  // the ring even when the pointer is over UI siblings (the wordmark,
  // the meta line). We convert client coords to NDC matched to the
  // ring container, so distances in the vertex shader align with the
  // ring's actual on-screen footprint.
  // ---------------------------------------------------------------
  useEffect(() => {
    const canvasEl = gl.domElement;
    const container = canvasEl.parentElement;
    if (!container) return;

    const onMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      mouseTargetRef.current.set(x, y);
      mouseStrengthTargetRef.current = 1;
    };
    const onLeave = () => {
      mouseStrengthTargetRef.current = 0;
    };
    const onTouch = (e: TouchEvent) => {
      if (!e.touches.length) return;
      const t = e.touches[0]!;
      const rect = container.getBoundingClientRect();
      const x = ((t.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((t.clientY - rect.top) / rect.height) * 2 - 1);
      mouseTargetRef.current.set(x, y);
      mouseStrengthTargetRef.current = 1;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);
    window.addEventListener("blur", onLeave);
    window.addEventListener("touchmove", onTouch, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("touchmove", onTouch);
    };
  }, [gl]);

  // ---------------------------------------------------------------
  // Frame loop: priority=1 takes ownership of the render loop, so we
  // can substitute ascii.render() for the default gl.render().
  // ---------------------------------------------------------------
  useFrame(() => {
    const ascii = asciiRef.current;
    const torus = torusRef.current;
    if (!ascii || !torus) return;

    // PERF: hero scrolled away → skip the spin + the AsciiEffect readback
    // entirely. Keep lastTRef current so the spin doesn't jump when the
    // user scrolls back up (dt is clamped, but advancing the timestamp
    // avoids a large catch-up step). The priority-1 useFrame still
    // suppresses R3F's default render, so returning here means this
    // canvas does NO GPU work while the hero is out of view.
    if (offscreenRef.current) {
      lastTRef.current = performance.now() / 1000;
      wasOffscreenRef.current = true;
      return;
    }

    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - lastTRef.current);
    lastTRef.current = now;

    // On re-entry from off-screen, re-measure the LIVE container and
    // resize ONLY if it actually changed while the ring was asleep
    // (e.g. a window resize mid-page). The unconditional setSize that
    // used to live here rebuilt the glyph-table DOM + cleared the
    // readback canvas on EVERY boundary crossing, which is what made
    // the ring visibly glitch/jump when scrolling back up to the hero.
    if (wasOffscreenRef.current) {
      const container = gl.domElement.parentElement;
      if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        const cw = container.clientWidth;
        const ch = container.clientHeight;
        if (cw !== asciiSizeRef.current.w || ch !== asciiSizeRef.current.h) {
          ascii.setSize(cw, ch);
          asciiSizeRef.current = { w: cw, h: ch };
        }
      }
    }

    // Kick off the entrance only once the LOADING SCREEN is gone AND the
    // composition is revealed: `loading-active` is removed (scrim cleared)
    // ~0.72s after the composition reveals, which is LATER than is-settled
    // (~0.6s) — so gating on is-settled started the entrance while the
    // loading scrim was still up. Wait for both. The ignition blast uses
    // the same gate so they fire together on a clean, fully-loaded hero.
    if (INTRO_FREEZE == null) {
      if (entranceStartRef.current === null) {
        const gateMet =
          document.querySelector(".hero-composition.is-visible") &&
          !document.documentElement.classList.contains("loading-active");
        if (gateMet) {
          // Wait ENTRANCE_DELAY past the loading screen clearing before
          // igniting, so the blast lands a beat AFTER the load-in, not on it.
          if (gateMetAtRef.current === null) gateMetAtRef.current = now;
          if (now - gateMetAtRef.current >= ENTRANCE_DELAY) {
            entranceStartRef.current = now;
          }
        }
      }
      // Nothing to show until the entrance has begun: skip the render so the
      // ring never flashes face-on at full opacity before its crossfade, and
      // the first entrance frame is guaranteed fresh.
      if (entranceStartRef.current === null) {
        wasOffscreenRef.current = true;
        return;
      }
    }

    const ss = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    // Entrance choreography (snappy, ~1.3s), driven entirely here on the
    // fully-revealed hero:
    //   crossfade in FACE-ON (0–0.35s) → hold a beat → TILT back to the
    //   scene lean (0.4–1.1s).
    // The SPIN stays at the normal resting rate the whole time — a fast
    // spin-up read as broken/inconsistent, so the only "rotation" of the
    // entrance is the tilt into the scene. The ignition blast plays over
    // the same window.
    const et = INTRO_FREEZE != null ? INTRO_FREEZE : now - entranceStartRef.current!;
    let ringOpacity: number, tiltT: number;
    if (reducedMotion) {
      ringOpacity = 1; tiltT = 1;       // land at rest immediately
    } else {
      // Ring crossfades in face-on early (0–0.35s) over the blast, then
      // rotates into the scene lean (0.4–1.1s). (Pulled ~0.5s sooner than
      // the prior 0.35–0.7s delay per feedback.)
      ringOpacity = ss(0.0, 0.35, et);
      tiltT = ss(0.4, 1.1, et);
    }
    const entering = INTRO_FREEZE != null || et < 1.3;

    // Apply orientation (face-on → resting lean) + the crossfade opacity.
    const tg = tiltGroupRef.current;
    if (tg) tg.rotation.set(tiltT * TILT_X, 0, tiltT * TILT_Z);
    (ascii.domElement as HTMLElement).style.opacity = ringOpacity.toFixed(3);

    // Spin on the torus's local Y axis — constant normal rate (no spin-up).
    const spinPerSec = (Math.PI * 2) / spinDuration;
    torus.rotation.y += spinPerSec * dt;

    // Viscous cursor lerp: uniform inertia at 0.12/frame is what makes
    // the deformation feel liquid (drag behind the cursor, settles back
    // smoothly when the cursor stops).
    mouseSmoothedRef.current.lerp(mouseTargetRef.current, 0.12);
    mouseStrengthSmoothedRef.current +=
      (mouseStrengthTargetRef.current - mouseStrengthSmoothedRef.current) *
      0.08;

    // Push to the live shader uniforms. We read from material.userData
    // .shader if available (preferred: that's the post-compile copy),
    // else fall back to the original `uniforms` object that we wired
    // up in onBeforeCompile.
    const shader =
      (material.userData.shader as { uniforms: typeof uniforms } | undefined) ??
      { uniforms };
    shader.uniforms.uMouseNdc.value.copy(mouseSmoothedRef.current);
    shader.uniforms.uMouseStrength.value = mouseStrengthSmoothedRef.current;
    shader.uniforms.uTime.value = now;

    // Render via AsciiEffect, NOT gl.render: this produces the glyph table
    // in the DOM. priority=1 suppresses R3F's default render.
    //
    // PERF: ascii.render() does a synchronous GPU→CPU readback + glyph
    // rebuild; normally capped at 30fps via the accumulator. We BYPASS the
    // cap when (a) resuming from offscreen — the first visible frame must be
    // fresh or the user sees the stale pre-scroll frame flash on the way
    // back up; and (b) mid-entrance — the tilt/spin-up needs every frame.
    const resuming = wasOffscreenRef.current;
    wasOffscreenRef.current = false;
    const forceRender = resuming || entering;
    asciiDtAccRef.current += dt;
    if (forceRender) {
      asciiDtAccRef.current = 0;
      ascii.render(scene, camera);
    } else if (asciiDtAccRef.current >= 1 / 30) {
      asciiDtAccRef.current -= 1 / 30;
      ascii.render(scene, camera);
    }
  }, 1);

  // Cleanup the geometry/material on unmount (memoised material isn't
  // automatically disposed by R3F since we created it imperatively).
  useEffect(() => {
    return () => {
      material.dispose();
    };
  }, [material]);

  return (
    <>
      {/* Lighting: same key/fill/ambient as the vanilla version. The
          ASCII effect quantises brightness into glyph density so we
          want a strong gradient across the torus surface. */}
      <directionalLight position={[-2.2, 1.6, 3.0]} intensity={2.4} />
      <directionalLight position={[2.0, -1.0, 2.5]} intensity={0.9} />
      <ambientLight intensity={0.18} />

      {/* Tilt group + torus: torus spins on local Y inside the tilted
          parent so the silhouette actually changes over time (spinning
          a torus on its own symmetry axis would be invisible). */}
      {/* Starts face-on (0,0,0); the entrance in useFrame tilts it back to
          the resting lean (TILT_X / TILT_Z) as the ring crossfades in. */}
      <group ref={tiltGroupRef} rotation={[0, 0, 0]}>
        <mesh ref={torusRef} material={material}>
          {/* Mobile: 24×160 vs desktop 40×260 segments. The torus is
              rasterised then re-quantised into ASCII cells (resolution
              0.16), so the coarser mesh is visually indistinguishable
              while cutting the per-frame vertex-displacement cost ~63%. */}
          <torusGeometry
            args={IS_SMALL_SCREEN ? [1.25, 0.3, 24, 160] : [1.25, 0.3, 40, 260]}
          />
        </mesh>
      </group>
    </>
  );
}
