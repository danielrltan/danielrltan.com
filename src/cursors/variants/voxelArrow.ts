import { CHAR, DEEP, ORANGE, WHITE, clamp, hotspot, layerCanvas, spring, type CursorInfo } from "../kit";

/**
 * 4 · Voxel arrow. The site's own charcoal arrow, re-drawn as pixel voxels and
 * extruded back into the page in orange layers (hue-shifted toward deep
 * orange as they recede). It hangs from its tip like a card with inertia:
 * acceleration swings it on underdamped springs about the tip, so it lags,
 * leans and wobbles back. Over a button three spark voxels (the hover art's
 * sparks) pop out toward you; over text it turns edge-on, a slab; press
 * squashes the extrusion flat like a key going down, release springs it back.
 */
const ART = [
  "X",
  "XX",
  "XXX",
  "XXXX",
  "XXXXX",
  "XXXXXX",
  "XXXXXXX",
  "XXXXXXXX",
  "XXXXXXXXX",
  "XXXXXXXXXX",
  "XXXXXX",
  "XXX.XXX",
  "XX..XXX",
  "X....XXX",
  ".....XXX",
  "......XXX",
  "......XX",
];
const CELLS: [number, number][] = [];
ART.forEach((row, y) => [...row].forEach((c, x) => c === "X" && CELLS.push([x, y])));
const SPARKS: [number, number][] = [[0, -3], [0, -4], [-3, 0], [-4, 0], [-2, -2], [-3, -3]];
const U = 1.9; // px per voxel
const DEPTH = 6; // layers

export const voxelArrow: CursorInfo = {
  id: 4,
  name: "Voxel arrow",
  family: "3D",
  blurb:
    "The site's charcoal arrow rebuilt in voxels and extruded in orange: it hangs from its tip with inertia and wobbles on springs, pops spark voxels out over buttons, turns edge-on over text, and squashes flat when pressed.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const rx = { x: 0.42, v: 0 };
    const ry = { x: -0.6, v: 0 };
    const depth = { x: 1, v: 0 };
    const spark = { x: 0, v: 0 };

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        let busy = false;
        const kind = s.hover.kind;
        // resting pose shows a little of the extrusion; inertia swings it
        let tx = 0.42, ty = -0.6;
        if (!reduced) {
          tx += clamp(-s.ay / 7000 - s.vy / 4000, -0.9, 0.9);
          ty += clamp(s.ax / 7000 + s.vx / 4000, -0.9, 0.9);
        }
        if (kind === "text" || kind === "input") ty = -1.3;
        busy = spring(rx, tx, dt, 110, 0.32) || busy;
        busy = spring(ry, ty, dt, 110, 0.32) || busy;
        busy = spring(depth, s.down ? 0.18 : 1, dt, 520, s.down ? 0.9 : 0.3) || busy;
        busy = spring(spark, kind === "click" ? 1 : 0, dt, 300, 0.45) || busy;

        const cxr = Math.cos(rx.x), sxr = Math.sin(rx.x), cyr = Math.cos(ry.x), syr = Math.sin(ry.x);
        const F = 200;
        const scale = s.down ? 0.92 : 1;
        // Ry then Rx; tip at the origin = the pointer
        const P = (x: number, y: number, z: number): [number, number] => {
          x *= scale; y *= scale;
          const x1 = x * cyr + z * syr;
          const z1 = -x * syr + z * cyr;
          const y2 = y * cxr - z1 * sxr;
          const z2 = y * sxr + z1 * cxr;
          const k = F / (F - z2);
          return [s.x + x1 * k, s.y + y2 * k];
        };
        const dpr = cv.box.dpr;
        const layer = (z: number, cells: [number, number][], fill: string, keyline: boolean) => {
          const o = P(0, 0, z), ex = P(U, 0, z), ey = P(0, U, z);
          ctx.setTransform(dpr * (ex[0] - o[0]), dpr * (ex[1] - o[1]), dpr * (ey[0] - o[0]), dpr * (ey[1] - o[1]), dpr * o[0], dpr * o[1]);
          ctx.beginPath();
          for (const [x, y] of cells) ctx.rect(x, y, 1.02, 1.02);
          if (keyline) {
            ctx.strokeStyle = WHITE;
            ctx.lineWidth = 0.9;
            ctx.lineJoin = "miter";
            ctx.stroke();
          }
          ctx.fillStyle = fill;
          ctx.fill();
        };
        const d = depth.x * U;
        for (let l = DEPTH; l >= 1; l--) {
          const t = l / DEPTH;
          // hue shift: near layers bright orange, far ones deep
          const col = t > 0.66 ? DEEP : t > 0.33 ? "#e04800" : ORANGE;
          layer(-l * d, CELLS, col, false);
        }
        layer(0, CELLS, CHAR, true);
        // spark voxels pop out toward the viewer
        if (spark.x > 0.02) {
          const lift = spark.x * 5;
          for (let l = 0; l <= 3; l++) layer(lift * U * (l / 3), SPARKS, l === 3 ? (s.surface === "orange" ? WHITE : CHAR) : ORANGE, l === 3);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        hotspot(ctx, s.x, s.y, 2);
        return busy;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
