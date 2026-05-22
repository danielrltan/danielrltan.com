import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * 3D bitmap ring — a torus built out of small cube voxels.
 *
 * User wanted "3d, but in like bitmap / ascii style." The shape is
 * a real Three.js scene (rotates in true 3D, can be tilted, has
 * depth) but every surface is made of discrete chunky cubes
 * positioned on a torus — reads as a pixel-art bitmap ring with
 * actual perspective foreshortening as it spins.
 *
 * Replaces the prior 2D canvas grid which the user called out as
 * "just a SVG or something" — it was a flat scatter.
 */

interface Props {
  /** CSS size — applied to both width and height of the wrapper. */
  size: number;
  /** Seconds per full revolution around the ring's Y axis. */
  spinDuration?: number;
}

// Torus parameters in world units.
const TORUS_MAJOR_R = 1.0;   // radius from center to tube center
const TORUS_MINOR_R = 0.22;  // tube thickness
// Voxel grid resolution. More steps = denser, smaller cubes.
const MAJOR_SEGMENTS = 56;
const MINOR_SEGMENTS = 14;
// Voxel side length — slightly less than the spacing between
// neighbours so the cubes read as discrete bricks with thin gaps.
const VOXEL_SIZE = 0.058;
// Probability that a voxel slot is occupied. Below 1 introduces the
// dithered / pixel-art holes the user wanted.
const FILL_RATE = 0.86;

// Brand palette zones — assigned by polar angle around the major
// axis (0..2π) so the band reads as 4 mottled color sections
// rather than one flat tone.
const ZONE_PALETTES: string[][] = [
  ["#3a2418", "#3a2418", "#5a3a1f", "#1a1714"],         // walnut zone
  ["#e87040", "#e87040", "#ffae6a", "#3a2418"],         // brand-orange zone
  ["#1a1714", "#1a1714", "#3a2418", "#5a3a1f"],         // ink zone
  ["#5a3a1f", "#3a2418", "#e87040", "#1a1714"],         // mid zone
];

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Voxel {
  position: [number, number, number];
  color: THREE.Color;
}

function buildVoxels(): Voxel[] {
  const rngFill = makeRng(0xC0FFEE);
  const rngColor = makeRng(0xDECAF);
  const out: Voxel[] = [];
  for (let i = 0; i < MAJOR_SEGMENTS; i++) {
    const u = (i / MAJOR_SEGMENTS) * Math.PI * 2;
    const zoneIdx = Math.floor((i / MAJOR_SEGMENTS) * ZONE_PALETTES.length);
    const palette = ZONE_PALETTES[zoneIdx % ZONE_PALETTES.length]!;
    for (let j = 0; j < MINOR_SEGMENTS; j++) {
      const v = (j / MINOR_SEGMENTS) * Math.PI * 2;
      if (rngFill() > FILL_RATE) {
        rngColor(); // consume so colors stay deterministic
        continue;
      }
      // Torus parametric position.
      const x = (TORUS_MAJOR_R + TORUS_MINOR_R * Math.cos(v)) * Math.cos(u);
      const y = TORUS_MINOR_R * Math.sin(v);
      const z = (TORUS_MAJOR_R + TORUS_MINOR_R * Math.cos(v)) * Math.sin(u);
      const colorHex = palette[Math.floor(rngColor() * palette.length)]!;
      out.push({
        position: [x, y, z],
        color: new THREE.Color(colorHex),
      });
    }
  }
  return out;
}

function VoxelTorus({ spinDuration }: { spinDuration: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const voxels = useMemo(() => buildVoxels(), []);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const tempMat = useMemo(() => new THREE.Matrix4(), []);

  // One-time fill of instance positions + colors AFTER the mesh has
  // attached. useEffect runs post-commit so meshRef.current is real
  // here, unlike useMemo which runs during render.
  useEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i]!;
      tempMat.makeTranslation(v.position[0], v.position[1], v.position[2]);
      m.setMatrixAt(i, tempMat);
      m.setColorAt(i, v.color);
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) {
      m.instanceColor.needsUpdate = true;
    }
  }, [voxels, tempMat]);

  // Rotate the group around its Y axis. Tilt slightly forward so the
  // viewer sees the ring at a 3/4 angle — gives the depth a chance
  // to read.
  useFrame((_, dt) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += (Math.PI * 2 / spinDuration) * dt;
    }
  });

  return (
    <group ref={groupRef} rotation={[0.55, 0, 0]}>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, voxels.length]}
        castShadow={false}
        receiveShadow={false}
      >
        <boxGeometry args={[VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE]} />
        {/* MeshLambertMaterial — diffuse only, no specular. The
            voxels' color comes from the per-instance color buffer
            (set above); leaving the base color white avoids
            multiplying the instance tint with anything. */}
        <meshLambertMaterial color="#ffffff" />
      </instancedMesh>
    </group>
  );
}

/**
 * Once-per-mount initialization wrapper around the instanced mesh.
 * The useMemo block in VoxelTorus that fills the instance buffers
 * runs before meshRef.current is populated; the actual fill needs to
 * happen after React commits the InstancedMesh. We do that here
 * synchronously by attaching a callback ref that pokes the buffers
 * on first render.
 *
 * (Simpler approach than useEffect because the buffers are static —
 * we never need to update them once written.)
 */

export function HeroBitmapRing({ size, spinDuration = 24 }: Props) {
  return (
    <div
      className="hero-bitmap-ring"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Canvas
        camera={{ position: [0, 0, 3.4], fov: 32 }}
        dpr={[1, Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2)]}
        gl={{ antialias: false, alpha: true }}
      >
        {/* Light from one side so the cubes have a hint of shading
            even though the materials are matte — three.js's
            MeshLambertMaterial requires a light. */}
        <ambientLight intensity={0.55} color="#fff4e8" />
        <directionalLight position={[2, 3, 4]} intensity={1.0} color="#ffffff" />
        <directionalLight position={[-3, -1, 2]} intensity={0.4} color="#ffae6a" />
        <VoxelTorus spinDuration={spinDuration} />
      </Canvas>
    </div>
  );
}
