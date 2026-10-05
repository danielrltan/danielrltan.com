import { CHAR, ORANGE, WHITE, hotspot, layerCanvas, type Box, type CursorInfo } from "../kit";

/**
 * 22 · Gravity well. A sheet of spacetime (a 26 px grid) bends toward the
 * pointer like a mass: every vertex is pulled by M·d·S / (d² + S²), so lines
 * curve in from far away and pinch hard near it, fading out with distance.
 * Fast moves leave a wake: recent positions keep a decaying share of the mass,
 * so the dent trails behind you. Every button on the page dents the sheet
 * around its real box (deeper when hovered); holding the button piles on
 * mass; a click drops a ring ripple through the grid.
 */
const G = 26;
const S = 60;

export const gravity: CursorInfo = {
  id: 22,
  name: "Gravity well",
  family: "field",
  blurb:
    "A spacetime grid bends round the point like a mass, with a wake that trails fast moves; every button dents the sheet round its real box, holding piles on mass and a click drops a ripple through it.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const trail: { x: number; y: number; age: number }[] = [];
    const ripples: { x: number; y: number; t: number }[] = [];
    let boxes: Box[] = [];
    let boxesAt = -1;
    let lastX = -1, lastY = -1;

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        if (s.t - boxesAt > 0.5 || s.hoverChanged) {
          boxesAt = s.t;
          boxes = env.targets();
        }
        // wake
        if (!reduced && (Math.abs(s.x - lastX) > 2 || Math.abs(s.y - lastY) > 2)) {
          trail.push({ x: s.x, y: s.y, age: 0 });
          lastX = s.x;
          lastY = s.y;
        }
        for (let i = trail.length - 1; i >= 0; i--) {
          trail[i].age += dt;
          if (trail[i].age > 0.7) trail.splice(i, 1);
        }
        while (trail.length > 24) trail.shift();
        if (s.released && !reduced) ripples.push({ x: s.x, y: s.y, t: 0 });
        for (let i = ripples.length - 1; i >= 0; i--) {
          ripples[i].t += dt;
          if (ripples[i].t > 1.4) ripples.splice(i, 1);
        }
        const M = 1 + Math.min(2.2, s.held * 2.4);
        const hov = s.hover.kind === "click" ? s.hover.box : null;

        const disp = (vx: number, vy: number): [number, number] => {
          let ox = 0, oy = 0;
          const pull = (cx: number, cy: number, m: number) => {
            const dx = cx - vx, dy = cy - vy;
            const d = Math.hypot(dx, dy) || 1e-3;
            const p = Math.min(d * 0.85, (m * 36 * d * S) / (d * d + S * S));
            ox += (dx / d) * p;
            oy += (dy / d) * p;
          };
          pull(s.x, s.y, M);
          for (const t of trail) pull(t.x, t.y, 0.35 * Math.exp(-t.age * 5));
          for (const b of boxes) {
            const nx = Math.max(b.x, Math.min(vx, b.x + b.w)), ny = Math.max(b.y, Math.min(vy, b.y + b.h));
            const dx = vx - nx, dy = vy - ny;
            const d = Math.hypot(dx, dy);
            const R = hov && b.x === hov.x && b.y === hov.y ? 30 : 16;
            if (d < R) {
              const inside = d < 1e-3;
              const ux = inside ? Math.sign(vx - (b.x + b.w / 2)) : dx / d, uy = inside ? Math.sign(vy - (b.y + b.h / 2)) : dy / d;
              ox += ux * (R - d) * 0.75;
              oy += uy * (R - d) * 0.75;
            }
          }
          for (const r of ripples) {
            const dx = vx - r.x, dy = vy - r.y;
            const d = Math.hypot(dx, dy) || 1e-3;
            const front = r.t * 480;
            const env_ = Math.exp(-Math.pow((d - front) / 50, 2)) * Math.exp(-r.t * 2.2);
            const a = 11 * env_ * Math.sin((d - front) / 12);
            ox += (dx / d) * a;
            oy += (dy / d) * a;
          }
          return [vx + ox, vy + oy];
        };

        const cols = Math.ceil(s.w / G) + 1, rows = Math.ceil(s.h / G) + 1;
        const PX = new Float32Array(cols * rows), PY = new Float32Array(cols * rows);
        for (let j = 0; j < rows; j++)
          for (let i = 0; i < cols; i++) {
            const [x, y] = disp(i * G, j * G);
            PX[j * cols + i] = x;
            PY[j * cols + i] = y;
          }
        const bands = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
        const band = (x: number, y: number) => {
          const d = Math.hypot(x - s.x, y - s.y);
          return d < 110 ? 0 : d < 220 ? 1 : d < 360 ? 2 : 3;
        };
        for (let j = 0; j < rows; j++)
          for (let i = 0; i < cols; i++) {
            const k = j * cols + i;
            if (i + 1 < cols) {
              const p = bands[band(PX[k], PY[k])];
              p.moveTo(PX[k], PY[k]);
              p.lineTo(PX[k + 1], PY[k + 1]);
            }
            if (j + 1 < rows) {
              const p = bands[band(PX[k], PY[k])];
              p.moveTo(PX[k], PY[k]);
              p.lineTo(PX[k + cols], PY[k + cols]);
            }
          }
        const alphas = [0.6, 0.34, 0.16, 0.05];
        ctx.lineWidth = 1;
        bands.forEach((p, i) => {
          ctx.strokeStyle = `rgba(27,27,31,${alphas[i]})`;
          ctx.stroke(p);
        });
        // The mass: a dark core in an orange accretion ring.
        const r = 5 + M * 1.5;
        ctx.fillStyle = WHITE;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = s.surface === "orange" ? WHITE : ORANGE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = CHAR;
        ctx.beginPath();
        ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        ctx.fill();
        hotspot(ctx, s.x, s.y, 2);
        return trail.length > 0 || ripples.length > 0 || s.down;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
