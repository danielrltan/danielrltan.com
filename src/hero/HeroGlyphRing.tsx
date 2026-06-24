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
 *       R,G = SMOOTH interpolated view-space normal.xy (flat dFdx/dFdy
 *             per-face normals were the visible low-poly facets the
 *             user rejected; smooth normals restore the glossy Phong
 *             read of the original AsciiEffect ring)
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
 *       - NORMAL -> PALETTE: the normal dotted with the key-light
 *         direction is quantized into discrete bands across the
 *         orange family - volumetric shading that follows the smooth
 *         curvature as contour bands.
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
// devices cap DPR at 1 (vs up to 2x desktop). Tessellation also drops
// (24x160 vs 40x260): the tile grid re-quantizes the surface into 10px
// cells, so the coarser smooth-shaded mesh is visually indistinguishable
// at phone sizes while cutting pass-1 vertex work.
const IS_SMALL_SCREEN =
  typeof window !== "undefined" &&
  window.matchMedia("(max-width: 768px), (pointer: coarse)").matches;

// Browser/OS zoom or HiDPI panel: pass 2's cost scales with canvas PIXELS, so a
// 1.25→1.0 DPR drop is ~36% fewer fullscreen-post fragments — a real win on the
// Windows 125/150%-scaled weak laptops the owner is complaining about. It's
// visually identical here because pass 2 hard-quantizes to ~10px tile cells, so
// supersampling past 1.0 buys nothing. Read ONCE at module load: reactively
// changing dpr would resize the Canvas backbuffer mid-session.
const IS_HI_DPR =
  typeof window !== "undefined" && (window.devicePixelRatio || 1) > 1.4;

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
  varying vec3 vNormal;

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
    // SMOOTH interpolated normal (view space). The displacement rides
    // along the normal, so the resting normal stays a good approximation
    // (same simplification the original Phong setup made).
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const RING_FRAG = /* glsl */ `
  uniform vec3 uKeyDir;
  uniform vec3 uFillDir;
  varying vec3 vViewPos;
  varying vec3 vNormal;

  void main() {
    // SMOOTH interpolated normal (was flat dFdx/dFdy per-face normals:
    // the visible low-poly facets the user rejected). The post pass
    // still quantizes normal-vs-light into discrete palette bands, so
    // the volumetric banding survives - it just follows the smooth
    // curvature now, and the specular reads as a glossy gliding
    // highlight like the original Phong setup.
    vec3 n = normalize(vNormal);

    float diff = max(dot(n, uKeyDir), 0.0);
    float fill = max(dot(n, uFillDir), 0.0);
    vec3 v = normalize(-vViewPos);
    vec3 h = normalize(uKeyDir + v);
    // BRUSHED METAL, SMOOTH (user: the previous version had a sharp
    // "sun point"). That was an atan(n.y,n.x) groove: atan is singular
    // where the normal faces the camera, so the streaks converged into
    // one harsh hot spot. Fixed two ways: (1) a GENTLE broad specular
    // (exp 2.5, low amplitude) so there is no sharp gloss peak, and the
    // even DIFFUSE carries most of the brightness; (2) the brushed
    // grooves come from the normal's vertical component - a smooth,
    // singularity-free coordinate - raking fine horizontal streaks
    // around the tube. The orange disperses evenly across the lit side
    // as a soft brushed sheen, no point.
    float ndoth = max(dot(n, h), 0.0);
    // HIGHER ROUGHNESS (user: the reflection was too dense/tight). A
    // WIDE low exponent (exp 3 vs 7) spreads the highlight into a broad,
    // soft sheen, and a fine ISOTROPIC micro-grain (surface-relative, no
    // directional stripes) scatters it so the metal reads brushed/matte
    // rather than a tight mirror gloss. The orange disperses as a gentle
    // grained sheen around the ring.
    float spec = pow(ndoth, 3.0);
    float grain = fract(sin(dot(floor(n.xy * 80.0), vec2(12.9898, 78.233))) * 43758.5453);
    float rough = 0.82 + 0.18 * grain;
    float lum = clamp(0.07 + diff * 0.26 + fill * 0.12 + spec * 0.85 * rough, 0.0, 1.0);

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
  uniform float uTime;
  uniform vec3 uBase;
  uniform vec3 uFieldBase;   // orange field background (inverted look)
  uniform vec3 uFieldBlob;   // lighter-orange haze pooling in the field
  uniform vec3 uRingShadow;
  uniform vec3 uRingLit;
  uniform vec3 uLitOrange;
  uniform vec3 uHotOrange;
  uniform vec3 uPaletteDir;
  #define TRAIL_N 24
  uniform vec3 uTrail[TRAIL_N]; // recent cursor positions: xy = vUv, z = age 0..1
  uniform float uAspect;        // canvas w/h, keeps the paint blob round
  uniform float uTrailActive;   // 0 when no live trail -> skip the loop entirely
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

  // Smooth value noise (for the calm field density below).
  float vhash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = vhash(i);
    float b = vhash(i + vec2(1.0, 0.0));
    float c = vhash(i + vec2(0.0, 1.0));
    float d = vhash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
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

    // CURSOR PAINT (crisp + ORGANIC, per-CELL): the recent points are summed as
    // soft metaball kernels so they FUSE into one flowing shape (not separate
    // circles), and the iso-threshold is warped by drifting noise so the
    // boundary is an irregular blob — never a clean circle. A HARD per-cell
    // threshold keeps the pixel edges sharp (no fuzzy glow); the tail shrinks +
    // vanishes as the points age out.
    // PERF: skip ALL trail work when the cursor isn't actively trailing
    // (uTrailActive 0). Otherwise this 24-iteration metaball loop + noise runs
    // on every fragment of the big fullscreen quad EVERY frame — including idle
    // scroll frames, which is pure waste.
    float paint = 0.0;
    if (uTrailActive > 0.5) {
      vec2 cellCenter = (cell + 0.5) / uGrid;
      float field = 0.0;
      for (int i = 0; i < TRAIL_N; i++) {
        float age = uTrail[i].z;
        if (age <= 0.001) continue;
        vec2 dv = (cellCenter - uTrail[i].xy) * vec2(uAspect, 1.0);
        // Smaller kernel -> ~60% smaller blob.
        field += age * 0.00032 / (dot(dv, dv) + 0.00032);
      }
      float warp = vnoise(cellCenter * 32.0 + uTime * vec2(0.30, -0.22)) - 0.5;
      // Short per-cell smoothstep band: eases the edge so it's not razor-hard,
      // but stays tight — no return to a fuzzy glow.
      paint = smoothstep(0.42, 0.78, field + warp * 0.42);
    }

    // INVERTED figure-ground (user direction): the FIELD is the bold
    // orange element; the RING reads as white carved through it.
    vec3 col;
    float a;
    if (s.a > 0.5) {
      float lum = s.b;
      // PER-FACE NORMAL -> palette factor, shared by both ring modes.
      vec2 nxy = s.rg * 2.0 - 1.0;
      float nz = sqrt(max(0.0, 1.0 - dot(nxy, nxy)));
      float t = clamp(dot(vec3(nxy, nz), uPaletteDir) * 0.5 + 0.5, 0.0, 1.0);
      float tq = floor(t * 4.0 + 0.5) / 4.0;

      // ORANGE REFLECTIONS (user direction): cells in the lit/specular
      // zone flip to the accent family with the normal-banded shading,
      // dithered at the boundary so the reflection halftones into the
      // white body instead of cutting a hard seam.
      // Soft wide threshold so the sheen fades gently into orange around
      // the ring (no hard patch edge), body stays light metal.
      // Higher threshold => only the brightest specular facets flip to orange,
      // so the ring stays mostly WHITE (user: "a lot more of the whites").
      float refl = smoothstep(0.78, 0.97, lum);
      if (refl > dith) {
        float idx = clamp(
          floor(lum * uTileCount + (dith - 0.5)),
          0.0,
          uTileCount - 1.0
        );
        float mask = tileMask(idx, cellUv);
        col = mix(uBase, uLitOrange, tq);
        col = mix(col, uHotOrange, smoothstep(0.92, 1.0, lum) * 0.7);
        a = mask;
      } else {
        // WHITE BODY: inverted density (darker facets fill with
        // near-white tiles, brighter ones blank toward the page).
        float density = 1.0 - lum;
        float idx = clamp(
          floor(density * uTileCount + (dith - 0.5)),
          0.0,
          uTileCount - 1.0
        );
        float mask = tileMask(idx, cellUv);
        // Ring symbols fully opaque (was 0.92) so the ring reads BRIGHTER than
        // the now-darkened field — the figure-ground separation the user wants.
        col = mix(uRingShadow, uRingLit, tq);
        col = mix(col, vec3(1.0), paint * 0.4); // trail glows across the ring too
        a = mask;
      }
    } else {
      // INVERTED figure-ground: orange field BASE, lighter-orange symbol
      // glyphs typed over it. The field uses the SAME geometric symbol
      // VOCABULARY as the ring (small square -> diagonal -> cross-hatch
      // X -> outline box -> box+slash -> inset square -> full square),
      // NOT a flat dot field (user: use those symbols - the slash, x,
      // boxes - not dots). The symbol is chosen by the slow drifting
      // blob density (a COHERENT gradient of shapes, not the random
      // per-cell salad that earlier read as messy), so denser blob cores
      // fill with the heavier boxes while the margins stay sparse
      // squares - the symbols themselves map the haze. Solid field
      // (a = 1) so the hero reads as an orange surface.
      float n =
        vnoise(cell * 0.008 + uTime * vec2(0.018, 0.010)) * 0.6 +
        vnoise(cell * 0.017 + uTime * vec2(-0.011, 0.015)) * 0.4;
      // Density -> symbol index across the ramp, Bayer-jittered only
      // between adjacent steps so the shape transitions are a soft
      // salt-and-pepper of neighbours, never a hard contour. Floor of
      // ~1 so every cell prints at least the small square (the field is
      // visibly symbol-textured everywhere, never a solid fill).
      // Floor at the DIAGONAL (idx 2) so the field is the distinctive
      // symbols - slash, cross-hatch X, outline box, etc. - everywhere,
      // never the small-square "dots" (user). A higher-frequency second
      // term breaks the blobs into a richer per-area MIX of symbols (so
      // a glance catches several, like the ring's curvature does) while
      // staying a smooth function of position (not a random salad).
      float sym = n * 0.7 + vnoise(cell * 0.06 + uTime * vec2(0.02, -0.013)) * 0.3;
      float lit = smoothstep(0.10, 0.90, sym);
      // Paint thickens the glyphs along the swept path (denser symbols).
      float fIdx = 2.0 + lit * (uTileCount - 3.0) + paint * 4.0;
      float idx = clamp(floor(fIdx + (dith - 0.5)), 2.0, uTileCount - 1.0);
      float mask = tileMask(idx, cellUv);
      col = mix(uFieldBase, uFieldBlob, mask);
      // Paint snaps the swept tiles' GLYPHS to white (crisp symbols); the gap
      // barely lifts — clear brightening, not a white haze.
      vec3 litCol = mix(mix(col, vec3(1.0), 0.10), vec3(1.0), mask);
      col = mix(col, litCol, paint);
      a = 1.0;
    }

    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
    // BAKED GRADE: was the CSS filter saturate(1.28) contrast(1.2) on
    // .hero-glyph-ring (hero-composition.css) — a per-painted-frame compositor
    // color-matrix over the oversized live canvas for EVERY visitor. Folded in
    // here at zero added cost. Applied in sRGB-encoded space (AFTER
    // colorspace_fragment) and BEFORE the premultiply, matching the CSS filter
    // exactly (CSS grades straight, un-premultiplied colour). saturate == the
    // luminance-preserving CSS/SVG matrix, which equals mix(luma, c, s) with the
    // (0.213,0.715,0.072) weights; contrast == (c-0.5)*k+0.5. Order matches CSS.
    {
      vec3 graded = gl_FragColor.rgb;
      graded = mix(vec3(dot(graded, vec3(0.213, 0.715, 0.072))), graded, 1.28);
      graded = (graded - 0.5) * 1.2 + 0.5;
      gl_FragColor.rgb = clamp(graded, 0.0, 1.0);
    }
    // Premultiply for NoBlending onto the alpha canvas (the page bg
    // composites behind; entrance opacity is CSS on the canvas).
    gl_FragColor.rgb *= gl_FragColor.a;
  }
`;

// Cursor paint trail: ring-buffer size (KEEP IN SYNC with `#define TRAIL_N` in
// POST_FRAG above) + seconds for a painted point to fully fade. Sized to hold a
// subdivided fast-flick as one continuous trail.
const TRAIL_N = 24;
const TRAIL_LIFE = 0.6;

export function HeroGlyphRing({
  color = "#ff4f00",
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
        // DPR capped at 1.25 (was 2): pass 2 re-quantizes to a ~10px tile grid,
        // so supersampling past 1.25 buys almost nothing visually but costs more
        // fragments — a real tax on weak integrated GPUs. Small screens AND
        // HiDPI/zoomed displays drop to a flat 1.0 (identical look, ~36% fewer
        // post-pass fragments).
        dpr={IS_SMALL_SCREEN || IS_HI_DPR ? 1 : [1, 1.25]}
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
  // Throttle the two-pass render to ~30fps (see useFrame). The ring is a slow
  // 26s spin, so 30 vs 60 is imperceptible and ~halves the GPU cost of the
  // RT + fullscreen-post pipeline on weak integrated GPUs.
  const lastRenderRef = useRef(0);
  // Entrance: timestamp (s) the ring's reveal began, or null until the hero
  // first reveals (loading scrim lifts). Drives the crossfade-in + the
  // face-on -> tilt-back rotation. Runs once.
  const entranceStartRef = useRef<number | null>(null);
  const gateMetAtRef = useRef<number | null>(null);
  const ENTRANCE_DELAY = 0; // ring appears the instant the hero reveals (no hold)
  const wasOffscreenRef = useRef(true);
  // Resting orientation (the scene's tilt). The entrance rotates the tilt
  // group from 0 (face-on) to these over the reveal.
  const TILT_X = (38 * Math.PI) / 180;
  const TILT_Z = (-12 * Math.PI) / 180;
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Spin scale: hold still under reduced-motion; gentle on touch (continuous
  // motion on a phone is wasted battery + the ring needn't keep spinning there);
  // full on desktop.
  const spinScale = reducedMotion
    ? 0
    : typeof window !== "undefined" &&
        window.matchMedia("(hover: none), (pointer: coarse)").matches
      ? 0.45
      : 1;
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
  // Timestamp (ms) of the last scroll — used to PAUSE the 2-pass render during
  // active NON-DIVE scroll (during the dive the ring must keep rendering so the
  // tile-grid coarsening animates).
  const lastScrollRef = useRef(0);
  // Base tile grid (cols, rows) derived from the canvas size. The hero->about
  // dive coarsens DOWN from this so the ASCII pixels enlarge + the field's
  // resolution degrades as you zoom through the type (the user-loved look).
  const baseGridRef = useRef<THREE.Vector2 | null>(null);
  useEffect(() => {
    // Cull only AFTER the dive has fully faded (--hero-opacity ends ~1.12vh): the
    // ring now coarsens its pixels right through the dive, so culling at 0.85vh
    // (the old value) would pop the chunky field out before the fade finished.
    // Past 1.15vh the composition is fully transparent, so there's nothing to
    // show — reclaim the GPU there.
    const OFFSCREEN_VH = 1.15;
    let raf = 0;
    const apply = () => {
      const ratio = window.scrollY / Math.max(1, window.innerHeight);
      offscreenRef.current = ratio >= OFFSCREEN_VH;
    };
    const onScroll = () => {
      lastScrollRef.current = performance.now();
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
  // Cursor paint trail: a decaying ring buffer of recent cursor positions
  // (x, y in vUv space, age 0..1), fed to the post pass to brighten swept tiles.
  const trailRef = useRef(new Float32Array(TRAIL_N * 3));
  const trailHeadRef = useRef(0);
  const trailLastRef = useRef({ x: -2, y: -2 });
  // Lightly-smoothed head position (NDC) so the trail feels fluid, not snapped
  // hard onto the cursor — but a snappy lerp so it barely lags.
  const trailHeadSmRef = useRef(new THREE.Vector2(2, 2));

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

    // INVERTED palette (user direction): the field is bold accent
    // orange; the ring is the white family, warming to pale peach on
    // its shadow facets. THREE.Color converts sRGB hex -> linear under
    // ColorManagement; colorspace_fragment converts back on output.
    const postMaterial = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        uScene: { value: rt.texture },
        uGrid: { value: new THREE.Vector2(4, 4) },
        uTileCount: { value: TILE_COUNT },
        uTime: { value: 0 },
        uBase: { value: new THREE.Color(color) },
        // Inverted field: the brand accent orange as the BASE (same
        // #ff4f00 used everywhere, per user), with a VERY light orange
        // blob haze dithered over it.
        uFieldBase: { value: new THREE.Color("#ff4f00") },
        uFieldBlob: { value: new THREE.Color("#ff7a3c") },
        // Ring tints stay a hair off pure white: the ring body reads
        // WHITE; the volumetric shading comes from tile DENSITY, the
        // tint only whispers warmth on shadow faces.
        uRingShadow: { value: new THREE.Color("#fbeadd") },
        uRingLit: { value: new THREE.Color("#ffffff") },
        // Orange reflection bands on the lit/specular facets (the v1
        // treatment, layered back onto the white body per user call).
        uLitOrange: { value: new THREE.Color("#c23d00") },
        uHotOrange: { value: new THREE.Color("#ff6a2a") },
        uPaletteDir: { value: keyDir.clone() },
        // Cursor paint trail (mutated in place each frame; uploaded every render).
        uTrail: { value: trailRef.current },
        uAspect: { value: 1 },
        uTrailActive: { value: 0 },
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
    baseGridRef.current = new THREE.Vector2(gw, gh);
    // Aspect keeps the round cursor-paint blob round (vUv x is squashed wide).
    pipeline.postMaterial.uniforms.uAspect!.value =
      size.width / Math.max(1, size.height);
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
    // Touch / coarse pointer: there's no hovering cursor, so the cursor-driven
    // ring deformation + paint trail don't apply — skip ALL pointer tracking on
    // mobile so the ring simply spins (uMouseStrength stays 0 → no bulge, and the
    // trail's metaball loop never activates). Removes the stray "cursor blobbing".
    if (IS_SMALL_SCREEN) return;

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

    // Eased dive progress (0..1), read from the --hero-to-about inline CSS var
    // App.tsx writes each frame. Inline-style read = cheap (no computed style /
    // layout). Drives the pixel-enlarge below AND gates the scroll-pause.
    const diveRaw = document.documentElement.style.getPropertyValue(
      "--hero-to-about",
    );
    const dive = diveRaw ? Math.max(0, Math.min(1, parseFloat(diveRaw) || 0)) : 0;

    // PERF: pause the 2-pass render during ACTIVE scroll — but ONLY when NOT
    // diving. During the hero->about dive the ring MUST keep rendering: its tile
    // grid coarsens as the dive deepens so the ASCII pixels enlarge and the
    // field's resolution degrades (the effect the user loves), which only
    // animates if the post pass runs every frame. Outside the dive the slow 26s
    // spin is imperceptible, so the scroll-event pause still frees the GPU.
    // (The earlier data-hero-diving HARD freeze that lived here FROZE the ring
    // mid-dive — user: "freezing everything" — and is gone. The dive's cost is
    // the cheap 2-pass shader, not the long-removed main-thread SVG mosaic, so
    // rendering through it is fine.)
    if (
      dive <= 0.001 &&
      entranceStartRef.current !== null &&
      performance.now() - lastScrollRef.current < 140
    ) {
      lastTRef.current = performance.now() / 1000;
      return;
    }

    const now = performance.now() / 1000;
    // ~24fps cap (was 30): the ring is a slow 26s spin, imperceptible at 24, and
    // every skipped frame saves the whole RT + fullscreen-post pipeline.
    if (now - lastRenderRef.current < 1 / 24) return;
    lastRenderRef.current = now;
    const dt = Math.min(0.05, now - lastTRef.current);
    lastTRef.current = now;

    // Mark the ring "revealed" once the LOADING SCREEN is gone AND the
    // composition is visible (ENTRANCE_DELAY is 0 — no hold). This only gates the
    // ring off until the hero shows; there's no entrance animation anymore.
    if (INTRO_FREEZE == null) {
      if (entranceStartRef.current === null) {
        // Render as soon as the composition is visible — even while
        // `loading-active` is still up — so the ring is fully present BEHIND the
        // held loader scrim and is there the instant the scrim fades to reveal
        // the hero (the new crossfade intro). Was also gated on loading-active
        // being gone, which made the ring pop in AFTER the reveal.
        const gateMet = !!document.querySelector(".hero-composition.is-visible");
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

    // NO entrance animation: the ring sits at full opacity + its resting tilt the
    // instant the hero composition reveals (owner: drop the ring
    // "explosion"/crossfade-in entrance — just have the ring there immediately).
    // The composition's own is-visible fade is what carries it onto the screen.
    const ringOpacity = 1;
    const tiltT = 1;

    // Apply orientation + the crossfade opacity (CSS on the canvas).
    const tg = tiltGroupRef.current;
    if (tg) tg.rotation.set(tiltT * TILT_X, 0, tiltT * TILT_Z);
    gl.domElement.style.opacity = ringOpacity.toFixed(3);

    // Spin on the torus's local Y axis (scaled down on touch, stilled under
    // reduced-motion).
    const spinPerSec = ((Math.PI * 2) / spinDuration) * spinScale;
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
    // Drift the abstract orange haze in the post field (slow morph).
    pipeline.postMaterial.uniforms.uTime!.value = now;

    // PIXEL-ZOOM (user-loved): coarsen the tile grid as the dive deepens, so the
    // ASCII cells grow bigger and bigger and the field's resolution visibly
    // degrades as you zoom through it (then the wrapper fades). GPU-cheap — it's
    // only the post grid uniform: the render target keeps its resolution and
    // pass 2 just samples it more sparsely into chunkier cells. dive 0 = base
    // grid (no change); dive 1 = ~8x bigger cells. Replaces the old per-frame
    // main-thread SVG feMorphology mosaic (the real lag source), which stays
    // gone, so this is the cheap way back to the look.
    const bg = baseGridRef.current;
    if (bg) {
      const coarse = 1 - dive * 0.88; // 1 -> 0.12
      (pipeline.postMaterial.uniforms.uGrid!.value as THREE.Vector2).set(
        Math.max(3, Math.round(bg.x * coarse)),
        Math.max(3, Math.round(bg.y * coarse)),
      );
    }

    // CURSOR PAINT TRAIL: decay every point, then lay fresh points along the
    // cursor's movement this frame. The head reads from the RAW cursor (no
    // smoothing) so it sits AT the cursor — reactive, not lagged — and the trail
    // behind it comes from older points fading. Each frame's move is subdivided
    // so a fast flick lays a CONTINUOUS trail (points spaced within the metaball
    // fuse distance) instead of detached blobs. Skipped under reduced motion.
    // LITE / weak-HW path: drop the cursor paint trail entirely so the
    // 24-iteration metaball loop + value-noise in POST_FRAG never run
    // (uTrailActive 0). data-hero-lite is set at load on HiDPI and latched on
    // after sustained slow scroll frames (App.tsx adaptive degrade), so this is
    // exactly the machines that can least afford the trail's per-fragment spike.
    // Cheap attribute read (no layout); re-enables live if the flag ever clears.
    const lite = document.documentElement.hasAttribute("data-hero-lite");
    if (!reducedMotion && !lite) {
      const trail = trailRef.current;
      const decay = dt / TRAIL_LIFE;
      let active = false;
      for (let i = 0; i < TRAIL_N; i++) {
        let a = trail[i * 3 + 2]!;
        if (a > 0) {
          a = Math.max(0, a - decay);
          trail[i * 3 + 2] = a;
        }
        if (a > 0.001) active = true;
      }
      if (mouseStrengthSmoothedRef.current > 0.05) {
        const sm = trailHeadSmRef.current;
        const last = trailLastRef.current;
        if (last.x < -1) {
          // (re)entry: snap the smoothed head to the cursor so the trail doesn't
          // streak in from the offscreen sentinel.
          sm.set(mouseTargetRef.current.x, mouseTargetRef.current.y);
        } else {
          // Light, SNAPPY smoothing (settles in ~2-3 frames): fluid but barely
          // lagged — much less than the old cursor smoothing.
          const k = 1 - Math.exp(-dt * 26);
          sm.x += (mouseTargetRef.current.x - sm.x) * k;
          sm.y += (mouseTargetRef.current.y - sm.y) * k;
        }
        const tx = sm.x * 0.5 + 0.5;
        const ty = sm.y * 0.5 + 0.5;
        if (last.x < -1) {
          last.x = tx;
          last.y = ty;
        }
        const dx = tx - last.x;
        const dy = ty - last.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.0015) {
          // ~0.03 spacing fuses under the metaball kernel; cap so a teleport
          // (e.g. re-entry) doesn't streak edge-to-edge.
          const segs = Math.min(16, Math.max(1, Math.ceil(dist / 0.03)));
          for (let k = 1; k <= segs; k++) {
            const f = k / segs;
            const h = trailHeadRef.current;
            trail[h * 3] = last.x + dx * f;
            trail[h * 3 + 1] = last.y + dy * f;
            trail[h * 3 + 2] = 1;
            trailHeadRef.current = (h + 1) % TRAIL_N;
          }
          last.x = tx;
          last.y = ty;
          active = true;
        }
      } else {
        // Cursor gone: re-init on next entry so we don't streak in from afar.
        trailLastRef.current.x = -2;
      }
      // Gate the per-fragment trail loop off when there's nothing to draw.
      pipeline.postMaterial.uniforms.uTrailActive!.value = active ? 1 : 0;
    } else {
      // Reduced-motion or lite/weak-HW: never run the trail loop.
      pipeline.postMaterial.uniforms.uTrailActive!.value = 0;
    }

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
       SMOOTH TESSELLATION (AsciiEffect-era counts): the surface is
       smooth-shaded now, so the mesh must be dense enough that neither
       the silhouette nor the interpolated normals read as polygons -
       the earlier 22x120 "facets are the look" mesh is exactly the
       low-poly read the user rejected. The tile grid re-quantizes
       everything to 10px cells anyway, so the extra vertices cost only
       the pass-1 vertex stage. */
    <group ref={tiltGroupRef} rotation={[0, 0, 0]}>
      <mesh ref={torusRef} material={pipeline.ringMaterial}>
        <torusGeometry
          args={IS_SMALL_SCREEN ? [1.25, 0.3, 24, 160] : [1.25, 0.3, 40, 260]}
        />
      </mesh>
    </group>
  );
}
