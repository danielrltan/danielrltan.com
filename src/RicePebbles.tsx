import { useMemo } from "react";
import * as THREE from "three";

/**
 * Scattered "rice" pebbles on the ground plane around the room
 * footprint. Small low-poly rounded boxes positioned just outside
 * the room walls — gives the scene some weight and breaks up the
 * empty plane around the room. Like cassettes scattered around a
 * tape recorder in TE product photography.
 *
 * The set is deterministic (seeded RNG) so the layout is identical
 * across reloads.
 */

const ROOM_HALF = 2.4;   // Room footprint roughly ±2.4 in X/Z.
const RING_INNER = 2.9;  // Pebbles start just outside the room walls.
const RING_OUTER = 5.6;  // Outer extent of the scatter ring.
const COUNT = 28;

/** Mulberry32 — tiny seeded RNG. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pebble {
  x: number;
  z: number;
  rotY: number;
  scale: [number, number, number];
  /** Lighter orange or walnut-ish to vary visually. */
  color: string;
}

const PALETTE = ["#e87040", "#1a1714", "#d9dbdf", "#7a4a30"];

function generatePebbles(): Pebble[] {
  const r = rng(0xb1ade7);
  const out: Pebble[] = [];
  let attempts = 0;
  while (out.length < COUNT && attempts < COUNT * 8) {
    attempts++;
    // Polar sample in the annulus around the room.
    const angle = r() * Math.PI * 2;
    const radius = RING_INNER + r() * (RING_OUTER - RING_INNER);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    // Reject if inside the square room footprint (the ring sometimes
    // overlaps corners of the room since radius ≥ RING_INNER < sqrt2 * ROOM_HALF).
    if (Math.abs(x) < ROOM_HALF && Math.abs(z) < ROOM_HALF) continue;
    out.push({
      x,
      z,
      rotY: r() * Math.PI * 2,
      scale: [
        0.10 + r() * 0.10,
        0.04 + r() * 0.04,
        0.08 + r() * 0.10,
      ],
      color: PALETTE[Math.floor(r() * PALETTE.length)]!,
    });
  }
  return out;
}

export function RicePebbles() {
  const pebbles = useMemo(() => generatePebbles(), []);
  return (
    <group>
      {pebbles.map((p, i) => (
        <mesh
          key={i}
          position={[p.x, p.scale[1], p.z]}
          rotation={[0, p.rotY, 0]}
          scale={p.scale}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial
            color={p.color}
            roughness={0.6}
            metalness={0.05}
          />
        </mesh>
      ))}
    </group>
  );
}
