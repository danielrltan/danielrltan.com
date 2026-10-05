import { CHAR, DEEP, ORANGE, WHITE, hotspot, layerCanvas, spring, type CursorInfo } from "../kit";

/**
 * 19 · Pixel eyes. Two pixel-art eyes perched above and right of the point,
 * drawn cell by cell (sclera, outline, lids, pupil) on a 2 px grid. Pupils
 * ride springs: they look along your velocity, at the centre of the button
 * you hover (pupils dilate), down at the point when you stop, and along the
 * line when you're over text, where the lids narrow to a reading squint.
 * Speed widens them. Press squeezes them shut (> <), release blinks them open,
 * and after a few idle seconds they get sleepy, droop, and the loop parks.
 */
const P = 2; // pixel size
const RX = 6, RY = 5; // eye radii in cells

export const eyes: CursorInfo = {
  id: 19,
  name: "Pixel eyes",
  family: "pixel",
  blurb:
    "Two pixel eyes beside the point that look where you're going, stare at the button you hover with dilated pupils, squint along text, widen at speed, squeeze shut while pressed, blink on release and doze off when idle.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const lid = { x: 1, v: 0 };
    const px = { x: 0, v: 0 }, py = { x: 0, v: 0 };
    const wide = { x: 1, v: 0 };
    let blinkT = 0;

    const drawEye = (ctx: CanvasRenderingContext2D, cx: number, cy: number, open: number, lidCol: string, pupX: number, pupY: number, dil: boolean, ry: number) => {
      const ox = Math.round(cx / P) * P, oy = Math.round(cy / P) * P;
      const inside = (i: number, j: number) => (i * i) / (RX * RX) + (j * j) / (ry * ry) <= 1;
      for (let j = -Math.ceil(ry); j <= Math.ceil(ry); j++)
        for (let i = -RX; i <= RX; i++) {
          if (!inside(i, j)) continue;
          const edge = !inside(i + 1, j) || !inside(i - 1, j) || !inside(i, j + 1) || !inside(i, j - 1);
          let col = WHITE;
          if (edge) col = CHAR;
          else if (Math.abs(j) > ry * open - 0.5) col = lidCol;
          ctx.fillStyle = col;
          ctx.fillRect(ox + i * P, oy + j * P, P, P);
        }
      if (open > 0.15) {
        const s = dil ? 4 : 3;
        const bx = Math.round(pupX), by = Math.round(Math.max(-ry * open + s / 2, Math.min(ry * open - s / 2, pupY)));
        for (let j = 0; j < s; j++)
          for (let i = 0; i < s; i++) {
            const ci = bx + i - Math.floor(s / 2), cj = by + j - Math.floor(s / 2);
            if (inside(ci, cj) && Math.abs(cj) <= ry * open) {
              ctx.fillStyle = CHAR;
              ctx.fillRect(ox + ci * P, oy + cj * P, P, P);
            }
          }
        // catchlight
        ctx.fillStyle = WHITE;
        ctx.fillRect(ox + (bx - 1) * P, oy + (by - 1) * P, P, P);
      }
    };
    const chevron = (ctx: CanvasRenderingContext2D, cx: number, cy: number, dir: number) => {
      const ox = Math.round(cx / P) * P, oy = Math.round(cy / P) * P;
      ctx.fillStyle = WHITE;
      for (let k = -4; k <= 4; k++) ctx.fillRect(ox + (-dir * (4 - Math.abs(k)) * 1.2 - 1) * P, oy + k * P - P, P * 3, P * 3);
      ctx.fillStyle = CHAR;
      for (let k = -4; k <= 4; k++) ctx.fillRect(ox + -dir * (4 - Math.abs(k)) * 1.2 * P, oy + k * P, P, P);
    };

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        const kind = s.hover.kind;
        const sleepy = s.idle > 3 && !s.down;
        if (s.released) blinkT = 0.16;
        blinkT = Math.max(0, blinkT - dt);
        let lidT = kind === "text" || kind === "input" ? 0.42 : sleepy ? 0.28 : 1;
        if (s.down || blinkT > 0) lidT = 0;
        let busy = spring(lid, lidT, dt, reduced ? 2000 : 520, 0.85);
        busy = spring(wide, sleepy ? 1 : 1 + Math.min(0.35, s.speed / 3500), dt, 200, 0.5) || busy;

        // Where the eyes sit (flip left near the right edge).
        const side = s.x + 60 > s.w ? -1 : 1;
        const e1 = { x: s.x + side * 18, y: s.y - 18 };
        const e2 = { x: s.x + side * 45, y: s.y - 18 };
        const mid = { x: (e1.x + e2.x) / 2, y: e1.y };

        // Gaze target, as a direction in pupil cells.
        let gx = 0, gy = 0;
        const b = s.hover.box;
        if (kind === "click" && b) {
          const dx = b.x + b.w / 2 - mid.x, dy = b.y + b.h / 2 - mid.y;
          const l = Math.hypot(dx, dy) || 1;
          gx = (dx / l) * 3;
          gy = (dy / l) * 2.5;
        } else if (kind === "text" || kind === "input") {
          gx = Math.sin(s.t * 1.6) * 3; // reading along the line
          gy = 1;
        } else if (s.speed > 60) {
          gx = (s.vx / s.speed) * 3;
          gy = (s.vy / s.speed) * 2.5;
        } else {
          // look down at the point
          const dx = s.x - mid.x, dy = s.y - mid.y;
          const l = Math.hypot(dx, dy) || 1;
          gx = (dx / l) * 3;
          gy = (dy / l) * 2.5;
        }
        busy = spring(px, gx, dt, 240, 0.55) || busy;
        busy = spring(py, gy, dt, 240, 0.55) || busy;
        if (kind === "text") busy = true; // reading sweep

        const lidCol = s.surface === "orange" ? DEEP : ORANGE;
        const ry = RY * wide.x;
        if (s.down && s.held > 0.12) {
          chevron(ctx, e1.x, e1.y, -side);
          chevron(ctx, e2.x, e2.y, side);
        } else {
          drawEye(ctx, e1.x, e1.y, lid.x, lidCol, px.x, py.x, kind === "click", ry);
          drawEye(ctx, e2.x, e2.y, lid.x, lidCol, px.x, py.x, kind === "click", ry);
        }
        // sleepy z
        if (sleepy && !reduced) {
          ctx.font = "16px VT323, monospace";
          ctx.fillStyle = s.surface === "orange" ? WHITE : CHAR;
          ctx.fillText("z", e2.x + side * 14, e2.y - 12);
        }
        hotspot(ctx, s.x, s.y, 3);
        // stay awake until the doze has played (the loop would park before it)
        return busy || s.idle < 3.6;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
