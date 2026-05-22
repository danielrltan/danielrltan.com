import { useEffect, useMemo, useRef } from "react";

/**
 * Bitmap ring — pixel-art arc.
 *
 * Per the reference image (Pinterest DesignFamilyMarket post): a
 * thick CURVED band made of chunky square pixels, color split into
 * 3-4 zones around the arc, ragged pixel-art edges with the
 * occasional fragment dropping off.
 *
 * Implementation:
 * - Grid sized to CELL_PX. Each cell either filled or empty.
 * - For each cell, compute (radius, angle) from canvas center.
 * - Inside the band → fill with probability 1.
 * - Edge cells (just past inner/outer radius) → fill with falloff
 *   probability so the band has organic torn edges.
 * - Color picked from a palette section based on the cell's angle —
 *   each quadrant gets a dominant tone (top: orange, right: walnut,
 *   bottom: ink, left: warm highlight). Within each section the
 *   exact color is chosen randomly with the deterministic seeded
 *   RNG, so the band has variegated mottling rather than 4 flat
 *   color blocks.
 */

interface Props {
  size: number;
  spinDuration?: number;
  reverse?: boolean;
}

// CSS pixels per grid cell. Bigger = chunkier blocks. 8px gives
// the visible "lego brick" feel from the reference.
const CELL_PX = 8;
const OUTER_R = 0.48;
const INNER_R = 0.30;
// Edge fuzziness — cells just outside the band are still filled at
// decreasing probability so the band silhouette is ragged.
const EDGE_FUZZ_OUT = 0.35;
const EDGE_FUZZ_IN = 0.30;
// Scatter dots that drop outside the ring entirely — like dust kicked
// off the band. Used sparingly.
const STRAY_RATE = 0.012;
const STRAY_REACH = 1.7;

// Palette zones around the arc. Each entry is a list of candidate
// colors for that angular region. Angles go 0 = right, ccw.
//   region 0 (right):       walnut tones
//   region 1 (top):         brand orange + warm highlight
//   region 2 (left):        ink + walnut
//   region 3 (bottom):      mid walnut + orange accent
const ZONE_PALETTES: string[][] = [
  ["#3a2418", "#3a2418", "#5a3a1f", "#1a1714"],
  ["#e87040", "#e87040", "#ffae6a", "#3a2418"],
  ["#1a1714", "#1a1714", "#3a2418", "#5a3a1f"],
  ["#5a3a1f", "#3a2418", "#e87040", "#1a1714"],
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

function paintRing(canvas: HTMLCanvasElement, dpr: number) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Two RNG streams — one for cell-fill decisions, one for color
  // choice — so changing density doesn't shift the color
  // distribution.
  const rngFill = makeRng(0xC0FFEE);
  const rngColor = makeRng(0xDECAF);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const outer = OUTER_R * canvas.width;
  const inner = INNER_R * canvas.width;
  const band = outer - inner;
  const cell = CELL_PX * dpr;
  const halfCell = cell / 2;
  const minX = Math.floor((cx - outer * STRAY_REACH) / cell) * cell;
  const maxX = Math.ceil((cx + outer * STRAY_REACH) / cell) * cell;
  const minY = Math.floor((cy - outer * STRAY_REACH) / cell) * cell;
  const maxY = Math.ceil((cy + outer * STRAY_REACH) / cell) * cell;
  for (let y = minY; y < maxY; y += cell) {
    for (let x = minX; x < maxX; x += cell) {
      const dx = x + halfCell - cx;
      const dy = y + halfCell - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      // Fill probability — band core 100%, edges taper, strays past.
      let p = 0;
      if (r >= inner && r <= outer) {
        p = 1;
      } else if (r > outer && r <= outer + band * EDGE_FUZZ_OUT) {
        const over = (r - outer) / (band * EDGE_FUZZ_OUT);
        p = (1 - over) ** 1.5;
      } else if (r < inner && r >= inner - band * EDGE_FUZZ_IN) {
        const under = (inner - r) / (band * EDGE_FUZZ_IN);
        p = (1 - under) ** 1.5;
      } else {
        // Way outside — chance of a stray dust pixel.
        p = STRAY_RATE * Math.max(0, 1 - (r - outer) / (outer * 0.7));
      }
      if (rngFill() < p) {
        // Color zone by angle. atan2 range -PI..PI → 0..4.
        const angle = Math.atan2(dy, dx);
        const norm = (angle + Math.PI) / (Math.PI * 2); // 0..1
        const zoneIdx = Math.floor(norm * ZONE_PALETTES.length) % ZONE_PALETTES.length;
        const palette = ZONE_PALETTES[zoneIdx]!;
        const color = palette[Math.floor(rngColor() * palette.length)]!;
        ctx.fillStyle = color;
        // Render cell minus 1 device pixel so each block has a hair-
        // line gap from its neighbors — reads as discrete bricks.
        ctx.fillRect(x, y, cell - dpr, cell - dpr);
      } else {
        // Advance color RNG too so colors stay deterministic per
        // cell across re-renders.
        rngColor();
      }
    }
  }
}

export function HeroBitmapRing({ size, spinDuration = 56, reverse }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
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
        style={{
          width: "100%",
          height: "100%",
          display: "block",
          imageRendering: "pixelated",
        }}
      />
    </div>
  );
}
