import { CHAR, ORANGE, WHITE, hotspot, layerCanvas, spring, type CursorInfo } from "../kit";

/**
 * 11 · Hourglass. A pixel hourglass riding beside the point (where an OS
 * busy cursor would sit), with a real falling-sand cellular automaton inside.
 * The sand feels the pointer's ACCELERATION as well as gravity (it's in a
 * moving frame): shake the mouse and it sloshes up the glass and through the
 * neck, hold still and it trickles grain by grain. Press flips the glass;
 * over a button it lies on its side, so time stops. The glass outline is a
 * pixel staircase.
 */
const W = 11, H = 21, CELL = 2;
const NECK = 10;
const valid = new Uint8Array(W * H);
for (let j = 0; j < H; j++) {
  const hw = Math.min(5, Math.floor(Math.abs(j - NECK) * 0.56));
  for (let i = 0; i < W; i++) valid[j * W + i] = Math.abs(i - 5) <= hw ? 1 : 0;
}
const ok = (i: number, j: number) => i >= 0 && j >= 0 && i < W && j < H && valid[j * W + i] === 1;

export const hourglass: CursorInfo = {
  id: 11,
  name: "Hourglass",
  family: "physics",
  blurb:
    "A pixel hourglass beside the point whose falling sand feels your acceleration as well as gravity: shake the mouse and it sloshes, hold still and it trickles; press flips it, and over a button it lies down so time stops.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const sand = new Uint8Array(W * H);
    // Start with the top bulb mostly full.
    let grains = 0;
    for (let j = 1; j < NECK - 1; j++)
      for (let i = 0; i < W; i++) if (valid[j * W + i] && grains < 44) { sand[j * W + i] = 1; grains++; }
    const rot = { x: 0, v: 0 };
    let base = 0; // 0 or π: which way up the glass is
    let acc = 0; // CA step accumulator
    const order = Array.from({ length: W * H }, (_, k) => k);
    let seed = 9;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        if (s.pressed && !reduced) base += Math.PI;
        const lying = s.hover.kind === "click";
        const target = base + (lying ? Math.PI / 2 : 0);
        let busy = reduced ? false : spring(rot, target, s.dt, 140, 0.55);
        if (reduced) rot.x = target;

        // Gravity in the glass's own frame: g minus the frame's acceleration.
        const gx = -s.ax * 0.9, gy = 1400 - s.ay * 0.9;
        const c = Math.cos(-rot.x), sn = Math.sin(-rot.x);
        const lx = gx * c - gy * sn, ly = gx * sn + gy * c;
        const mag = Math.hypot(lx, ly);
        let moved = false;
        if (mag > 200 && !reduced) {
          const dx = Math.round(lx / mag), dy = Math.round(ly / mag);
          acc += s.dt * Math.min(110, 28 + mag / 90);
          // Process grains furthest "downhill" first.
          order.sort((a, b) => ((b % W) * lx + ((b / W) | 0) * ly) - ((a % W) * lx + ((a / W) | 0) * ly));
          while (acc >= 1) {
            acc -= 1;
            for (const k of order) {
              if (!sand[k]) continue;
              const i = k % W, j = (k / W) | 0;
              const tries: [number, number][] = [[dx, dy]];
              // the two 45° alternatives, random order
              const a1: [number, number] = [Math.sign(dx - dy) || dx, Math.sign(dy + dx) || dy];
              const a2: [number, number] = [Math.sign(dx + dy) || dx, Math.sign(dy - dx) || dy];
              if (rnd() < 0.5) tries.push(a1, a2);
              else tries.push(a2, a1);
              for (const [mx, my] of tries) {
                const ni = i + mx, nj = j + my;
                if ((mx || my) && ok(ni, nj) && !sand[nj * W + ni]) {
                  sand[k] = 0;
                  sand[nj * W + ni] = 1;
                  moved = true;
                  break;
                }
              }
            }
          }
        }
        busy = busy || moved;

        // Draw: glass beside the point, rotated about its own centre.
        const hx = s.x + 18, hy = s.y + 20;
        ctx.save();
        ctx.translate(Math.round(hx), Math.round(hy));
        ctx.rotate(rot.x);
        ctx.translate(-(W * CELL) / 2, -(H * CELL) / 2);
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        for (let k = 0; k < W * H; k++) if (valid[k]) ctx.fillRect((k % W) * CELL, ((k / W) | 0) * CELL, CELL, CELL);
        ctx.fillStyle = s.down ? CHAR : ORANGE;
        for (let k = 0; k < W * H; k++) if (sand[k]) ctx.fillRect((k % W) * CELL, ((k / W) | 0) * CELL, CELL, CELL);
        // Pixel-staircase outline.
        ctx.fillStyle = CHAR;
        for (let j = 0; j < H; j++)
          for (let i = 0; i < W; i++) {
            if (!valid[j * W + i]) continue;
            const x = i * CELL, y = j * CELL;
            if (!ok(i - 1, j)) ctx.fillRect(x - 1, y, 1, CELL);
            if (!ok(i + 1, j)) ctx.fillRect(x + CELL, y, 1, CELL);
          }
        // Caps.
        ctx.fillRect(-2, -2, W * CELL + 4, 2);
        ctx.fillRect(-2, H * CELL, W * CELL + 4, 2);
        ctx.fillStyle = WHITE;
        ctx.fillRect(-2, -3, W * CELL + 4, 1);
        ctx.fillRect(-2, H * CELL + 2, W * CELL + 4, 1);
        ctx.restore();

        hotspot(ctx, s.x, s.y, 4);
        return busy;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
