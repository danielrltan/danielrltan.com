/**
 * Voxel cursor art: every pointer state the site shows, rebuilt as extruded
 * pixel voxels and drawn on a 2D canvas with our own rotation + perspective
 * (no three.js on the cursor path).
 *
 * Glyphs are RASTERISED FROM THE ORIGINAL SVG PATHS (the old public/Cursor.svg,
 * Cursor-Hover.svg, Pan-Neutral.svg and Pan-Direction.svg, which these replace;
 * their path data is inlined below, coordinates unchanged), sampled 4×4 per cell
 * and kept where coverage ≥ 45 %, so the voxel dart is the site's own dart, not
 * a generic arrow. Each glyph's cells are relative to its hotspot (the arrow's
 * tip; the pan art's anchor), so the hotspot never moves between states.
 *
 * LEGIBILITY (owner: must read on orange): the face is charcoal (#1B1B1F, the
 * one tone that reads on white, solid orange and the dotted hero), the
 * extrusion walls are hue-shifted orange → deep orange → rust, and a white
 * keyline wraps the WHOLE extruded volume (every layer is stroked white before
 * any layer is filled, so only the outer silhouette's keyline survives), with a
 * soft offset shadow under it. On orange the walls may sit close to the field,
 * but the keyline and rust far wall still draw the block.
 */

/** Cursor.svg is 151 wide and renders 32 px wide: px per SVG unit. */
export const SVG_PX = 32 / 151;
/** Screen px per voxel. */
export const VOXEL = 1.9;

type Pt = [number, number];
export type Cells = Pt[];

function inPoly(x: number, y: number, poly: Pt[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Rasterise SVG-space polygons to cells relative to `anchor` (SVG units). */
function rasterise(polys: Pt[][], anchor: Pt): Cells {
  const c = VOXEL / SVG_PX; // SVG units per cell
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const out: Cells = [];
  const gx0 = Math.floor((x0 - anchor[0]) / c), gx1 = Math.ceil((x1 - anchor[0]) / c);
  const gy0 = Math.floor((y0 - anchor[1]) / c), gy1 = Math.ceil((y1 - anchor[1]) / c);
  for (let gy = gy0; gy <= gy1; gy++)
    for (let gx = gx0; gx <= gx1; gx++) {
      let hit = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const x = anchor[0] + (gx + (sx + 0.5) / 4) * c;
          const y = anchor[1] + (gy + (sy + 0.5) / 4) * c;
          if (polys.some((p) => inPoly(x, y, p))) hit++;
        }
      if (hit >= 7) out.push([gx, gy]);
    }
  return out;
}

const rect = (x: number, y: number, w: number, h: number, m?: number[]): Pt[] => {
  const pts: Pt[] = [[0, 0], [w, 0], [w, h], [0, h]];
  if (!m) return pts.map(([u, v]) => [x + u, y + v]);
  // SVG matrix(a b c d e f) applied to the rect at its own origin
  return pts.map(([u, v]) => [m[0] * (x + u) + m[2] * (y + v) + m[4], m[1] * (x + u) + m[3] * (y + v) + m[5]]);
};
const rotAbout = (deg: number, cx: number, cy: number) => {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy];
};

// --- Cursor.svg: the dart. Tip (19.9652, 14.4321) is the hotspot.
const DART: Pt[] = [[43.1366, 132.529], [19.9652, 14.4321], [126.356, 72.724], [73.9493, 87.9276]];
export const ARROW = rasterise([DART], [19.9652, 14.4321]);

// --- Cursor-Hover.svg: the same dart (tip 78.0951, 68.2525) + three sparks.
const HOVER_TIP: Pt = [78.0951, 68.2525];
export const SPARKS = rasterise(
  [
    [[66.4832, 46.5306], [60.5311, 50.9283], [36.8994, 18.9407], [42.8522, 14.5436]],
    [[90.6293, 46.2166], [83.5551, 44.0433], [92.8942, 13.6485], [99.9684, 15.8227]],
    [[52.1206, 65.387], [51.7862, 72.7799], [20.0215, 71.3417], [20.3569, 63.9485]],
  ],
  HOVER_TIP,
);

// --- Pan-Neutral.svg: up + down darts about the anchor (74, 150.8).
export const PAN_NEUTRAL = rasterise(
  [
    [[23.1133, 125.549], [73.2164, 16.1247], [125.593, 125.549], [74.1637, 107.311]],
    [[124.456, 176.125], [74.3531, 285.549], [21.9765, 176.125], [73.4058, 194.362]],
  ],
  [74, 150.8],
);

// --- Pan-Direction.svg: the down dart + three motion feathers, anchor
// (73.5, 46). The UP state is this flipped vertically about the anchor.
export const PAN_DOWN = rasterise(
  [
    [[124.456, 71.4], [74.3531, 180.824], [21.9765, 71.4], [73.4058, 89.6373]],
    rect(69.9768, 12.4, 8, 49),
    rect(31.2779, 22.7819, 8, 32.637, rotAbout(-10.1731, 31.2779, 22.7819)),
    rect(0, 0, 8, 32.637, [-0.984278, -0.176624, -0.176624, 0.984278, 116.615, 22.813]),
  ],
  [73.5, 46],
);
export const PAN_UP: Cells = PAN_DOWN.map(([x, y]) => [x, -1 - y]);

// ------------------------------------------------------------------ render

export interface Pose {
  /** Tilt about X / Y (radians). */
  rx: number;
  ry: number;
  /** Extrusion depth multiplier (1 = full, ~0.2 = pressed flat). */
  depth: number;
  /** Uniform scale about the hotspot. */
  scale: number;
}

const WALLS = ["#ff7a2e", "#e04800", "#c23d00", "#8f2a00"]; // near → far
export const CHAR = "#1b1b1f";
const LAYERS = 5;
const F = 220; // focal length (px)

/**
 * Draw `cells` as an extruded voxel block with its hotspot at (ox, oy) in CSS
 * px. `ctx` must be in CSS px (its transform is restored after).
 */
export function drawVoxels(
  ctx: CanvasRenderingContext2D,
  cells: Cells,
  ox: number,
  oy: number,
  pose: Pose,
  dpr: number,
  opts: { face?: string; walls?: string[]; shadow?: boolean; lift?: number } = {},
) {
  if (!cells.length) return;
  const cxr = Math.cos(pose.rx), sxr = Math.sin(pose.rx), cyr = Math.cos(pose.ry), syr = Math.sin(pose.ry);
  const U = VOXEL * pose.scale;
  const lift = opts.lift ?? 0;
  const P = (x: number, y: number, z: number): Pt => {
    const x1 = x * cyr + z * syr;
    const z1 = -x * syr + z * cyr;
    const y2 = y * cxr - z1 * sxr;
    const z2 = y * sxr + z1 * cxr;
    const k = F / (F - z2);
    return [ox + x1 * k, oy + y2 * k];
  };
  // One layer = the cells under an affine map (cell units → screen), which is
  // exact for a flat slab and close enough under this mild perspective.
  const setLayer = (z: number) => {
    const o = P(0, 0, z), ex = P(U, 0, z), ey = P(0, U, z);
    ctx.setTransform(dpr * (ex[0] - o[0]), dpr * (ex[1] - o[1]), dpr * (ey[0] - o[0]), dpr * (ey[1] - o[1]), dpr * o[0], dpr * o[1]);
  };
  const path = new Path2D();
  for (const [x, y] of cells) path.rect(x, y, 1.04, 1.04);
  const step = U * 0.95 * pose.depth;
  const zs: number[] = [];
  for (let l = LAYERS; l >= 0; l--) zs.push(lift - l * step);

  // Shadow: the face silhouette, offset down-right and soft.
  if (opts.shadow !== false) {
    ctx.save();
    setLayer(zs[0]);
    ctx.translate(0.7, 1.6);
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000";
    ctx.fill(path);
    ctx.restore();
  }
  // Keyline pass: every layer stroked white first, so after the fills only
  // the OUTER silhouette of the whole volume keeps its keyline.
  const kw = 2.4 / U; // ~1.2 px each side, in cell units
  ctx.strokeStyle = "#ffffff";
  ctx.lineJoin = "miter";
  for (const z of zs) {
    setLayer(z);
    ctx.lineWidth = kw;
    ctx.stroke(path);
  }
  const walls = opts.walls ?? WALLS;
  zs.forEach((z, i) => {
    setLayer(z);
    const isFace = i === zs.length - 1;
    // far layers darkest (hue shift toward rust), near walls lightest
    ctx.fillStyle = isFace ? (opts.face ?? CHAR) : walls[Math.min(walls.length - 1, Math.floor(((zs.length - 2 - i) / (zs.length - 1)) * walls.length))];
    ctx.fill(path);
  });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/**
 * The click burst: a ring of eight "exclamations" (1-voxel spark bars like the
 * hover art's three) pointing out from the hotspot, starting `radius` px out
 * and `len` voxels long. Rebuilt per frame (8 short bars: trivial).
 */
export function sparkBurst(radius: number, len: number): Cells {
  const out: Cells = [];
  const seen = new Set<string>();
  const r0 = radius / VOXEL;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let d = r0; d <= r0 + Math.max(1, len); d += 0.5) {
      const x = Math.round(ca * d), y = Math.round(sa * d);
      const key = x + "," + y;
      if (!seen.has(key)) {
        seen.add(key);
        out.push([x, y]);
      }
    }
  }
  return out;
}
