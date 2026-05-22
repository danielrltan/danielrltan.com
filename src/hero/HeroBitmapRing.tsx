import { useEffect, useMemo, useRef } from "react";

/**
 * Bitmap-dithered ring for the hero composition. The ring is
 * rendered as a static canvas (one-time pixel paint), then a wrapper
 * div rotates it via a CSS keyframe — cheap, smooth, scales linearly
 * with viewport size.
 *
 * Aesthetic: scattered pixel dots in a circular band, like a
 * halftone screen exposed to noise. Inspired by editorial / risograph
 * print artifacts. The dot scatter is deterministic (seeded RNG) so
 * the ring renders the same on every load.
 */

interface Props {
  /** CSS size — applied to both width and height of the wrapper. */
  size: number;
  /** Seconds per full revolution. */
  spinDuration?: number;
  /** Counter-clockwise if true. */
  reverse?: boolean;
}

// Outer / inner radius as a fraction of canvas size (which is square).
const OUTER_R = 0.49;
const INNER_R = 0.31;
// How many dots to scatter. Higher = denser ring.
const DOT_COUNT = 3200;
// Pixel size distribution. Mostly small, occasional big.
const DOT_SIZES = [1, 1, 1, 1, 2, 2, 2, 3];

// Brand palette for the dots. Heavy on the orange + walnut tones,
// with occasional bright accent.
const DOT_COLORS = [
  "#e87040", // brand orange (frequent)
  "#e87040",
  "#e87040",
  "#3a2418", // walnut (frequent)
  "#3a2418",
  "#7a4f30", // mid-tone
  "#1a1714", // ink (rare, anchor weight)
  "#ffae6a", // light highlight (rare)
];

// Seeded RNG so the ring is identical on every render. Simple mulberry32.
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

function paintRing(canvas: HTMLCanvasElement, dpr: number) {
  // Canvas backing buffer at dpr scale. The CSS width/height match
  // the parent's logical size; we paint at higher density for crisp
  // pixels.
  const cssSize = canvas.width / dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const rng = makeRng(0xCAFE);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const outer = OUTER_R * canvas.width;
  const inner = INNER_R * canvas.width;
  // Band thickness for density falloff (denser near the centre of
  // the band, sparser at outer/inner edges).
  for (let i = 0; i < DOT_COUNT; i++) {
    // Angle uniformly distributed; radius weighted toward band
    // centre so the ring's "core" reads denser.
    const angle = rng() * Math.PI * 2;
    // Bias radius toward the middle of the band using two random
    // numbers (sum-of-uniforms gives a triangular distribution).
    const tBias = (rng() + rng()) / 2;
    const radius = inner + tBias * (outer - inner);
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    // Occasionally place a scatter dot OUTSIDE the band for the
    // halftone-bleed effect (mimics the reference's edge speckle).
    const scatter = rng() < 0.06;
    const finalRadius = scatter
      ? radius + (rng() - 0.5) * inner * 0.6
      : radius;
    const finalX = cx + Math.cos(angle) * finalRadius;
    const finalY = cy + Math.sin(angle) * finalRadius;
    if (finalX < 0 || finalY < 0 || finalX > canvas.width || finalY > canvas.height) continue;
    const size = DOT_SIZES[Math.floor(rng() * DOT_SIZES.length)]! * dpr;
    const color = DOT_COLORS[Math.floor(rng() * DOT_COLORS.length)]!;
    ctx.fillStyle = color;
    // Square pixels — matches the bitmap aesthetic better than round.
    ctx.fillRect(finalX - size / 2, finalY - size / 2, size, size);
  }
  // Reference size for any consumer that wants to know what was painted.
  void cssSize;
}

export function HeroBitmapRing({ size, spinDuration = 56, reverse }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Backing buffer at devicePixelRatio for crisp dots on Retina
  // displays. Re-painted whenever size or dpr changes.
  const dpr = useMemo(
    () =>
      typeof window === "undefined"
        ? 1
        : Math.min(window.devicePixelRatio || 1, 2.5),
    [],
  );

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = Math.round(size * dpr);
    c.height = Math.round(size * dpr);
    paintRing(c, dpr);
  }, [size, dpr]);

  return (
    <div
      className="hero-bitmap-ring"
      style={{
        width: size,
        height: size,
        animation: `${reverse ? "hero-ring-spin-rev" : "hero-ring-spin"} ${spinDuration}s linear infinite`,
      }}
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
    </div>
  );
}
