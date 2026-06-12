import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Big bold tile ring: hero's primary motion centerpiece.
 *
 * APPROACH: GPU geometric-tile dither post-process. NO ASCII, no text
 * glyphs, no font atlas: the tile vocabulary is procedural geometry
 * drawn in-shader: small squares, diagonal lines, cross-hatch, outline
 * boxes, filled squares. Two passes:
 *
 *   PASS 1 (scene -> tiny render target, ONE TEXEL PER TILE CELL):
 *     The torus renders with a raw ShaderMaterial that encodes
 *       R,G = flat per-face view-space normal.xy (dFdx/dFdy of the
 *             view position, so every facet is constant -> faceted)
 *       B   = lit luminance (key + fill + spec, computed in-shader)
 *       A   = coverage (1 where the torus is, 0 elsewhere)
 *
 *   PASS 2 (fullscreen quad -> canvas):
 *     For each screen pixel: find its tile cell, read the cell's
 *     texel, then
 *       - LUMINANCE -> TILE: Bayer-dithered quantization picks a tile
 *         from the density ramp (empty -> small square -> diagonal ->
 *         cross -> outline box -> box+slash -> inset square -> full
 *         square). Hard step() edges: crisp pixel shapes, on-voice
 *         with the sharp-corner system.
 *       - PER-FACE NORMAL -> PALETTE: the facet normal dotted with
 *         the key-light direction is quantized into discrete bands
 *         across the orange family, giving the volumetric shading.
 *     Empty cells render a faint sparse tile field so the page keeps
 *     its full-bleed texture.
 *
 * CURSOR-DRIVEN DEFORMATION
 * -------------------------
 * uMouseNdc/uMouseStrength/uTime/uFalloff displace vertices along
 * their normals with a smooth NDC falloff + a low-frequency ripple in
 * the pass-1 vertex shader, so the surface bulges liquidly toward the
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
// facets read fine on a small screen.
const IS_SMALL_SCREEN =
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;

// Tile cell size in CSS px. The grid (and the pass-1 render target)
// is the container size divided by this. Geometric tiles need a touch
// more room than text glyphs did to read as shapes.
const CELL_PX = 10;

// Number of tiles in the density ramp (must match tileMask in the
// post shader): empty, small square, diagonal, cross, outline box,
// box + slash, inset square, full square.
const TILE_COUNT = 8;

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
    // Moderate floor: away-facing facets thin into diagonals / small
    // squares while key-lit facets pack into filled squares. The wide
    // density range is what makes the volume read; the palette bands
    // reinforce it.
    float lum = clamp(0.10 + diff * 0.92 + fill * 0.30 + spec * 0.5, 0.0, 1.0);

    gl_FragColor = vec4(n.xy * 0.5 + 0.5, lum, 1.0);
  }
`;

// ---------------------------------------------------------------------
// PASS 2: fullscreen geometric-tile dither.
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
  uniform vec2 uGrid;
  uniform float uTileCount;
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

  // Procedural geometric tiles, density ramp 0..7. p is cell-local UV
  // in [0,1]^2. Hard step() edges on purpose: crisp pixel shapes (the
  // site's sharp-corner voice), no font, no texture.
  float tileMask(float idx, vec2 p) {
    vec2 a = abs(p - 0.5);
    float box = max(a.x, a.y);          // Chebyshev distance: squares
    float d1 = abs(p.x + p.y - 1.0);    // diagonal (rising)
    // NOTE: never end a GLSL comment with a backslash; it line-splices.
    float d2 = abs(p.x - p.y);          // diagonal (falling)
    float inTile = step(box, 0.42);     // keep shapes off the cell seam

    if (idx < 0.5) {
      return 0.0;                                        // empty
    } else if (idx < 1.5) {
      return step(box, 0.13);                            // small square
    } else if (idx < 2.5) {
      return step(d1, 0.11) * inTile;                    // diagonal /
    } else if (idx < 3.5) {
      return max(step(d1, 0.10), step(d2, 0.10)) * inTile; // cross-hatch X
    } else if (idx < 4.5) {
      return step(box, 0.40) - step(box, 0.26);          // outline box
    } else if (idx < 5.5) {
      float frame = step(box, 0.40) - step(box, 0.26);   // box + slash
      float slash = step(d1, 0.10) * step(box, 0.26);
      return clamp(frame + slash, 0.0, 1.0);
    } else if (idx < 6.5) {
      return step(box, 0.30);                            // inset square
    }
    return step(box, 0.44);                              // full square
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
      // LUMINANCE -> TILE: ordered-dither quantization into the ramp.
      float lum = s.b;
      float idx = clamp(
        floor(lum * uTileCount + (dith - 0.5)),
        0.0,
        uTileCount - 1.0
      );
      float mask = tileMask(idx, cellUv);

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
      // Specular tips flash hot at peak luminance.
      col = mix(col, uHot, smoothstep(0.9, 1.0, lum) * 0.65);
      a = mask;
    } else {
      // Ambient field: sparse faint tiles over empty cells so the
      // hero keeps its full-bleed texture. Mostly small squares, the
      // occasional diagonal.
      float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      float fieldIdx = h > 0.8 ? 2.0 : 1.0;
      float mask = tileMask(fieldIdx, cellUv);
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

export function HeroGlyphRing({
  color = "#e87040",
  spinDuration = 26,
}: Props) {
  return (
    <div className="hero-glyph-ring" aria-hidden>
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
  // Pipeline objects: ring material, render target, post scene. All
  // imperative, memoised once, disposed on unmount.
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

    // One texel per tile cell; nearest both ways (it's a data buffer).
    const rt = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });

    // Palette: the orange family already on the page. uBase is the
    // brand accent (prop). LIGHT-PAGE direction: key-lit faces ADVANCE
    // (deep saturated orange), shadow faces recede, but only to a mid
    // peach: every band has to stay unmistakably orange or the ring
    // loses its mass. THREE.Color converts sRGB hex -> linear under
    // ColorManagement; colorspace_fragment converts back on output.
    const postMaterial = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        uScene: { value: rt.texture },
        uGrid: { value: new THREE.Vector2(4, 4) },
        uTileCount: { value: TILE_COUNT },
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

    return { ringMaterial, rt, postMaterial, postScene, postQuad, postCam };
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
    // PASS 2: geometric-tile dither -> canvas.
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
