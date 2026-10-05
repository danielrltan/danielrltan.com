import { CHAR, ORANGE, WHITE, hotspot, layerCanvas, type Box, type CursorInfo } from "../kit";

/**
 * 9 · Rope. A short Verlet rope (fixed-length constraints, a few relaxation
 * passes per frame) hangs from the exact pointer with a heavier bob on the end.
 * It swings with every move under real gravity. Over a button the rope
 * collides with the button's actual box, so it drapes over the edge as you
 * hover. A click cracks it like a whip: a transverse wave runs down it and the
 * bob snaps out with a burst of pixels.
 */
const N = 16;
const SEG = 6.5;
const G = 1500;

export const rope: CursorInfo = {
  id: 9,
  name: "Rope",
  family: "physics",
  blurb:
    "A Verlet rope hangs from the point with a weight on the end: it swings with every move, drapes over a button's real edge when you hover, and cracks like a whip on click.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const P = Array.from({ length: N }, () => ({ x: 0, y: 0, ox: 0, oy: 0 }));
    let init = false;
    const sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];

    const collide = (p: { x: number; y: number }, b: Box) => {
      const pad = 2;
      if (p.x < b.x - pad || p.x > b.x + b.w + pad || p.y < b.y - pad || p.y > b.y + b.h + pad) return;
      // push out through the nearest edge
      const dl = p.x - (b.x - pad), dr = b.x + b.w + pad - p.x, dtp = p.y - (b.y - pad), db = b.y + b.h + pad - p.y;
      const m = Math.min(dl, dr, dtp, db);
      if (m === dtp) p.y = b.y - pad;
      else if (m === db) p.y = b.y + b.h + pad;
      else if (m === dl) p.x = b.x - pad;
      else p.x = b.x + b.w + pad;
    };

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        if (!init || reduced) {
          init = true;
          P.forEach((p, i) => {
            p.x = p.ox = s.x;
            p.y = p.oy = s.y + i * SEG;
          });
        }
        const dt = Math.min(s.dt, 1 / 40);
        let motion = 0;
        if (!reduced) {
          // integrate
          for (let i = 1; i < N; i++) {
            const p = P[i];
            const vx = (p.x - p.ox) * 0.985, vy = (p.y - p.oy) * 0.985;
            p.ox = p.x;
            p.oy = p.y;
            p.x += vx;
            p.y += vy + G * dt * dt;
            motion += Math.abs(vx) + Math.abs(vy);
          }
          // whip crack: kick a transverse wave down the rope
          if (s.released) {
            const dirx = P[N - 1].x - P[0].x, diry = P[N - 1].y - P[0].y;
            const l = Math.hypot(dirx, diry) || 1;
            const nx = -diry / l, ny = dirx / l;
            for (let i = 1; i < N; i++) {
              const k = Math.sin((i / N) * Math.PI) * 14 * (i / N);
              P[i].ox -= nx * k;
              P[i].oy -= ny * k;
            }
            P[N - 1].ox -= dirx / l * 18;
            P[N - 1].oy -= diry / l * 18;
            const e = P[N - 1];
            for (let k = 0; k < 10; k++) {
              const a = (k / 10) * Math.PI * 2;
              sparks.push({ x: e.x, y: e.y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, life: 1 });
            }
          }
          // constraints (the bob is heavier: it moves less)
          P[0].x = s.x;
          P[0].y = s.y;
          const box = s.hover.kind === "click" ? s.hover.box : null;
          for (let it = 0; it < 14; it++) {
            for (let i = 0; i < N - 1; i++) {
              const a = P[i], b = P[i + 1];
              const dx = b.x - a.x, dy = b.y - a.y;
              const d = Math.hypot(dx, dy) || 1e-6;
              const diff = (d - SEG) / d;
              const wa = i === 0 ? 0 : i + 1 === N - 1 ? 0.7 : 0.5;
              const wb = 1 - wa;
              a.x += dx * diff * wa; a.y += dy * diff * wa;
              b.x -= dx * diff * wb; b.y -= dy * diff * wb;
            }
            P[0].x = s.x;
            P[0].y = s.y;
            if (box) for (let i = 2; i < N; i++) collide(P[i], box);
          }
        }

        // draw: white keyline under a charcoal cord
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(P[0].x, P[0].y);
        for (let i = 1; i < N; i++) ctx.lineTo(P[i].x, P[i].y);
        ctx.strokeStyle = WHITE;
        ctx.lineWidth = 4.5;
        ctx.stroke();
        ctx.strokeStyle = CHAR;
        ctx.lineWidth = 2;
        ctx.stroke();
        // bob
        const e = P[N - 1];
        const bs = s.down ? 11 : 9;
        ctx.fillStyle = CHAR;
        ctx.fillRect(Math.round(e.x - bs / 2 - 1.5), Math.round(e.y - bs / 2 - 1.5), bs + 3, bs + 3);
        ctx.fillStyle = s.surface === "orange" ? WHITE : ORANGE;
        ctx.fillRect(Math.round(e.x - bs / 2), Math.round(e.y - bs / 2), bs, bs);
        // crack sparks
        for (let i = sparks.length - 1; i >= 0; i--) {
          const sp = sparks[i];
          sp.x += sp.vx * s.dt;
          sp.y += sp.vy * s.dt;
          sp.life -= s.dt * 3;
          if (sp.life <= 0) {
            sparks.splice(i, 1);
            continue;
          }
          ctx.globalAlpha = sp.life;
          ctx.fillStyle = s.surface === "orange" ? WHITE : ORANGE;
          ctx.fillRect(Math.round(sp.x - 1.5), Math.round(sp.y - 1.5), 3, 3);
        }
        ctx.globalAlpha = 1;
        hotspot(ctx, s.x, s.y, 4);
        return motion > 0.4 || sparks.length > 0;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
