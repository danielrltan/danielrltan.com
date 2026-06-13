import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useWireframeManifest } from "./useWireframeManifest";
import { PHASE_THRESHOLDS } from "./types";

/**
 * Scroll-driven wireframe overlay. As the user scrolls through About,
 * the wireframe AABBs for every mesh in the room manifest assemble +
 * disassemble one phase at a time, a "spec sheet annotation" layer
 * over the rendered room. A cream cover dome (pinned to the camera,
 * BackSide) hides the real room during the wireframe-only beat so
 * the assembly reads as the thing doing the work; both layers swap
 * out together at pin 0.50.
 */

const UNIT_BOX = new THREE.BoxGeometry(2, 2, 2);
const UNIT_EDGES = new THREE.EdgesGeometry(UNIT_BOX);

const WIREFRAME_COLOR = new THREE.Color("#e87040");

/* PIXEL-ART RESOLUTION STEPS for the wireframe beat. While the cover
   dome hides the room (p < ~0.5) the whole canvas renders at a
   FRACTION of its base pixel ratio and the browser upscales it
   nearest-neighbour (image-rendering: pixelated): the wireframe's
   lines become genuinely chunky, stair-stepped pixels — real low-res
   rendering, not an overlay. The fraction steps UP as the assembly
   completes (a resolution boot sequence), reaching full res at 0.46,
   safely before the dome starts revealing the room at 0.50. Each
   entry: [progress upper bound, fraction of base DPR]. Quantised so
   the buffer realloc (setDpr → setSize) happens a handful of times
   per scroll-through, never per frame. Floor 0.14: below that the
   1px wireframe lines fall between samples and drop out. */
const RES_STEPS: Array<[number, number]> = [
  [0.16, 0.14],
  [0.28, 0.17],
  [0.38, 0.21],
  [0.44, 0.28],
  [0.49, 0.38],
  [0.54, 0.54],
  [0.58, 0.74],
];
function resolutionFraction(p: number): number {
  for (const [limit, frac] of RES_STEPS) {
    if (p < limit) return frac;
  }
  return 1;
}

function hashName(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

interface LineEntry {
  mesh: THREE.LineSegments;
  material: THREE.LineBasicMaterial;
  phaseStart: number;
  phaseEnd: number;
}

interface Props {
  /** 0..1: scroll progress through the About section. Provided
   *  via ref so per-frame reads don't trigger re-renders. */
  progressRef: React.MutableRefObject<number>;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function ScrollWireframeRoom({ progressRef }: Props) {
  const manifest = useWireframeManifest();
  const groupRef = useRef<THREE.Group>(null);
  const coverRef = useRef<THREE.Mesh>(null);
  const coverMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const { camera } = useThree();
  const gl = useThree((s) => s.gl);
  const setDpr = useThree((s) => s.setDpr);
  // Base pixel ratio captured on first change (R3F has applied the
  // configured dpr by the first frame); 0 = not captured yet.
  const baseDprRef = useRef(0);
  // Currently-applied resolution fraction; 1 = full res.
  const fracRef = useRef(1);
  // Phones: the canvas is faded out for the whole wireframe window
  // (App.tsx mobile choreography), so stepping the buffer there is
  // pure churn. Read once; the 768 breakpoint matches useIsMobile.
  const isMobileRef = useRef(
    typeof window !== "undefined" &&
      window.matchMedia("(max-width: 768px)").matches,
  );

  // Restore full resolution if this component ever unmounts mid-beat.
  useEffect(() => {
    return () => {
      if (fracRef.current !== 1 && baseDprRef.current > 0) {
        setDpr(baseDprRef.current);
        gl.domElement.style.imageRendering = "";
      }
    };
  }, [gl, setDpr]);
  // Previous-frame env value for the per-mesh early-out.
  // When env transitions INTO 0 we do one final pass to zero all meshes,
  // then skip the O(n) loop every subsequent frame until env changes.
  // OLD: O(n) per-mesh loop every frame regardless of wireframe visibility.
  // NEW: O(1) per frame when env===0 and was already 0 last frame.
  const prevEnvRef = useRef<number>(-1);

  const entries = useMemo<LineEntry[]>(() => {
    if (!manifest) return [];
    const out: LineEntry[] = [];
    for (const m of manifest.meshes) {
      const material = new THREE.LineBasicMaterial({
        color: WIREFRAME_COLOR,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new THREE.LineSegments(UNIT_EDGES, material);
      // Disable frustum culling: three culls using the unit-cube geometry's
      // bounding sphere (radius √3) scaled by max(scale.xyz). With initial
      // scale (0,0,0) and easeOutBack producing tiny intermediate scales,
      // edge-of-room meshes (curtains at z≈-2, walls at ±2.25) get false-
      // culled before they can ramp up. 75 line objects is a trivial budget.
      mesh.frustumCulled = false;
      mesh.renderOrder = 999;
      mesh.position.set(m.center[0], m.center[1], m.center[2]);
      mesh.scale.set(0, 0, 0);
      mesh.userData.targetScale = [m.half[0], m.half[1], m.half[2]];

      const phaseIdx = m.phase - 1;
      const lo = PHASE_THRESHOLDS[phaseIdx]!;
      const hi = PHASE_THRESHOLDS[phaseIdx + 1] ?? 1;
      const jitter = hashName(m.name);
      const start = lo + (hi - lo) * jitter * 0.85;
      // Wider per-mesh pop window (was 0.08) so each wireframe eases up more
      // gradually — part of slowing the whole assembly to build anticipation.
      const end = start + 0.095;

      out.push({ mesh, material, phaseStart: start, phaseEnd: end });
    }
    return out;
  }, [manifest]);

  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    for (const e of entries) g.add(e.mesh);
    return () => {
      for (const e of entries) {
        g.remove(e.mesh);
        e.material.dispose();
      }
    };
  }, [entries]);

  // Per-frame: read progress from ref, drive each mesh's scale +
  // opacity. The progress signal is a 0..1..0 PULSE shape across the
  // About pin so wireframes assemble (0→1) during the entry beat
  // and fade back out as the user approaches the Mac handoff.
  useFrame(() => {
    // Cover-dome must always track the camera, even when wireframes are gone.
    if (coverRef.current) {
      coverRef.current.position.copy(camera.position);
    }
    if (entries.length === 0 && !coverMatRef.current) return;
    const p = progressRef.current;

    // Pixel-art resolution gate (see RES_STEPS). Only touches the
    // renderer when the quantised fraction (or the actual renderer
    // ratio) drifts from what we want.
    if (!isMobileRef.current) {
      const frac = resolutionFraction(p);
      if (frac < 1) {
        if (baseDprRef.current === 0) baseDprRef.current = gl.getPixelRatio();
        const want = baseDprRef.current * frac;
        // DESYNC GUARD (load-bearing): R3F's Canvas re-applies its `dpr`
        // PROP on every App re-render (fiber's configure() calls setDpr
        // whenever viewport.dpr differs from the prop), silently
        // resetting our stepped ratio to full res mid-beat — e.g. the
        // roomLoaded/sceneReady state cascade on a reload-at-offset, or
        // a hover flipping setMoveableHover. Comparing against the LIVE
        // renderer ratio (cheap property read) instead of only our own
        // last-set fraction re-asserts the step on the next frame after
        // any such clobber.
        if (Math.abs(gl.getPixelRatio() - want) > 0.001) {
          fracRef.current = frac;
          setDpr(want);
          // Nearest-neighbour upscale while sub-res: this is what turns
          // the low-res buffer into crisp chunky pixels instead of a
          // bilinear smear.
          gl.domElement.style.imageRendering = "pixelated";
        } else if (frac !== fracRef.current) {
          fracRef.current = frac;
        }
      } else if (fracRef.current !== 1) {
        // Leaving the beat: restore full res once, then DROP the base
        // capture so the next beat re-samples it — browser zoom may
        // change devicePixelRatio between beats, and a stale base would
        // otherwise fight R3F's legitimate full-res value.
        fracRef.current = 1;
        if (baseDprRef.current > 0) setDpr(baseDprRef.current);
        gl.domElement.style.imageRendering = "";
        baseDprRef.current = 0;
      }
    }
    // Wireframes assemble 0.00→0.40, hold 0.40→0.56, then crossfade
    // out 0.56→0.64 while the cover dome reveals the room behind it.
    // The whole sequence was slowed (was 0.30/0.48/0.56) to draw out the
    // wireframe build and let anticipation grow before the room appears
    // (user request). The room's own opacity (App.tsx roomOpacity) is
    // already 1 well before the dome lifts, so it's ready behind the dome.
    let env: number;
    if (p < 0.40) {
      env = p / 0.40;
    } else if (p < 0.56) {
      env = 1;
    } else if (p < 0.64) {
      env = 1 - (p - 0.56) / 0.08;
    } else {
      env = 0;
    }
    // Dome holds fully opaque until 0.54, then fades out over the
    // 0.54→0.66 window so the room is fully revealed by ≈0.66 (later than
    // the old 0.62, matching the slowed assembly above).
    let domeOpacity: number;
    if (p < 0.54) {
      domeOpacity = 1;
    } else if (p < 0.66) {
      // easeInOutCubic for a gentle in-and-out fade instead of linear.
      const t = (p - 0.54) / 0.12;
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      domeOpacity = 1 - eased;
    } else {
      domeOpacity = 0;
    }
    if (coverMatRef.current) {
      coverMatRef.current.opacity = domeOpacity;
    }

    const prevEnv = prevEnvRef.current;
    prevEnvRef.current = env;

    // Early-out: when env is 0 and was already 0 last frame, all meshes
    // are already invisible — skip the O(n) per-mesh loop entirely.
    // On the transition frame (prevEnv > 0 but env === 0) we fall through
    // once so the meshes are zeroed out, then subsequent frames are free.
    if (env === 0 && prevEnv === 0) return;

    for (const e of entries) {
      const { mesh, material } = e;
      let local = 0;
      if (p >= e.phaseEnd) local = 1;
      else if (p > e.phaseStart) {
        const t = (p - e.phaseStart) / (e.phaseEnd - e.phaseStart);
        local = easeOutBack(t);
      }
      const visible = local * env;
      material.opacity = visible;
      // Scale is driven by `local` (per-mesh assemble), NOT `visible`.
      // During the EXIT window `env` ramps 1→0 while `local` holds at 1
      // (p >= phaseEnd), so the wireframe FADES AWAY IN PLACE at full
      // scale instead of redundantly shrinking back out; it already
      // "maximized in" to load the room, so minimizing out again read
      // as a repeat. Entry still pops in (local carries the easeOutBack).
      const [sx, sy, sz] = mesh.userData.targetScale as [number, number, number];
      mesh.scale.set(sx * local, sy * local, sz * local);
      mesh.visible = visible > 0.001;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Cover dome: cool-white BackSide sphere pinned to the camera
          so the camera is always inside it. Color matches `--bg-page`
          so the dome reads as a continuation of the page wrapper, not
          a foreign warm cream. */}
      <mesh ref={coverRef} renderOrder={500} frustumCulled={false}>
        <sphereGeometry args={[20, 16, 12]} />
        <meshBasicMaterial
          ref={coverMatRef}
          color="#eef0f3"
          side={THREE.BackSide}
          transparent
          opacity={1}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
