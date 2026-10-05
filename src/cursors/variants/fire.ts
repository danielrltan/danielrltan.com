import { CHAR, hotspot, layerCanvas, type CursorInfo } from "../kit";

/**
 * 15 · Pixel fire. The Doom PSX fire (a cellular automaton: each cell copies
 * the one below it, minus a random decay, nudged sideways) burning up from
 * the point on a small 3 px grid. Speed feeds the base heat, so the flame
 * roars while you move and gutters out when you stop (then the loop parks);
 * the wind of your motion leans it the other way. Palette runs white-hot at
 * the base through orange to charcoal smoke at the tips, so it reads on white
 * and orange. Click flares it with sparks; over a button, embers crawl along
 * the button's real outline.
 */
const W = 26, H = 30, CELL = 3, MAXH = 36;
const PAL: string[] = [];
for (let i = 0; i <= MAXH; i++) {
  const t = i / MAXH;
  // Hue-shifted, not darkened: charcoal embers → deep orange → amber → warm
  // neon yellow → white-hot. It skips the site's own #ff4f00 band so the
  // flame still reads on the orange hero.
  const stops: [number, number[]][] = [
    [0.0, [27, 27, 31]],
    [0.25, [140, 40, 8]],
    [0.45, [214, 66, 0]],
    [0.62, [255, 150, 30]],
    [0.8, [255, 222, 80]],
    [1.0, [255, 255, 255]],
  ];
  let k = 0;
  while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
  const [ta, ca] = stops[k], [tb, cb] = stops[k + 1];
  const f = Math.min(1, Math.max(0, (t - ta) / (tb - ta)));
  PAL.push(`rgb(${Math.round(ca[0] + (cb[0] - ca[0]) * f)},${Math.round(ca[1] + (cb[1] - ca[1]) * f)},${Math.round(ca[2] + (cb[2] - ca[2]) * f)})`);
}

export const fire: CursorInfo = {
  id: 15,
  name: "Pixel fire",
  family: "pixel",
  blurb:
    "The Doom PSX fire automaton burning up from the point: speed is the heat, your motion's wind leans it, it gutters out when you stop, flares into sparks on click, and lays embers along a button's real outline.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const heat = new Uint8Array(W * H);
    let base = 18;
    let acc = 0;
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const sparks: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
    const embers: { u: number; life: number }[] = [];
    let lean = 0;

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        // Base heat from speed; flare while pressed; gutter when idle.
        // A pilot flame always burns (the cursor never vanishes); speed stokes it.
        // After 3 s still it burns down to a static ember so the loop can park.
        const want = reduced || s.idle > 3 ? 0 : s.down ? MAXH : s.idle > 0.4 ? 21 : Math.min(MAXH, 24 + s.speed / 30);
        base += (want - base) * Math.min(1, dt * (want > base ? 10 : 2.5));
        lean += ((-s.vx / 500) - lean) * Math.min(1, dt * 6);
        acc += dt * 45;
        let alive = 0;
        while (acc >= 1) {
          acc -= 1;
          for (let x = 0; x < W; x++) {
            const c = 1 - Math.abs(x - (W - 1) / 2) / 8; // a narrow, tapered base
            heat[(H - 1) * W + x] = c > 0 ? Math.round(base * Math.min(1, c * 1.6) * (0.8 + 0.2 * Math.sin(x * 0.9 + s.t * 11))) : 0;
          }
          for (let y = 0; y < H - 1; y++)
            for (let x = 0; x < W; x++) {
              const src = (y + 1) * W + x;
              const r = Math.floor(rnd() * 3);
              const drift = Math.max(-1, Math.min(1, Math.round((rnd() - 0.5) * 1.4 + lean)));
              const dx = x - r + 1 + drift;
              if (dx < 0 || dx >= W) continue;
              heat[y * W + dx] = Math.max(0, heat[src] - Math.floor(rnd() * 2.1));
            }
        }
        // Draw the grid, its base on the point.
        const ox = Math.round(s.x - (W * CELL) / 2), oy = Math.round(s.y - H * CELL + CELL);
        const paths: Path2D[] = PAL.map(() => new Path2D());
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const h = heat[y * W + x];
            if (h < 9) continue; // no smoke specks: they read as dirt
            alive++;
            paths[h].rect(ox + x * CELL, oy + y * CELL, CELL, CELL);
          }
        for (let i = 9; i <= MAXH; i++) {
          ctx.fillStyle = PAL[i];
          ctx.fill(paths[i]);
        }
        if (alive === 0) {
          // the banked ember: three hot pixels on the point
          ctx.fillStyle = PAL[Math.round(MAXH * 0.8)];
          ctx.fillRect(Math.round(s.x) - 4, Math.round(s.y) - 4, 3, 3);
          ctx.fillRect(Math.round(s.x) + 1, Math.round(s.y) - 4, 3, 3);
          ctx.fillStyle = PAL[Math.round(MAXH * 0.5)];
          ctx.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 7, 3, 3);
        }

        // Sparks on click.
        if (s.released && !reduced)
          for (let k = 0; k < 14; k++) sparks.push({ x: s.x, y: s.y - 6, vx: (rnd() - 0.5) * 260, vy: -160 - rnd() * 260, life: 1 });
        for (let i = sparks.length - 1; i >= 0; i--) {
          const p = sparks[i];
          p.vy += 500 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt * 1.6;
          if (p.life <= 0) { sparks.splice(i, 1); continue; }
          ctx.fillStyle = p.life > 0.6 ? "#ffffff" : p.life > 0.3 ? "#ff4f00" : CHAR;
          ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2);
        }

        // Embers along the hovered button's outline.
        const b = s.hover.kind === "click" ? s.hover.box : null;
        if (b && !reduced && embers.length < 26 && rnd() < dt * 40) embers.push({ u: rnd(), life: 1 });
        if (embers.length) {
          for (let i = embers.length - 1; i >= 0; i--) {
            const e = embers[i];
            e.life -= dt * (b ? 0.9 : 2.5);
            e.u += dt * 0.05;
            if (e.life <= 0 || !b) { if (e.life <= 0 || !b) embers.splice(i, 1); continue; }
            const P = 2 * (b.w + b.h);
            let d = (e.u % 1) * P;
            let ex: number, ey: number;
            if (d < b.w) { ex = b.x + d; ey = b.y - 2; }
            else if ((d -= b.w) < b.h) { ex = b.x + b.w + 1; ey = b.y + d; }
            else if ((d -= b.h) < b.w) { ex = b.x + b.w - d; ey = b.y + b.h + 1; }
            else { d -= b.w; ex = b.x - 2; ey = b.y + b.h - d; }
            const hv = Math.round(e.life * MAXH);
            ctx.fillStyle = PAL[Math.max(2, Math.min(MAXH, hv))];
            ctx.fillRect(Math.round(ex - 1), Math.round(ey - 1), 3, 3);
          }
        }
        // Guttered: a still pilot flame, so the cursor never vanishes.
        if (alive < 6) {
          const pilot = ["..o..", ".ooo.", ".oWo.", "oWWWo", ".ooo."];
          pilot.forEach((row, j) =>
            [...row].forEach((ch, i) => {
              if (ch === ".") return;
              ctx.fillStyle = ch === "W" ? "#ffffff" : s.surface === "orange" ? CHAR : "#ff4f00";
              ctx.fillRect(Math.round(s.x - 5 + i * 2), Math.round(s.y - 13 + j * 2), 2, 2);
            }),
          );
          ctx.fillStyle = CHAR;
          ctx.fillRect(Math.round(s.x - 6), Math.round(s.y - 4), 12, 1);
        }
        hotspot(ctx, s.x, s.y, 4);
        return alive > 0 || base > 0.5 || sparks.length > 0 || embers.length > 0;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
