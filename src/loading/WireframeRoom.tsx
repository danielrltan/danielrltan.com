// src/loading/WireframeRoom.tsx
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useWireframeManifest } from "./useWireframeManifest";
import {
  type AssemblyState,
  CLIMAX_DURATION_MS,
  PHASE_THRESHOLDS,
} from "./types";

/** Shared geometry — one unit cube, scaled per mesh via the line's scale. */
const UNIT_BOX = new THREE.BoxGeometry(2, 2, 2);
const UNIT_EDGES = new THREE.EdgesGeometry(UNIT_BOX);

const WIREFRAME_COLOR = new THREE.Color("#ff7842");

/**
 * Deterministic 0..1 hash from a string. Used to randomize per-mesh
 * appearance delay within a phase so the wave reads as organic rather
 * than rasterised.
 */
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
  phaseStart: number; // combinedPct at which this mesh starts appearing
  phaseEnd: number; // combinedPct at which it's fully resolved
}

interface Props {
  state: AssemblyState;
}

export function WireframeRoom({ state }: Props) {
  const manifest = useWireframeManifest();
  const groupRef = useRef<THREE.Group>(null);

  // Build line entries once when the manifest arrives.
  const entries = useMemo<LineEntry[]>(() => {
    if (!manifest) return [];
    const out: LineEntry[] = [];
    for (const m of manifest.meshes) {
      const material = new THREE.LineBasicMaterial({
        color: WIREFRAME_COLOR,
        transparent: true,
        opacity: 0,
        // depthTest off so wireframes always draw on top of the
        // loaded room regardless of geometry — they're a UI overlay
        // anchored in world space, not geometry that needs to occlude
        // or be occluded.
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new THREE.LineSegments(UNIT_EDGES, material);
      mesh.renderOrder = 999;
      mesh.position.set(m.center[0], m.center[1], m.center[2]);
      // EdgesGeometry was built on a (2,2,2) cube; scaling by half gives
      // the desired AABB extents directly. scale 0 at start.
      mesh.scale.set(0, 0, 0);
      mesh.userData.targetScale = [m.half[0], m.half[1], m.half[2]];

      // Distribute appearance time uniformly across the phase's window.
      const phaseIdx = m.phase - 1;
      const lo = PHASE_THRESHOLDS[phaseIdx]!;
      const hi = PHASE_THRESHOLDS[phaseIdx + 1] ?? 1;
      const jitter = hashName(m.name);
      const start = lo + (hi - lo) * jitter * 0.85;
      const end = start + 0.08; // 8% of overall combinedPct to fully resolve

      out.push({ mesh, material, phaseStart: start, phaseEnd: end });
    }
    return out;
  }, [manifest]);

  // Mount/unmount the lines into the group.
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

  // Per-frame animation driver — reads from `state` via ref to avoid
  // re-running this effect on every state update.
  const stateRef = useRef(state);
  stateRef.current = state;
  const climaxStartedAtRef = useRef<number | null>(null);

  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const coverMatRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame(() => {
    const s = stateRef.current;
    if (entries.length === 0 && !coverMatRef.current) return;

    // Track when the climax began so we can drive a local fade timer.
    if (s.climaxReady && climaxStartedAtRef.current == null) {
      climaxStartedAtRef.current = performance.now();
    }
    const climaxT =
      climaxStartedAtRef.current != null
        ? Math.min(
            1,
            (performance.now() - climaxStartedAtRef.current) /
              CLIMAX_DURATION_MS,
          )
        : 0;
    const climaxOut = 1 - easeInCubic(climaxT); // 1 → 0

    // Cover plane: opaque maroon until climax, fades to transparent
    // alongside the wireframes. Hides the (already-loaded) real room
    // behind the assembly so the visual story is "wireframes are doing
    // the work" instead of "wireframes overlay an already-finished room."
    if (coverMatRef.current) {
      coverMatRef.current.opacity = climaxOut;
    }

    for (const e of entries) {
      const { mesh, material } = e;
      // Pre-climax: pop-in driven by combinedPct.
      // Reduced motion: single linear wave starting at 30% — no per-mesh
      // stagger, no ease-out-back overshoot.
      let local = 0; // 0 = invisible, 1 = fully present
      if (reducedMotion) {
        if (s.combinedPct >= 0.3) {
          local = Math.min(1, (s.combinedPct - 0.3) / 0.3);
        }
      } else if (s.combinedPct >= e.phaseEnd) local = 1;
      else if (s.combinedPct > e.phaseStart) {
        const t = (s.combinedPct - e.phaseStart) / (e.phaseEnd - e.phaseStart);
        local = easeOutBack(t);
      }

      // Climax: uniformly fade and shrink toward center.
      const visible = local * climaxOut;
      material.opacity = visible;
      const [sx, sy, sz] = mesh.userData.targetScale as [number, number, number];
      mesh.scale.set(sx * visible, sy * visible, sz * visible);
      mesh.visible = visible > 0.001;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Cover dome — a back-side sphere that engulfs the camera. While
          its opacity is 1, the inside surface paints the camera's whole
          field of view cream, hiding the loaded room AND the Aurora
          behind it. Wireframes render after (higher renderOrder +
          depthTest off) so they sit on top of the cover. Both the
          cover and the wireframes fade in lockstep during the climax,
          at which point the Aurora becomes visible. */}
      <mesh renderOrder={500} frustumCulled={false}>
        <sphereGeometry args={[60, 16, 12]} />
        <meshBasicMaterial
          ref={coverMatRef}
          color="#f0e6d6"
          side={THREE.BackSide}
          transparent
          opacity={1}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    </group>
  );
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeInCubic(t: number): number {
  return t * t * t;
}
