import { CHAR, WHITE, hotspot, layerCanvas, type CursorInfo } from "../kit";

/**
 * 5 · Jelly cube. A wireframe cube round the point whose eight corners each
 * hang on their own soft spring (slightly different stiffnesses), so every
 * move shears and wobbles it like jelly before it sets back into a crisp
 * cube. Motion also rolls it a little. Over a button the springs' rest shape
 * becomes a jelly slab moulded to the button's real box; over text a tall thin
 * slab (a wobbly I-beam). Press splats it flat; release throws the corners
 * outward and it wobbles back together.
 */
const CORNERS: [number, number, number][] = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
const FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]];
const K = [420, 340, 460, 300, 380, 480, 320, 400];
/** How far a corner may lag its rest point (px): wobble, not taffy. */
const MAX_LAG = 22;

export const jelly: CursorInfo = {
  id: 5,
  name: "Jelly cube",
  family: "3D",
  blurb:
    "A wireframe cube whose eight corners hang on soft springs, so it shears and wobbles like jelly behind every move, moulds into a slab over a button's real box, splats when pressed and sets back crisp.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    let yaw = 0.6, pitch = -0.45;
    const V = CORNERS.map(() => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }));
    let init = false;

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = Math.min(s.dt, 1 / 40);
        let busy = false;
        if (!reduced) {
          yaw += (s.vx / 900) * dt * 2;
          pitch -= (s.vy / 900) * dt * 2;
        }
        const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const kind = s.hover.kind;
        const box = kind === "click" ? s.hover.box : null;
        // half-extents of the rest shape (local), or a world-space slab on a button
        let hx = 12, hy = 12, hz = 12;
        if (kind === "text" || kind === "input") { hx = 3; hy = 15; hz = 5; }
        if (s.down) { hx = 16; hy = 5; hz = 14; }
        const rest = CORNERS.map(([a, b, c]) => {
          if (box && !s.down) {
            const pad = 5;
            const bx = box.x + box.w / 2, by = box.y + box.h / 2;
            const x = a * (box.w / 2 + pad), y = b * (box.h / 2 + pad), z = c * 7;
            // small fixed tilt so the slab reads as 3D
            const t = 0.22;
            return { x: bx + x * Math.cos(t) + z * Math.sin(t) * 0.6, y: by + y + z * 0.35, z: z * Math.cos(t) };
          }
          const x = a * hx, y = b * hy, z = c * hz;
          const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
          const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
          return { x: s.x + x1, y: s.y + y2, z: z2 };
        });
        if (!init || reduced) {
          init = true;
          V.forEach((v, i) => Object.assign(v, rest[i], { vx: 0, vy: 0, vz: 0 }));
        }
        if (s.released && !reduced) {
          for (const v of V) {
            const cx = s.hover.box ? s.hover.box.x + s.hover.box.w / 2 : s.x, cy = s.hover.box ? s.hover.box.y + s.hover.box.h / 2 : s.y;
            const dx = v.x - cx, dy = v.y - cy, l = Math.hypot(dx, dy) || 1;
            v.vx += (dx / l) * 260;
            v.vy += (dy / l) * 260;
            v.vz += Math.sign(v.z) * 160;
          }
        }
        V.forEach((v, i) => {
          const k = K[i] * (box ? 1.2 : 1), c = 2 * 0.16 * Math.sqrt(k);
          const r = rest[i];
          v.vx += (k * (r.x - v.x) - c * v.vx) * dt;
          v.vy += (k * (r.y - v.y) - c * v.vy) * dt;
          v.vz += (k * (r.z - v.z) - c * v.vz) * dt;
          v.x += v.vx * dt;
          v.y += v.vy * dt;
          v.z += v.vz * dt;
          const lx = v.x - r.x, ly = v.y - r.y, ll = Math.hypot(lx, ly);
          if (ll > MAX_LAG) {
            v.x = r.x + (lx / ll) * MAX_LAG;
            v.y = r.y + (ly / ll) * MAX_LAG;
          }
          if (Math.abs(v.vx) + Math.abs(v.vy) + Math.abs(v.vz) > 0.6 || Math.abs(r.x - v.x) + Math.abs(r.y - v.y) > 0.3) busy = true;
        });
        if (s.speed > 3) busy = true;

        const F = 240;
        const P = V.map((v) => {
          const k = F / (F - v.z);
          const ox = box && !s.down ? box.x + box.w / 2 : s.x, oy = box && !s.down ? box.y + box.h / 2 : s.y;
          return [ox + (v.x - ox) * k, oy + (v.y - oy) * k, v.z];
        });
        const orange = s.surface === "orange";
        // jelly body
        ctx.fillStyle = orange ? "rgba(255,255,255,0.12)" : "rgba(255,79,0,0.09)";
        for (const f of FACES) {
          ctx.beginPath();
          f.forEach((i, j) => (j ? ctx.lineTo(P[i][0], P[i][1]) : ctx.moveTo(P[i][0], P[i][1])));
          ctx.closePath();
          ctx.fill();
        }
        // edges, back to front
        const es = EDGES.map(([a, b]) => ({ a, b, z: (P[a][2] + P[b][2]) / 2 })).sort((p, q) => p.z - q.z);
        ctx.lineCap = "round";
        for (const e of es) {
          const back = e.z < -2 && !box;
          ctx.beginPath();
          ctx.moveTo(P[e.a][0], P[e.a][1]);
          ctx.lineTo(P[e.b][0], P[e.b][1]);
          if (!back) {
            ctx.strokeStyle = WHITE;
            ctx.lineWidth = 3.6;
            ctx.stroke();
          }
          ctx.strokeStyle = back ? (orange ? "rgba(255,255,255,0.55)" : "rgba(27,27,31,0.35)") : CHAR;
          ctx.lineWidth = back ? 1.2 : 1.7;
          ctx.stroke();
        }
        // corner beads
        ctx.fillStyle = orange ? WHITE : "#ff4f00";
        for (const p of P) ctx.fillRect(Math.round(p[0] - 1.5), Math.round(p[1] - 1.5), 3, 3);
        hotspot(ctx, s.x, s.y, 3);
        return busy;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
