import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useWireframeManifest } from "./useWireframeManifest";
import { PHASE_THRESHOLDS } from "./types";

/**
 * Scroll-driven wireframe overlay. Resurrects the orange-print
 * loading-screen wireframe assembly from pre-curiosity-cabinet
 * versions of the site (git history, commit 671bdda's
 * WireframeRoom.tsx), repurposed to be driven by SCROLL POSITION
 * inside the About section rather than by loading state.
 *
 * As the user scrolls through About, the white-wireframe AABB boxes
 * for every mesh in the room manifest assemble (scale up + fade in)
 * one phase at a time. The result is an annotation layer that draws
 * itself over the real solid-rendered room — like a blueprint
 * snapping into place behind a finished photograph.
 *
 * The cover dome from the original WireframeRoom is gone — that
 * existed to hide the streaming-in real room during loading. Now the
 * real room is already loaded, so we just paint the wireframes on
 * top of it.
 */

const UNIT_BOX = new THREE.BoxGeometry(2, 2, 2);
const UNIT_EDGES = new THREE.EdgesGeometry(UNIT_BOX);

// Orange wireframes over the cream-lit room. The previous loading
// version used white wireframes on an orange dome — inverted here
// so the wireframes still read as the "spec sheet annotation" but
// against the room (which is warm cream / walnut), not the orange
// loading backdrop.
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
  /** 0..1 — scroll progress through the About section. Provided
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
    // Pin the cover dome to the camera so the camera is always
    // inside it (BackSide material → renders only the inner face).
    if (coverRef.current) {
      coverRef.current.position.copy(camera.position);
    }
    if (entries.length === 0 && !coverMatRef.current) return;
    const p = progressRef.current;
    // Envelope: wireframes assemble first, hold, then CROSSFADE
    // with the solid room (not a hard sequential cut — that left a
    // moment of empty viewport between the two layers). The solid
    // room's fade-in window in App.tsx (ROOM_FADE_IN_START/END_VH
    // = 1.42..1.615vh) matches the disassemble window here so the
    // two opacities cross at ~50/50 around pin 0.475.
    //   p 0.00..0.30 : 0 → 1 (assemble, room hidden)
    //   p 0.30..0.40 : 1 (hold — wireframe is the moment)
    //   p 0.40..0.55 : 1 → 0 (disassemble while room fades IN)
    //   p > 0.55     : 0 (solid room alone)
    let env: number;
    if (p < 0.30) {
      env = p / 0.30;
    } else if (p < 0.40) {
      env = 1;
    } else if (p < 0.55) {
      env = 1 - (p - 0.40) / 0.15;
    } else {
      env = 0;
    }
    // Cover dome opacity matches the wireframe envelope so the
    // dome HIDES the real room behind it during the wireframe-only
    // beat (pin 0.00 → 0.40 fully opaque), then fades in lockstep
    // with the wireframes (pin 0.40 → 0.55). After pin 0.55 the
    // dome is invisible and the solid room shows through. This
    // eliminates the previous "empty viewport" gap where wireframes
    // had faded but the solid room hadn't appeared yet.
    if (coverMatRef.current) {
      coverMatRef.current.opacity = env;
    }
    for (const e of entries) {
      const { mesh, material } = e;
      // Per-mesh local progress, gated by phase threshold. This is
      // the original assembly wave — chairs come in first, books
      // later — but driven by the scroll-derived `p` instead of
      // loading combinedPct.
      let local = 0;
      if (p >= e.phaseEnd) local = 1;
      else if (p > e.phaseStart) {
        const t = (p - e.phaseStart) / (e.phaseEnd - e.phaseStart);
        local = easeOutBack(t);
      }
      // Final visibility = assembly progress × envelope.
      const visible = local * env;
      // Bumped 0.75 → 1.0 — the 0.75 cap was making the orange
      // wireframes read as a barely-visible ghost over the cream
      // room. At full opacity the spec-sheet annotation feel reads
      // immediately, then yields back to the solid room as `env`
      // ramps down.
      material.opacity = visible;
      const [sx, sy, sz] = mesh.userData.targetScale as [number, number, number];
      mesh.scale.set(sx * visible, sy * visible, sz * visible);
      mesh.visible = visible > 0.001;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Cover dome pinned to the camera. While wireframes are
          active, this dome's cream-colored interior face hides the
          real room from the camera. Opacity tracks the wireframe
          envelope so the room is revealed via a smooth dome-fade
          rather than a popping group.visible toggle. */}
      <mesh ref={coverRef} renderOrder={500} frustumCulled={false}>
        <sphereGeometry args={[20, 16, 12]} />
        <meshBasicMaterial
          ref={coverMatRef}
          color="#f4f1ea"
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
