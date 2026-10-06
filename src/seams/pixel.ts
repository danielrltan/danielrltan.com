/**
 * Pixel-grid helpers shared by the seams: the site's transitions are drawn in
 * hard cells (the hero iris's staircase, its Bayer-dithered rim), so every seam
 * that paints quantises SPACE to a cell grid and keeps progress continuous
 * ("quantise space, never time", spec §0.3). No gradients, no blur: flat fills
 * and ordered dither only.
 */

/** The 4x4 ordered-dither (Bayer) matrix, row-major: BAYER4[j * 4 + i]. Same table as heroWipe's rim. */
export const BAYER4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Bayer threshold of cell (i = column, j = row), 0..15. Negative indices wrap. */
export const bayer4 = (i: number, j: number) => BAYER4[mod(j, 4) * 4 + mod(i, 4)]!;

/**
 * 8x8 Bayer threshold, 0..63, built by the standard recursion
 * B8 = [[4·B4, 4·B4 + 2], [4·B4 + 3, 4·B4 + 1]], i.e.
 * B8[j][i] = 4 * B4[j%4][i%4] + B2[j>>2][i>>2] (the same step yields BAYER4
 * from B2). First row: 0 32 8 40 2 34 10 42.
 */
const BAYER2 = [0, 2, 3, 1];
const BAYER8: number[] = (() => {
  const t: number[] = [];
  for (let j = 0; j < 8; j++)
    for (let i = 0; i < 8; i++) t.push(4 * BAYER4[(j % 4) * 4 + (i % 4)]! + BAYER2[(j >> 2) * 2 + (i >> 2)]!);
  return t;
})();
export const bayer8 = (i: number, j: number) => BAYER8[mod(j, 8) * 8 + mod(i, 8)]!;

/** Deterministic hash of an integer cell, 0..1 (no seeded RNG state: a pure function of the cell). */
export function hash2(i: number, j: number): number {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Snap x to the nearest multiple of cell. */
export const snap = (x: number, cell: number) => (cell > 0 ? Math.round(x / cell) * cell : x);

// ── Pixel circle (copied verbatim from src/hero/heroWipe.ts; W1 may switch
// heroWipe to import it). Cell units, origin at the seed, y down. A cell
// [i,i+1]x[j,j+1] is inside a circle of radius n when its CENTRE is.

const inside = (i: number, j: number, n: number) => (i + 0.5) * (i + 0.5) + (j + 0.5) * (j + 0.5) <= n * n;

/** First-quadrant column heights (cells) of the pixel circle of radius n. */
export function columnHeights(n: number): number[] {
  const h: number[] = [];
  for (let i = 0; i < n; i++) {
    let k = 0;
    while (inside(i, k, n)) k++;
    h.push(k);
  }
  return h;
}

/**
 * Closed outline of the pixel circle of radius rCells (clockwise on screen),
 * in cell units times `cell` (default 1 = heroWipe's cell coordinates).
 */
export function pixelCircle(rCells: number, cell = 1): Array<[number, number]> {
  const n = rCells;
  const h = columnHeights(n);
  // First-quadrant staircase (x right, y UP) from (0, h0) out to (n, 0).
  const q: Array<[number, number]> = [[0, h[0]!]];
  for (let i = 0; i < n; i++) {
    const hi = h[i]!;
    const next = i + 1 < n ? h[i + 1]! : 0;
    q.push([i + 1, hi]);
    if (next !== hi) q.push([i + 1, next]);
  }
  const pts: Array<[number, number]> = [];
  for (const [x, y] of q) pts.push([x, -y]); // top-right
  for (let i = q.length - 2; i >= 0; i--) pts.push([q[i]![0], q[i]![1]]); // bottom-right
  for (let i = 1; i < q.length; i++) pts.push([-q[i]![0], q[i]![1]]); // bottom-left
  for (let i = q.length - 2; i > 0; i--) pts.push([-q[i]![0], -q[i]![1]]); // top-left
  return cell === 1 ? pts : pts.map(([x, y]) => [x * cell, y * cell]);
}

// ── Cell mask over a 2D canvas ──────────────────────────────────────────────

type RGB = readonly [number, number, number];
export interface CellMaskOpts {
  /** Area to cover, in the destination context's units (its current transform applies). */
  w: number;
  h: number;
  /** Cell size in the same units. Cells are anchored at (0, 0) of the context. */
  cell: number;
  /** Cover colour for state 1. */
  color: RGB;
  /** Colour for state 2 (default white, the hero rim's white). */
  white?: RGB;
  /** Per cell (i = column, j = row): 0 = clear (leave the canvas), 1 = cover with color, 2 = cover with white. */
  state: (i: number, j: number) => 0 | 1 | 2;
}

const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([0x0a0b0c0d]).buffer)[0] === 0x0d;
const pack = ([r, g, b]: RGB) =>
  LITTLE_ENDIAN ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 255) >>> 0;

interface MaskBuf {
  img: ImageData;
  u32: Uint32Array;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}
// Reused per grid size (a seam's grid only changes on resize); tiny LRU.
const bufs = new Map<string, MaskBuf>();
function maskBuf(cols: number, rows: number): MaskBuf | null {
  const key = `${cols}x${rows}`;
  let b = bufs.get(key);
  if (b) return b;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  // CPU-backed scratch: putImageData into a GPU-backed canvas paid a one-off
  // ~40ms upload/context set-up on the first visible iris frame (the Recents
  // iris, right at the Honours hold release: a visible hitch). In memory it is
  // a plain copy; the one scaled drawImage per frame uploads a tiny texture.
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const img = ctx.createImageData(cols, rows);
  b = { img, u32: new Uint32Array(img.data.buffer), canvas, ctx };
  if (bufs.size >= 4) bufs.delete(bufs.keys().next().value!);
  bufs.set(key, b);
  return b;
}

/**
 * Draw a cell-resolution mask over a 2D canvas: one ImageData pixel per cell,
 * put into a reusable offscreen canvas, then drawImage'd up by `cell` with
 * smoothing off, so every cell is a hard square. Budget: <= 1ms at 90x57
 * cells (one pass over the cells + one scaled blit).
 */
export function cellMask(ctx: CanvasRenderingContext2D, opts: CellMaskOpts): void {
  const { w, h, cell, state } = opts;
  if (!(cell > 0) || !(w > 0) || !(h > 0)) return;
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const b = maskBuf(cols, rows);
  if (!b) return;
  const cover = pack(opts.color);
  const white = pack(opts.white ?? [255, 255, 255]);
  const u32 = b.u32;
  let k = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++, k++) {
      const s = state(i, j);
      u32[k] = s === 1 ? cover : s === 2 ? white : 0;
    }
  }
  b.ctx.putImageData(b.img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(b.canvas, 0, 0, cols * cell, rows * cell);
  ctx.restore();
}
