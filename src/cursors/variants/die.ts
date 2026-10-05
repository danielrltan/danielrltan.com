import { CHAR, ORANGE, hotspot, layerCanvas, spring, type CursorInfo } from "../kit";

/**
 * 3 · Rolling die. A pixel-pip die riding just off the point, lying on the
 * page as if the page were a table seen from above. It ROLLS: every frame its
 * orientation turns about n × d (page normal × displacement) by |d| / r, so
 * the top face travels with you like a real die, corners and all. Stop and it
 * settles flat, square to the page, on whatever face came up. Over a button
 * it lifts off the table (shadow drops away); over text it tucks small; press
 * squashes it and release throws it: a decaying tumble that lands on a new
 * face. Then it parks.
 */
type M = number[]; // 3x3 row-major; columns = local axes in world
const S = 18; // edge, px
const H = S / 2;
const OFF = { x: 20, y: 20 };

const mul = (a: M, b: M): M => {
  const o = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
function axisAngle(x: number, y: number, z: number, a: number): M {
  const c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}
/** Re-orthonormalise (Gram–Schmidt on columns) so float drift never skews it. */
function ortho(m: M): M {
  let ax = [m[0], m[3], m[6]];
  let l = Math.hypot(ax[0], ax[1], ax[2]);
  ax = ax.map((v) => v / l);
  let ay = [m[1], m[4], m[7]];
  const d = ax[0] * ay[0] + ax[1] * ay[1] + ax[2] * ay[2];
  ay = ay.map((v, i) => v - d * ax[i]);
  l = Math.hypot(ay[0], ay[1], ay[2]);
  ay = ay.map((v) => v / l);
  const az = [ax[1] * ay[2] - ax[2] * ay[1], ax[2] * ay[0] - ax[0] * ay[2], ax[0] * ay[1] - ax[1] * ay[0]];
  return [ax[0], ay[0], az[0], ax[1], ay[1], az[1], ax[2], ay[2], az[2]];
}
// Faces: [axis, sign, pips]. Opposites sum to 7.
const FACES: [number, number, number][] = [[2, 1, 1], [2, -1, 6], [0, 1, 3], [0, -1, 4], [1, 1, 2], [1, -1, 5]];
const PIPS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

export const die: CursorInfo = {
  id: 3,
  name: "Rolling die",
  family: "3D",
  blurb:
    "A pixel die beside the point that truly rolls along your path (it turns about the axis perpendicular to motion by distance ÷ radius), settles flat when you stop, lifts off over buttons and tumbles to a new face on click.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    let R: M = mul(axisAngle(1, 0, 0, -0.5), axisAngle(0, 1, 0, 0.6));
    let px = NaN, py = NaN;
    let w = [0, 0, 0]; // tumble angular velocity (world)
    const lift = { x: 0, v: 0 };
    const scale = { x: 1, v: 0 };

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        let busy = false;
        const cx = s.x + OFF.x, cy = s.y + OFF.y;
        if (Number.isNaN(px)) {
          px = cx;
          py = cy;
        }
        const dx = cx - px, dy = cy - py;
        px = cx;
        py = cy;
        const dist = Math.hypot(dx, dy);
        if (!reduced && dist > 0.01 && dist < 200) {
          // roll: axis = n × d with n = +z (toward the viewer)
          R = mul(axisAngle(-dy / dist, dx / dist, 0, dist / H), R);
          busy = true;
        }
        if (s.released && !reduced) {
          const a = Math.random() * Math.PI * 2;
          w = [Math.cos(a) * 16, Math.sin(a) * 16, (Math.random() - 0.5) * 10];
        }
        const wm = Math.hypot(w[0], w[1], w[2]);
        if (wm > 0.3) {
          R = mul(axisAngle(w[0] / wm, w[1] / wm, w[2] / wm, wm * dt), R);
          const f = Math.exp(-3.2 * dt);
          w = w.map((v) => v * f);
          busy = true;
        } else w = [0, 0, 0];
        // settle: nearest face square to the viewer, then square in-plane
        if (dist < 0.3 && wm <= 0.3) {
          let best = 0, bz = 0;
          for (let c = 0; c < 3; c++) if (Math.abs(R[6 + c]) > Math.abs(bz)) { bz = R[6 + c]; best = c; }
          const sg = Math.sign(bz) || 1;
          const v = [R[best] * sg, R[3 + best] * sg, R[6 + best] * sg];
          // axis = v × z
          const ax = v[1], ay = -v[0];
          const sa = Math.hypot(ax, ay);
          const k = Math.min(1, dt * 14);
          if (sa > 1e-4) {
            R = mul(axisAngle(ax / sa, ay / sa, 0, Math.asin(Math.min(1, sa)) * k), R);
            busy = true;
          }
          const other = (best + 1) % 3;
          const ang = Math.atan2(R[3 + other], R[other]);
          const tgt = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
          if (Math.abs(ang - tgt) > 1e-3) {
            R = mul(axisAngle(0, 0, 1, (tgt - ang) * k), R);
            busy = true;
          }
        }
        R = ortho(R);
        busy = spring(lift, s.hover.kind === "click" ? 1 : 0, dt, 220, 0.55) || busy;
        const sTarget = s.down ? 0.84 : s.hover.kind === "text" || s.hover.kind === "input" ? 0.72 : 1 + lift.x * 0.12;
        busy = spring(scale, sTarget, dt, 380, 0.5) || busy;

        const F = 220;
        const sc = scale.x;
        // Fixed camera: the table is seen at an angle, turned a little, so a
        // die resting flat still shows its top and two sides.
        const VZ = 0.42, VX = 0.62;
        const cz = Math.cos(VZ), sz = Math.sin(VZ), ccx = Math.cos(VX), scx = Math.sin(VX);
        const view = (x: number, y: number, z: number): [number, number, number] => {
          const x1 = x * cz - y * sz, y1 = x * sz + y * cz;
          return [x1, y1 * ccx - z * scx, y1 * scx + z * ccx];
        };
        const proj = (l: number[]): [number, number, number] => {
          const [x, y, z] = view(
            (R[0] * l[0] + R[1] * l[1] + R[2] * l[2]) * sc,
            (R[3] * l[0] + R[4] * l[1] + R[5] * l[2]) * sc,
            (R[6] * l[0] + R[7] * l[1] + R[8] * l[2]) * sc,
          );
          const k = F / (F - z);
          return [cx + x * k, cy + y * k - lift.x * 5, z];
        };
        const vis: { pts: [number, number, number][]; lit: number; pips: number; u: number; v: number; n: number[] }[] = [];
        for (const [axis, sign, pips] of FACES) {
          const nv = view(R[axis] * sign, R[3 + axis] * sign, R[6 + axis] * sign);
          if (nv[2] <= 0.02) continue;
          const u = (axis + 1) % 3, v = (axis + 2) % 3;
          const corner = (a: number, b: number) => {
            const l = [0, 0, 0];
            l[axis] = sign * H;
            l[u] = a * H;
            l[v] = b * H;
            return proj(l);
          };
          const lit = Math.max(0, nv[0] * -0.35 + nv[1] * -0.45 + nv[2] * 0.82);
          vis.push({ pts: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], lit, pips, u, v, n: [axis, sign] });
        }
        // shadow on the "table"
        const so = 2 + lift.x * 6;
        ctx.fillStyle = s.surface === "orange" ? "rgba(122,34,0,0.32)" : "rgba(27,27,31,0.1)";
        for (const f of vis) {
          ctx.beginPath();
          f.pts.forEach((p, i) => (i ? ctx.lineTo(p[0] + so, p[1] + lift.x * 5 + so * 0.6) : ctx.moveTo(p[0] + so, p[1] + lift.x * 5 + so * 0.6)));
          ctx.fill();
        }
        ctx.lineJoin = "round";
        for (const f of vis) {
          ctx.beginPath();
          f.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.closePath();
          const g = Math.round(200 + 55 * Math.min(1, f.lit + 0.15));
          ctx.fillStyle = `rgb(255,${g},${Math.round(160 + 95 * Math.min(1, f.lit + 0.15))})`;
          ctx.fill();
          ctx.strokeStyle = CHAR;
          ctx.lineWidth = 1.4;
          ctx.stroke();
          // pips: little squares at projected face points
          const [axis, sign] = f.n;
          const ps = Math.max(1.5, 2.6 * sc);
          ctx.fillStyle = f.pips === 1 ? ORANGE : CHAR;
          for (const [a, b] of PIPS[f.pips]) {
            const l = [0, 0, 0];
            l[axis] = sign * H;
            l[f.u] = a * H * 0.5;
            l[f.v] = b * H * 0.5;
            const p = proj(l);
            ctx.fillRect(Math.round(p[0] - ps / 2), Math.round(p[1] - ps / 2), Math.round(ps), Math.round(ps));
          }
        }
        hotspot(ctx, s.x, s.y, 4);
        return busy;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
