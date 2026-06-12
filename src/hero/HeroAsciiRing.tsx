import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Big bold glyph ring: hero's primary motion centerpiece.
 *
 * APPROACH: GPU glyph-grid dither post-process (replaces AsciiEffect).
 * ---------------------------------------------------------------------
 * The old version was three's AsciiEffect: a synchronous GPU->CPU
 * getImageData readback every frame feeding a DOM <table> of glyphs.
 * This version is a pure-GPU two-pass pipeline:
 *
 *   PASS 1 (scene -> tiny render target, ONE TEXEL PER GLYPH CELL):
 *     The torus renders with a raw ShaderMaterial that encodes
 *       R,G = flat per-face view-space normal.xy (dFdx/dFdy of the
 *             view position, so every facet is constant -> faceted)
 *       B   = lit luminance (key + fill + spec, computed in-shader)
 *       A   = coverage (1 where the torus is, 0 elsewhere)
 *
 *   PASS 2 (fullscreen quad -> canvas):
 *     For each screen pixel: find its glyph cell, read the cell's
 *     texel, then
 *       - LUMINANCE -> GLYPH: Bayer-dithered quantization picks a
 *         glyph from a canvas-baked atlas ramp (" .:-=+*x#%@").
 *       - PER-FACE NORMAL -> PALETTE: the facet normal dotted with
 *         the key-light direction is quantized into discrete bands
 *         across the orange family (shadow -> accent -> lit -> hot),
 *         which is what gives the ring its volumetric shading.
 *     Empty cells render a faint sparse glyph field so the page keeps
 *     the textured backdrop the old table gave it.
 *
 * No readback, no DOM table, no 30fps cap: the whole thing is one
 * small RT render plus one fullscreen draw.
 *
 * CURSOR-DRIVEN DEFORMATION
 * -------------------------
 * Unchanged from the AsciiEffect version, now living in the pass-1
 * vertex shader directly: uMouseNdc/uMouseStrength/uTime/uFalloff
 * displace vertices along their normals with a smooth NDC falloff +
 * a low-frequency ripple, so the surface bulges liquidly toward the
 * cursor. No React state in the loop; refs + uniforms only.
 */

interface Props {
  /** Brand orange: the palette's BASE band. */
  color?: string;
  /** Seconds per full revolution. Default 26: slow, organic. */
  spinDuration?: number;
}

// PERF (mobile): the post pass scales with canvas pixels, so coarse
// devices cap DPR at 1 (vs up to 2x desktop). Tessellation also drops:
// with flat per-face normals the facet size IS the look, and chunkier
// facets read fine (arguably better) on a small screen.
const IS_SMALL_SCREEN =
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;

// Glyph cell size in CSS px. The grid (and the pass-1 render target)
// is the container size divided by this.
const CELL_PX = 9;

// Luminance ramp, sparse -> dense. Index 0 is a SPACE: the darkest
// faces dissolve into nothing, which is what makes the dither read as
// a dissolving volume instead of a solid cut-out.
const GLYPH_RAMP = " .:-=+*x#%@";

/** Canvas-baked glyph atlas: GLYPH_RAMP in one horizontal strip, white
 *  on transparent; the post shader samples its alpha as the glyph mask. */
function buildGlyphAtlas(): THREE.CanvasTexture {
  const N = GLYPH_RAMP.length;
  const TILE = 64;
  const cv = document.createElement("canvas");
  cv.width = N * TILE;
  cv.height = TILE;
  const ctx = cv.getContext("2d")!;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${Math.round(TILE * 0.72)}px ui-monospace, Menlo, Consolas, "Courier New", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < N; i++) {
    ctx.fillText(GLYPH_RAMP[i]!, i * TILE + TILE / 2, TILE / 2 + TILE * 0.04);
  }
  const tex = new THREE.CanvasTexture(cv);
  // No mips: tiles would bleed into their neighbours at low mip levels.
  // Cells are ~9-18 device px, plain linear is clean enough.
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ---------------------------------------------------------------------
// PASS 1: torus material. Outputs data, not color: flat normal.xy in
// RG, luminance in B, coverage in A. (No colorspace conversion here on
// purpose; this is an encoding, not an image.)
// ---------------------------------------------------------------------
const RING_VERT = /* glsl */ `
  uniform vec2 uMouseNdc;
  uniform float uMouseStrength;
  uniform float uTime;
  uniform float uFalloff;
  uniform float uPullAmp;
  uniform float uRippleAmp;
  varying vec3 vViewPos;

  void main() {
    vec3 transformed = position;

    // Project the resting vertex to NDC so the cursor-distance
    // calculation matches what the user actually sees on screen.
    vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
    vec4 clipPos = projectionMatrix * viewMatrix * worldPos;
    vec2 ndc = clipPos.xy / max(clipPos.w, 0.0001);

    float d = distance(ndc, uMouseNdc);
    // Smooth falloff: 1 at the cursor, 0 past uFalloff; pow sharpens
    // the dome into a focal pull.
    float fall = pow(1.0 - smoothstep(0.0, uFalloff, d), 1.6);

    // Liquid breathing: low-freq sin riding the falloff.
    float ripple = sin(uTime * 1.8 + d * 9.0) * uRippleAmp * fall;
    float pull = uPullAmp * fall * uMouseStrength;
    transformed += normal * (pull + ripple);

    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    vViewPos = mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const RING_FRAG = /* glsl */ `
  uniform vec3 uKeyDir;
  uniform vec3 uFillDir;
  varying vec3 vViewPos;

  void main() {
    // FLAT per-face normal from screen-space derivatives of the view
    // position: constant across each facet, which is what lets the
    // post pass shift the palette per face.
    vec3 n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));

    float diff = max(dot(n, uKeyDir), 0.0);
    float fill = max(dot(n, uFillDir), 0.0);
    vec3 v = normalize(-vViewPos);
    vec3 h = normalize(uKeyDir + v);
    float spec = pow(max(dot(n, h), 0.0), 36.0);
    // Generous floor + fill so even away-facing facets keep mid-ramp
    // glyph density: the ring must hold its bold mass on the light
    // page; the palette bands carry the volume, density carries form.
    float lum = clamp(0.18 + diff * 0.85 + fill * 0.38 + spec * 0.5, 0.0, 1.0);

    gl_FragColor = vec4(n.xy * 0.5 + 0.5, lum, 1.0);
  }
`;

// ---------------------------------------------------------------------
// PASS 2: fullscreen glyph-grid dither.
// ---------------------------------------------------------------------
const POST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const POST_FRAG = /* glsl */ `
  uniform sampler2D uScene;
  uniform sampler2D uGlyphs;
  uniform vec2 uGrid;
  uniform float uGlyphCount;
  uniform vec3 uShadow;
  uniform vec3 uBase;
  uniform vec3 uLit;
  uniform vec3 uHot;
  uniform vec3 uPaletteDir;
  varying vec2 vUv;

  // Recursive 2x2 -> 4x4 ordered (Bayer) matrix from cell coords.
  float bayer2(vec2 p) {
    float x2 = mod(p.x, 2.0);
    float y2 = mod(p.y, 2.0);
    return 3.0 * y2 + x2 * (2.0 - 4.0 * y2); // [[0,2],[3,1]]
  }
  float bayer4(vec2 p) {
    p = floor(p);
    return (4.0 * bayer2(floor(p / 2.0)) + bayer2(p) + 0.5) / 16.0;
  }

  void main() {
    vec2 g = vUv * uGrid;
    vec2 cell = floor(g);
    vec2 cellUv = fract(g);
    vec4 s = texture2D(uScene, (cell + 0.5) / uGrid);
    float dith = bayer4(cell);

    vec3 col;
    float a;
    if (s.a > 0.5) {
      // LUMINANCE -> GLYPH: ordered-dither quantization into the ramp.
      float lum = s.b;
      float idx = clamp(
        floor(lum * uGlyphCount + (dith - 0.5)),
        0.0,
        uGlyphCount - 1.0
      );
      float mask = texture2D(
        uGlyphs,
        vec2((idx + cellUv.x) / uGlyphCount, cellUv.y)
      ).a;

      // PER-FACE NORMAL -> PALETTE: reconstruct the facet normal, dot
      // it with the key-light axis, quantize into discrete bands so
      // adjacent facets snap to distinct tones (the volumetric read).
      vec2 nxy = s.rg * 2.0 - 1.0;
      float nz = sqrt(max(0.0, 1.0 - dot(nxy, nxy)));
      float t = clamp(dot(vec3(nxy, nz), uPaletteDir) * 0.5 + 0.5, 0.0, 1.0);
      float tq = floor(t * 4.0 + 0.5) / 4.0;
      col = tq < 0.5
        ? mix(uShadow, uBase, tq * 2.0)
        : mix(uBase, uLit, (tq - 0.5) * 2.0);
      // Specular tips flash hot (near-white peach) at peak luminance.
      col = mix(col, uHot, smoothstep(0.9, 1.0, lum) * 0.65);
      a = mask;
    } else {
      // Ambient field: sparse faint glyphs over empty cells so the
      // hero keeps its full-bleed texture (the old table's backdrop).
      float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      float fieldIdx = h > 0.78 ? 3.0 : 1.0; // mostly '.', sometimes '-'
      float mask = texture2D(
        uGlyphs,
        vec2((fieldIdx + cellUv.x) / uGlyphCount, cellUv.y)
      ).a;
      col = uBase;
      a = mask * 0.30;
    }

    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
    // Premultiply for NoBlending onto the alpha canvas (the page bg
    // composites behind; entrance opacity is CSS on the canvas).
    gl_FragColor.rgb *= gl_FragColor.a;
  }
`;

export function HeroAsciiRing({
  color = "#e87040",
  spinDuration = 26,
}: Props) {
  return (
    <div className="hero-ascii-ring" aria-hidden>
      <Canvas
        // CRITICAL: measure layout size (offsetWidth), NOT the
        // transformed bounding box. The hero composition scales up to
        // 3x during the dive-out; R3F's default measurement uses
        // getBoundingClientRect, which INCLUDES that ancestor scale, so
        // the canvas would "resize" to ~3x mid-dive and back. offsetSize
        // keeps the canvas pinned to the untransformed 130vw box.
        resize={{ offsetSize: true }}
        gl={{
          antialias: false, // pass 1 is a data buffer; AA would blur the encoding
          alpha: true,
          powerPreference: "high-performance",
          preserveDrawingBuffer: false,
        }}
        camera={{ position: [0, 0, 6.2], fov: 22, near: 0.1, far: 100 }}
        dpr={IS_SMALL_SCREEN ? 1 : [1, 2]}
        // We own the render via a priority-1 useFrame (two manual passes).
        frameloop="always"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
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
 * Inner R3F scene: owns the torus mesh, the two-pass pipeline, the
 * cursor uniforms, and the manual render calls.
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
  const lastTRef = useRef(performance.now() / 1000);
  // Entrance: timestamp (s) the ring's reveal began, or null until the hero
  // first reveals (loading scrim lifts). Drives the crossfade-in + the
  // face-on -> tilt-back rotation. Runs once.
  const entranceStartRef = useRef<number | null>(null);
  const gateMetAtRef = useRef<number | null>(null);
  const ENTRANCE_DELAY = 0.5; // seconds after the loading screen is gone
  const wasOffscreenRef = useRef(true);
  // Resting orientation (the scene's tilt). The entrance rotates the tilt
  // group from 0 (face-on) to these over the reveal.
  const TILT_X = (38 * Math.PI) / 180;
  const TILT_Z = (-12 * Math.PI) / 180;
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // DEV: ?introFreeze=<seconds> freezes the entrance at a fixed elapsed time
  // and bypasses the load gate, for screenshotting specific reveal moments.
  const INTRO_FREEZE = (() => {
    if (typeof window === "undefined") return null;
    const raw = new URLSearchParams(window.location.search).get("introFreeze");
    if (raw == null) return null;
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : null;
  })();

  // PERF: the hero composition is `position: fixed`, so this component
  // NEVER unmounts. Once the hero has scrolled out of view we skip both
  // passes entirely (zero GPU work) via this ref; a passive scroll
  // listener flips it, no per-frame layout reads.
  const offscreenRef = useRef(false);
  useEffect(() => {
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
  // Pipeline objects: ring material, render target, glyph atlas, post
  // scene. All imperative, memoised once, disposed on unmount.
  // ---------------------------------------------------------------
  const pipeline = useMemo(() => {
    const keyDir = new THREE.Vector3(-2.2, 1.6, 3.0).normalize();
    const fillDir = new THREE.Vector3(2.0, -1.0, 2.5).normalize();

    const ringMaterial = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: {
        uMouseNdc: { value: new THREE.Vector2(2, 2) },
        uMouseStrength: { value: 0 },
        uTime: { value: 0 },
        // Radius of influence in NDC; ~a third of the viewport diagonal.
        uFalloff: { value: 0.55 },
        // Peak displacement in world units (~43% of the tube radius).
        uPullAmp: { value: 0.13 },
        // Time-driven ripple amplitude on top of the pull.
        uRippleAmp: { value: 0.025 },
        uKeyDir: { value: keyDir },
        uFillDir: { value: fillDir },
      },
    });

    // One texel per glyph cell; nearest both ways (it's a data buffer).
    const rt = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });

    const atlas = buildGlyphAtlas();

    // Palette: the orange family already on the page. uBase is the
    // brand accent (prop); shadow/lit/hot are fixed family stops.
    // THREE.Color converts sRGB hex -> linear under ColorManagement;
    // the post shader's colorspace_fragment converts back on output.
    const postMaterial = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        uScene: { value: rt.texture },
        uGlyphs: { value: atlas },
        uGrid: { value: new THREE.Vector2(4, 4) },
        uGlyphCount: { value: GLYPH_RAMP.length },
        // LIGHT-PAGE palette direction: on the cool-white page, faces
        // toward the key light ADVANCE (deep saturated orange) and
        // shadow faces recede, but only to a mid peach: every band has
        // to stay unmistakably orange or the ring loses its mass. (A
        // near-page pale stop read as a washed gray band; "lit =
        // lighter" before that washed the whole ring to white.)
        uShadow: { value: new THREE.Color("#ef9663") },
        uBase: { value: new THREE.Color(color) },
        uLit: { value: new THREE.Color("#c44a12") },
        uHot: { value: new THREE.Color("#ff7a30") },
        uPaletteDir: { value: keyDir.clone() },
      },
      // Premultiplied output written raw into the alpha canvas.
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    });

    const postScene = new THREE.Scene();
    const postQuad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      postMaterial,
    );
    postQuad.frustumCulled = false;
    postScene.add(postQuad);
    const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    return { ringMaterial, rt, atlas, postMaterial, postScene, postQuad, postCam };
    // color is captured at mount; the brand accent doesn't change live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the cell grid (and the pass-1 target) in lockstep with the
  // canvas CSS size: one RT texel per CELL_PX square.
  useEffect(() => {
    const gw = Math.max(4, Math.round(size.width / CELL_PX));
    const gh = Math.max(4, Math.round(size.height / CELL_PX));
    pipeline.rt.setSize(gw, gh);
    (pipeline.postMaterial.uniforms.uGrid!.value as THREE.Vector2).set(gw, gh);
  }, [size.width, size.height, pipeline]);

  // ---------------------------------------------------------------
  // Pointer tracking: document-level so the cursor influence reaches
  // the ring even when the pointer is over UI siblings. Client coords
  // are converted to NDC matched to the ring container.
  // ---------------------------------------------------------------
  useEffect(() => {
    const canvasEl = gl.domElement;
    const container = canvasEl.parentElement;
    if (!container) return;

    // PERF: skip the layout read entirely while the ring is scrolled
    // out; the uniforms it feeds aren't rendered then anyway.
    const onMove = (e: PointerEvent) => {
      if (offscreenRef.current) return;
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
      if (offscreenRef.current) return;
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
  // Frame loop: priority=1 takes ownership of the render loop so we
  // can run the two manual passes instead of R3F's default render.
  // ---------------------------------------------------------------
  useFrame(() => {
    const torus = torusRef.current;
    if (!torus) return;

    // Hero scrolled away -> no GPU work at all; keep the clock current
    // so the spin doesn't jump on resume.
    if (offscreenRef.current) {
      lastTRef.current = performance.now() / 1000;
      wasOffscreenRef.current = true;
      return;
    }

    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - lastTRef.current);
    lastTRef.current = now;

    // Kick off the entrance only once the LOADING SCREEN is gone AND
    // the composition is revealed, plus a beat (ENTRANCE_DELAY), same
    // gate as the ignition blast.
    if (INTRO_FREEZE == null) {
      if (entranceStartRef.current === null) {
        const gateMet =
          document.querySelector(".hero-composition.is-visible") &&
          !document.documentElement.classList.contains("loading-active");
        if (gateMet) {
          if (gateMetAtRef.current === null) gateMetAtRef.current = now;
          if (now - gateMetAtRef.current >= ENTRANCE_DELAY) {
            entranceStartRef.current = now;
          }
        }
      }
      // Nothing to show until the entrance begins: skip the render so
      // the ring never flashes at full opacity before its crossfade.
      if (entranceStartRef.current === null) {
        wasOffscreenRef.current = true;
        return;
      }
    }

    const ss = (a: number, b: number, x: number) => {
      const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    // Entrance choreography (~1.3s): crossfade in FACE-ON (0-0.35s),
    // hold a beat, TILT back to the scene lean (0.4-1.1s). Spin stays
    // at the resting rate throughout.
    const et =
      INTRO_FREEZE != null ? INTRO_FREEZE : now - entranceStartRef.current!;
    let ringOpacity: number, tiltT: number;
    if (reducedMotion) {
      ringOpacity = 1;
      tiltT = 1; // land at rest immediately
    } else {
      ringOpacity = ss(0.0, 0.35, et);
      tiltT = ss(0.4, 1.1, et);
    }

    // Apply orientation + the crossfade opacity (CSS on the canvas).
    const tg = tiltGroupRef.current;
    if (tg) tg.rotation.set(tiltT * TILT_X, 0, tiltT * TILT_Z);
    gl.domElement.style.opacity = ringOpacity.toFixed(3);

    // Spin on the torus's local Y axis.
    const spinPerSec = (Math.PI * 2) / spinDuration;
    torus.rotation.y += spinPerSec * dt;

    // Viscous cursor lerp (frame-rate independent).
    mouseSmoothedRef.current.lerp(
      mouseTargetRef.current,
      1 - Math.exp(-dt * 7.7),
    );
    mouseStrengthSmoothedRef.current +=
      (mouseStrengthTargetRef.current - mouseStrengthSmoothedRef.current) *
      (1 - Math.exp(-dt * 5.0));

    const u = pipeline.ringMaterial.uniforms;
    (u.uMouseNdc!.value as THREE.Vector2).copy(mouseSmoothedRef.current);
    u.uMouseStrength!.value = mouseStrengthSmoothedRef.current;
    u.uTime!.value = now;

    wasOffscreenRef.current = false;

    // PASS 1: torus -> cell-grid data target.
    gl.setRenderTarget(pipeline.rt);
    gl.render(scene, camera);
    // PASS 2: glyph-grid dither -> canvas.
    gl.setRenderTarget(null);
    gl.render(pipeline.postScene, pipeline.postCam);
  }, 1);

  // Dispose the imperative pipeline on unmount.
  useEffect(() => {
    return () => {
      pipeline.ringMaterial.dispose();
      pipeline.postMaterial.dispose();
      pipeline.postQuad.geometry.dispose();
      pipeline.rt.dispose();
      pipeline.atlas.dispose();
    };
  }, [pipeline]);

  return (
    /* Tilt group + torus: torus spins on local Y inside the tilted
       parent so the silhouette actually changes over time. Starts
       face-on; the entrance tilts it back to the resting lean.
       DELIBERATELY LOW TESSELLATION: with flat per-face normals the
       facets are the visual unit; ~16 degree facets give each face a
       readable palette band of its own. */
    <group ref={tiltGroupRef} rotation={[0, 0, 0]}>
      <mesh ref={torusRef} material={pipeline.ringMaterial}>
        <torusGeometry
          args={IS_SMALL_SCREEN ? [1.25, 0.3, 16, 88] : [1.25, 0.3, 22, 120]}
        />
      </mesh>
    </group>
  );
}
