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
      const end = start + 0.08;

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
    // Wireframes assemble 0.00→0.30, hold 0.30→0.48, then crossfade
    // out 0.48→0.56 while the cover dome reveals the room behind it
    // with a longer fade (0.50→0.62). The previous 2%-pin cut from
    // 0.50→0.52 read as an instant swap; widening the dome fade to
    // ~12% of pin gives the room a gentle fade-in instead of a pop.
    let env: number;
    if (p < 0.30) {
      env = p / 0.30;
    } else if (p < 0.48) {
      env = 1;
    } else if (p < 0.56) {
      env = 1 - (p - 0.48) / 0.08;
    } else {
      env = 0;
    }
    // Dome holds fully opaque until 0.50, then fades out over the
    // 0.50→0.62 window. Room appearance is driven entirely by this
    // ramp, softer and more cinematic than the old hard cut.
    let domeOpacity: number;
    if (p < 0.50) {
      domeOpacity = 1;
    } else if (p < 0.62) {
      // easeInOutCubic for a gentle in-and-out fade instead of linear.
      const t = (p - 0.50) / 0.12;
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
