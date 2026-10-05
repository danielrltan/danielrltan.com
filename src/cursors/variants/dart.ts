import { CHAR, WHITE, clamp, damp, hotspot, layerCanvas, spring, type CursorInfo } from "../kit";

/**
 * 2 · Paper dart. A folded paper dart in real 3D (wings + keel as polygons,
 * heading · pitch · roll matrix, perspective, painter-sorted, lit per face).
 * Its nose IS the hotspot: it points where you're heading, banks into turns
 * in proportion to how fast your heading changes, and dips its nose with
 * vertical speed. Over a button it noses down into the page (landing), over
 * text it rolls knife-edge, press folds the wings in, release flies a loop.
 * Idle, it peels off into a few lazy banked circles round the point, then
 * lands back on it, pointing up-left like a system arrow, and parks.
 */
type V = [number, number, number];
const LOCAL = {
  nose: [0, 0, 0] as V,
  tail: [-34, 0, 0] as V,
  wl: [-31, -15, 0] as V,
  wr: [-31, 15, 0] as V,
  keel: [-28, 0, -10] as V,
};
const REST_HEADING = Math.atan2(-1, -1); // nose up-left, body trailing down-right

function rot(h: number, pitch: number, roll: number) {
  // M = Rz(h) · Ry(pitch) · Rx(roll); columns are the local axes in world.
  const ch = Math.cos(h), sh = Math.sin(h), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const Rz = [ch, -sh, 0, sh, ch, 0, 0, 0, 1];
  const Ry = [cp, 0, sp, 0, 1, 0, -sp, 0, cp];
  const Rx = [1, 0, 0, 0, cr, -sr, 0, sr, cr];
  const mul = (a: number[], b: number[]) => {
    const o = new Array(9).fill(0);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
    return o;
  };
  return mul(Rz, mul(Ry, Rx));
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export const dart: CursorInfo = {
  id: 2,
  name: "Paper dart",
  family: "3D",
  blurb:
    "A folded paper dart whose nose is the click point: it points where you're heading, banks into turns, noses down onto buttons, rolls knife-edge over text, loops on click and circles lazily when idle.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const head = { x: REST_HEADING, v: 0 };
    const pitch = { x: 0, v: 0 };
    const roll = { x: 0, v: 0 };
    const fold = { x: 1, v: 0 };
    const detach = { x: 0, v: 0 };
    let turn = 0;
    let lastHead = REST_HEADING;
    let loop = -1; // 0..1 while looping
    let circ = 0;

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        let busy = false;

        // Heading follows motion (only when actually moving).
        const idleCircle = !reduced && s.idle > 0.9 && s.idle < 4.2 && !s.hover.kind && !s.down;
        let targetHead = head.x;
        if (s.speed > 60) targetHead = Math.atan2(s.vy, s.vx);
        else if (s.idle > 4.2 || reduced) targetHead = REST_HEADING;
        if (idleCircle) {
          circ += dt * 2.3;
          targetHead = circ + Math.PI / 2;
        } else circ = Math.atan2(Math.sin(head.x - Math.PI / 2), Math.cos(head.x - Math.PI / 2));
        const dh = wrap(targetHead - head.x);
        busy = spring(head, head.x + dh, dt, 260, 0.75) || busy;
        turn = damp(turn, wrap(head.x - lastHead) / Math.max(dt, 1e-3), 10, dt);
        lastHead = head.x;

        const kind = s.hover.kind;
        const bank = idleCircle ? 0.65 : clamp(turn * 0.12, -1.15, 1.15);
        const rollT = kind === "text" || kind === "input" ? 1.45 : reduced ? 0 : bank;
        const pitchT = kind === "click" ? 0.95 : clamp(s.vy / 2400, -0.35, 0.35);
        busy = spring(roll, rollT, dt, 180, 0.6) || busy;
        busy = spring(pitch, pitchT, dt, 200, 0.6) || busy;
        busy = spring(fold, s.down ? 0.45 : 1, dt, 420, 0.45) || busy;
        busy = spring(detach, idleCircle ? 1 : 0, dt, 60, 0.9) || busy;
        if (s.released && !reduced) loop = 0;
        let loopA = 0;
        if (loop >= 0) {
          loop += dt / 0.55;
          if (loop >= 1) loop = -1;
          else {
            loopA = -Math.PI * 2 * (1 - Math.pow(1 - loop, 2));
            busy = true;
          }
        }
        if (idleCircle) busy = true;

        // Where the nose sits: on the point, or out on its idle circle.
        const ox = s.x + Math.cos(circ) * 22 * detach.x;
        const oy = s.y + Math.sin(circ) * 22 * detach.x;
        const M = rot(head.x, pitch.x + loopA, roll.x);
        const F = 260;
        const P = (v: V): [number, number, number] => {
          const lx = v[0], ly = v[1] * (v === LOCAL.wl || v === LOCAL.wr ? fold.x : 1), lz = v[2];
          const x = M[0] * lx + M[1] * ly + M[2] * lz;
          const y = M[3] * lx + M[4] * ly + M[5] * lz;
          const z = M[6] * lx + M[7] * ly + M[8] * lz;
          const k = F / (F - z);
          return [ox + x * k, oy + y * k, z];
        };
        const n = P(LOCAL.nose), t = P(LOCAL.tail), l = P(LOCAL.wl), r = P(LOCAL.wr), k = P(LOCAL.keel);
        const faces = [[n, l, t], [n, t, r], [n, t, k]];
        const L = [-0.4, -0.6, 0.7];
        const shaded = faces.map((f) => {
          const ax = f[1][0] - f[0][0], ay = f[1][1] - f[0][1], az = f[1][2] - f[0][2];
          const bx = f[2][0] - f[0][0], by = f[2][1] - f[0][1], bz = f[2][2] - f[0][2];
          let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len; ny /= len; nz /= len;
          const lit = Math.abs(nx * L[0] + ny * L[1] + nz * L[2]);
          return { f, z: (f[0][2] + f[1][2] + f[2][2]) / 3, lit };
        });
        shaded.sort((a, b) => a.z - b.z);
        ctx.lineJoin = "round";
        for (const { f, lit } of shaded) {
          ctx.beginPath();
          ctx.moveTo(f[0][0], f[0][1]);
          ctx.lineTo(f[1][0], f[1][1]);
          ctx.lineTo(f[2][0], f[2][1]);
          ctx.closePath();
          const g = Math.round(196 + 59 * Math.min(1, 0.35 + lit));
          ctx.fillStyle = `rgb(255,${g},${Math.round(g * 0.82 + 46)})`;
          ctx.fill();
          ctx.strokeStyle = WHITE;
          ctx.lineWidth = 3.2;
          ctx.stroke();
          ctx.strokeStyle = CHAR;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }
        // re-draw the fill over the inner keylines so only the silhouette keeps the white rim
        for (const { f, lit } of shaded) {
          ctx.beginPath();
          ctx.moveTo(f[0][0], f[0][1]);
          ctx.lineTo(f[1][0], f[1][1]);
          ctx.lineTo(f[2][0], f[2][1]);
          ctx.closePath();
          const g = Math.round(196 + 59 * Math.min(1, 0.35 + lit));
          ctx.fillStyle = `rgb(255,${g},${Math.round(g * 0.82 + 46)})`;
          ctx.fill();
          ctx.strokeStyle = CHAR;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        if (detach.x > 0.05) {
          // dotted tether so the click point never goes missing
          ctx.fillStyle = s.surface === "orange" ? WHITE : CHAR;
          for (let i = 1; i < 4; i++) {
            const f = i / 4;
            ctx.globalAlpha = detach.x * 0.6;
            ctx.fillRect(Math.round(s.x + (ox - s.x) * f) - 1, Math.round(s.y + (oy - s.y) * f) - 1, 2, 2);
          }
          ctx.globalAlpha = 1;
        }
        hotspot(ctx, s.x, s.y, 3);
        return busy;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
