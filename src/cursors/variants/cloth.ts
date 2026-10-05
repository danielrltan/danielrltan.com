import { CHAR, ORANGE, WHITE, hotspot, layerCanvas, spring, type CursorInfo } from "../kit";

/**
 * 10 · Flag. A small cloth flag on a pole that IS the pointer (the hotspot is
 * the pole's top). The cloth is a 3D Verlet grid (structural constraints, a
 * few relaxation passes) blown by the air you move through: it streams out
 * behind fast moves and flutters in depth, rests half-out in a light breeze
 * when idle, and every quad is lit by its own normal. Over text it furls
 * round the pole; over a button it's planted and streams straight out; a
 * click cracks it with a snap wave.
 */
const C = 10; // columns (x along the flag)
const R = 7; // rows
const SP = 4.6;

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const shade = (a: number[], b: number[], t: number) =>
  `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;

export const cloth: CursorInfo = {
  id: 10,
  name: "Flag",
  family: "physics",
  blurb:
    "A 3D Verlet cloth flag on a pole that is the pointer: it streams and flutters in the air you move through, rests half-out when idle, furls round the pole over text, plants and streams out over a button, and snaps on click.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const N = C * R;
    const px = new Float32Array(N), py = new Float32Array(N), pz = new Float32Array(N);
    const ox = new Float32Array(N), oy = new Float32Array(N), oz = new Float32Array(N);
    let init = false;
    const furl = { x: 1, v: 0 };
    let t = 0;

    const quads: { i: number; z: number }[] = [];
    for (let j = 0; j < R - 1; j++) for (let i = 0; i < C - 1; i++) quads.push({ i: j * C + i, z: 0 });

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = Math.min(s.dt, 1 / 40);
        t += dt;
        if (!init) {
          init = true;
          for (let j = 0; j < R; j++)
            for (let i = 0; i < C; i++) {
              const k = j * C + i;
              px[k] = ox[k] = s.x + i * SP * 0.5;
              py[k] = oy[k] = s.y + j * SP + i * SP * 0.85;
              pz[k] = oz[k] = 0;
            }
        }
        let busy = spring(furl, s.hover.kind === "text" || s.hover.kind === "input" ? 0.3 : 1, dt, 120, 0.8);
        const rest = SP * furl.x;
        // Air: you move through it, so it blows against your velocity.
        const wx = -s.vx * 0.9, wy = -s.vy * 0.9;
        const gust = Math.min(1, Math.hypot(wx, wy) / 900);
        // Over a button the flag is planted: a stiff breeze streams it out.
        const planted = s.hover.kind === "click";
        let motion = 0;
        if (!reduced) {
          for (let k = 0; k < N; k++) {
            if (k % C === 0) continue;
            const i = k % C, j = (k / C) | 0;
            const vx = (px[k] - ox[k]) * 0.965, vy = (py[k] - oy[k]) * 0.965, vz = (pz[k] - oz[k]) * 0.93;
            ox[k] = px[k]; oy[k] = py[k]; oz[k] = pz[k];
            const flutter = Math.sin(t * (9 + gust * 10) - i * 0.9 + j * 0.5) * (0.25 + gust) * 140;
            // a light standing breeze keeps it half-out even at rest
            px[k] += vx + ((planted ? 1600 : 320) + wx * 4) * dt * dt;
            py[k] += vy + (520 + wy * 4) * dt * dt;
            pz[k] += vz + flutter * dt * dt * (i / C);
            motion += Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
          }
          if (s.released) {
            for (let k = 0; k < N; k++) {
              const i = k % C;
              if (!i) continue;
              oz[k] -= Math.sin(i * 0.9) * 5 * (i / C);
              ox[k] -= 3 * (i / C);
            }
          }
            for (let it = 0; it < 6; it++) {
            for (let j = 0; j < R; j++) {
              const k = j * C;
              px[k] = s.x; py[k] = s.y + j * SP; pz[k] = 0;
            }
            for (let j = 0; j < R; j++)
              for (let i = 0; i < C; i++) {
                const k = j * C + i;
                const link = (m: number, L: number) => {
                  const dx = px[m] - px[k], dy = py[m] - py[k], dz = pz[m] - pz[k];
                  const d = Math.hypot(dx, dy, dz) || 1e-6;
                  const f = (d - L) / d;
                  // the pole column is pinned (infinite mass)
                  const wk = k % C === 0 ? 0 : 1, wm = m % C === 0 ? 0 : 1;
                  const sum = wk + wm;
                  if (!sum) return;
                  px[k] += (dx * f * wk) / sum; py[k] += (dy * f * wk) / sum; pz[k] += (dz * f * wk) / sum;
                  px[m] -= (dx * f * wm) / sum; py[m] -= (dy * f * wm) / sum; pz[m] -= (dz * f * wm) / sum;
                };
                if (i < C - 1) link(k + 1, rest);
                if (j < R - 1) link(k + C, SP);
              }
          }
        } else {
          // reduced: a still flag hanging off the pole
          for (let j = 0; j < R; j++)
            for (let i = 0; i < C; i++) {
              const k = j * C + i;
              px[k] = s.x + i * rest * 0.9;
              py[k] = s.y + j * SP + i * 1.2;
              pz[k] = 0;
            }
        }

        // Cloth: lit per quad by its 3D normal (both faces), back to front.
        const onOrange = s.surface === "orange";
        const base = hex(onOrange ? WHITE : ORANGE);
        const stripe = hex(onOrange ? CHAR : WHITE);
        const dark = hex(onOrange ? "#c9b8ae" : "#8f2a00");
        const sdark = hex(onOrange ? "#000000" : "#d9c9bf");
        for (const q of quads) q.z = (pz[q.i] + pz[q.i + 1] + pz[q.i + C] + pz[q.i + C + 1]) / 4;
        quads.sort((a, b) => a.z - b.z);
        for (const q of quads) {
          const a = q.i, b = a + 1, c = a + C + 1, d = a + C;
          const ux = px[b] - px[a], uy = py[b] - py[a], uz = pz[b] - pz[a];
          const vx = px[d] - px[a], vy = py[d] - py[a], vz = pz[d] - pz[a];
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const l = Math.hypot(nx, ny, nz) || 1;
          nx /= l; ny /= l; nz /= l;
          const lam = Math.abs(nx * -0.35 + ny * -0.45 + nz * 0.82);
          const row = (a / C) | 0;
          const isStripe = row === 2 || row === 3;
          ctx.fillStyle = shade(isStripe ? sdark : dark, isStripe ? stripe : base, 0.35 + 0.65 * lam);
          ctx.beginPath();
          ctx.moveTo(px[a], py[a]); ctx.lineTo(px[b], py[b]); ctx.lineTo(px[c], py[c]); ctx.lineTo(px[d], py[d]);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
        // Silhouette keyline so the cloth reads on any surface.
        ctx.strokeStyle = CHAR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(px[0], py[0]);
        for (let i = 1; i < C; i++) ctx.lineTo(px[i], py[i]);
        for (let j = 1; j < R; j++) ctx.lineTo(px[j * C + C - 1], py[j * C + C - 1]);
        for (let i = C - 2; i >= 0; i--) ctx.lineTo(px[(R - 1) * C + i], py[(R - 1) * C + i]);
        ctx.stroke();
        // Pole.
        const poleLen = (R - 1) * SP + 8;
        ctx.fillStyle = WHITE;
        ctx.fillRect(Math.round(s.x - 2), Math.round(s.y), 4, poleLen + 1);
        ctx.fillStyle = CHAR;
        ctx.fillRect(Math.round(s.x - 1), Math.round(s.y), 2, poleLen);
        hotspot(ctx, s.x, s.y, 4);
        busy = busy || motion > 0.6;
        return busy;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
