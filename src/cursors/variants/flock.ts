import { CHAR, WHITE, hotspot, layerCanvas, type Box, type CursorInfo } from "../kit";

/**
 * 13 · Flock. Twenty-eight pixel birds flock round the point with the three
 * boid rules (separate, align, cohere) plus a pull toward a goal. Fast moves
 * stretch them into a trailing stream. Over a button they wheel round its
 * real outline, each holding its own spot on the perimeter; over text they
 * perch along the line's baseline like birds on a wire. A click scatters
 * them; idle, they settle into a slow ring and the loop parks.
 */
const NB = 28;

function perimeter(b: Box, u: number, pad: number): [number, number] {
  const w = b.w + pad * 2, h = b.h + pad * 2, x0 = b.x - pad, y0 = b.y - pad;
  const P = 2 * (w + h);
  let d = (((u % 1) + 1) % 1) * P;
  if (d < w) return [x0 + d, y0];
  d -= w;
  if (d < h) return [x0 + w, y0 + d];
  d -= h;
  if (d < w) return [x0 + w - d, y0 + h];
  d -= w;
  return [x0, y0 + h - d];
}

export const flock: CursorInfo = {
  id: 13,
  name: "Flock",
  family: "physics",
  blurb:
    "Pixel birds flock round the point (separate, align, cohere): they stream behind fast moves, wheel round a button's real outline, perch along a line of text like birds on a wire, scatter on click and settle into a ring when idle.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const B = Array.from({ length: NB }, (_, i) => ({ x: 0, y: 0, vx: 0, vy: 0, u: i / NB, ph: rnd() * 6 }));
    let init = false;
    let scatter = 0;
    let t = 0;
    let calm = 0; // 0..1: idle settle

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = Math.min(s.dt, 1 / 40);
        t += dt;
        if (!init) {
          init = true;
          B.forEach((b, i) => {
            const a = (i / NB) * Math.PI * 2;
            b.x = s.x + Math.cos(a) * 26;
            b.y = s.y + Math.sin(a) * 26;
          });
        }
        if (s.released && !reduced) {
          scatter = 1;
          for (const b of B) {
            const dx = b.x - s.x, dy = b.y - s.y;
            const d = Math.hypot(dx, dy) || 1;
            b.vx += (dx / d) * 620;
            b.vy += (dy / d) * 620;
          }
        }
        scatter = Math.max(0, scatter - dt * 1.4);
        calm = s.idle > 1.5 ? Math.min(1, calm + dt * 0.8) : 0;
        const box = s.hover.box;
        const kind = s.hover.kind;
        const maxSp = 520 + Math.min(1600, s.speed * 1.15);
        let energy = 0;

        for (let i = 0; i < NB; i++) {
          const b = B[i];
          b.u += dt * 0.06;
          // goal
          let gx: number, gy: number;
          if (box && kind === "click") [gx, gy] = perimeter(box, b.u, 9);
          else if (box && (kind === "text" || kind === "input")) {
            gx = box.x + ((i + 0.5) / NB) * box.w;
            gy = box.y + box.h + 3;
          } else {
            const a = (i / NB) * Math.PI * 2 + t * (0.6 + (1 - calm) * 0.6);
            const r = 22 + 8 * Math.sin(b.ph + t);
            gx = s.x + Math.cos(a) * r;
            gy = s.y + Math.sin(a) * r * 0.8;
          }
          let ax = (gx - b.x) * 34 - b.vx * 3.2, ay = (gy - b.y) * 34 - b.vy * 3.2;
          // boid rules
          let sx = 0, sy = 0, avx = 0, avy = 0, cx = 0, cy = 0, n = 0;
          for (let j = 0; j < NB; j++) {
            if (j === i) continue;
            const o = B[j];
            const dx = o.x - b.x, dy = o.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < 81) { sx -= dx / (d2 + 1); sy -= dy / (d2 + 1); }
            if (d2 < 900) { avx += o.vx; avy += o.vy; cx += o.x; cy += o.y; n++; }
          }
          ax += sx * 2600;
          ay += sy * 2600;
          if (n) {
            ax += (avx / n - b.vx) * 1.6 + (cx / n - b.x) * 2;
            ay += (avy / n - b.vy) * 1.6 + (cy / n - b.y) * 2;
          }
          if (scatter > 0) { ax *= 1 - scatter; ay *= 1 - scatter; }
          b.vx += ax * dt;
          b.vy += ay * dt;
          const damping = calm > 0 ? 1 - calm * 0.12 : 0.985;
          b.vx *= damping;
          b.vy *= damping;
          const sp = Math.hypot(b.vx, b.vy);
          if (sp > maxSp) { b.vx *= maxSp / sp; b.vy *= maxSp / sp; }
          if (reduced) { b.x = gx; b.y = gy; b.vx = b.vy = 0; }
          else { b.x += b.vx * dt; b.y += b.vy * dt; }
          energy += Math.abs(b.vx) + Math.abs(b.vy);
        }

        // Birds: a 5-px pixel chevron facing their heading, flapping by speed.
        const ink = s.surface === "orange" ? WHITE : CHAR;
        const key = s.surface === "orange" ? CHAR : WHITE;
        for (const b of B) {
          const sp = Math.hypot(b.vx, b.vy);
          const a = sp > 5 ? Math.atan2(b.vy, b.vx) : -Math.PI / 2;
          const flap = calm >= 1 ? 0 : Math.sin(t * (8 + sp / 40) + b.ph) > 0 ? 1 : 0;
          ctx.save();
          ctx.translate(Math.round(b.x), Math.round(b.y));
          ctx.rotate(Math.round(a / (Math.PI / 4)) * (Math.PI / 4));
          ctx.scale(1.4, 1.4);
          // keyline then body
          ctx.fillStyle = key;
          ctx.fillRect(-2, -3 - flap, 3, 2);
          ctx.fillRect(-2, 1 + flap, 3, 2);
          ctx.fillRect(-1, -2, 5, 4);
          ctx.fillStyle = ink;
          ctx.fillRect(-1, -2 - flap, 2, 1);
          ctx.fillRect(-1, 1 + flap, 2, 1);
          ctx.fillRect(0, -1, 3, 2);
          ctx.restore();
        }
        hotspot(ctx, s.x, s.y, 4);
        return !reduced && (energy / NB > 4 || scatter > 0 || calm < 1);
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
