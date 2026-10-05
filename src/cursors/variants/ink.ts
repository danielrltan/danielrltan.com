import { CHAR, damp, hotspot, layerCanvas, type Box, type CursorInfo } from "../kit";

/**
 * 14 · Ink drop. A pixel metaball of ink: the field Σ r²/d² of a head (on
 * the point), a chain of lagging tail beads and any loose droplets is
 * thresholded on a 3 px grid, so the drop stretches into a tail with speed and
 * pinches back round when you stop. Flicks shed droplets that coast, then
 * crawl back and merge. Holding the button pools the drop; over a button the
 * ink wicks round its real outline from where you entered.
 */
const CELL = 3;
const TAIL = 4;

export const ink: CursorInfo = {
  id: 14,
  name: "Ink drop",
  family: "physics",
  blurb:
    "A pixel metaball of ink that stretches into a tail with speed, sheds droplets on flicks that crawl back and merge, pools while you hold the button, and wicks round a button's real outline.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const tail = Array.from({ length: TAIL }, () => ({ x: 0, y: 0 }));
    const drops: { x: number; y: number; vx: number; vy: number; r: number }[] = [];
    let init = false;
    let pool = 0;
    let wick = 0;
    let wickFrom = { x: 0, y: 0 };
    let wickBox: Box | null = null;
    let lastShed = 0;
    let t = 0;

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        t += dt;
        if (!init) {
          init = true;
          for (const b of tail) { b.x = s.x; b.y = s.y; }
        }
        // Tail: each bead chases the one before it.
        let prev = { x: s.x, y: s.y };
        let stretch = 0;
        for (let i = 0; i < TAIL; i++) {
          const b = tail[i];
          const rate = reduced ? 60 : 26 - i * 4;
          b.x = damp(b.x, prev.x, rate, dt);
          b.y = damp(b.y, prev.y, rate, dt);
          stretch += Math.hypot(b.x - prev.x, b.y - prev.y);
          prev = b;
        }
        // Shed droplets on flicks.
        if (!reduced && s.speed > 1500 && t - lastShed > 0.05 && drops.length < 10) {
          lastShed = t;
          drops.push({ x: tail[TAIL - 1].x, y: tail[TAIL - 1].y, vx: -s.vx * 0.25 + (Math.random() - 0.5) * 200, vy: -s.vy * 0.25 + (Math.random() - 0.5) * 200, r: 3 + Math.random() * 2.5 });
        }
        if (s.released && !reduced) {
          for (let k = 0; k < 5; k++) {
            const a = (k / 5) * Math.PI * 2 + t;
            drops.push({ x: s.x, y: s.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, r: 2.6 + (k % 2) });
          }
        }
        for (let i = drops.length - 1; i >= 0; i--) {
          const d = drops[i];
          const dx = s.x - d.x, dy = s.y - d.y;
          const dist = Math.hypot(dx, dy) || 1;
          // coast, then crawl home
          d.vx = damp(d.vx, (dx / dist) * Math.min(220, dist * 4), 3, dt);
          d.vy = damp(d.vy, (dy / dist) * Math.min(220, dist * 4), 3, dt);
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          if (dist < 6) drops.splice(i, 1);
        }
        pool = damp(pool, s.down ? Math.min(1, s.held * 1.5) : 0, s.down ? 4 : 9, dt);
        // Wick round the hovered button from the entry point.
        const box = s.hover.kind === "click" ? s.hover.box : null;
        if (box && box !== wickBox && (!wickBox || s.hoverChanged)) {
          wickBox = box;
          wickFrom = { x: s.x, y: s.y };
          wick = 0;
        }
        if (box) wickBox = box;
        wick = damp(wick, box ? 1 : 0, box ? 5 : 10, dt);

        // Field on a grid over the bounds of all balls.
        const balls: [number, number, number][] = [[s.x, s.y, 6 + pool * 9 + Math.min(3, s.speed / 600)]];
        tail.forEach((b, i) => balls.push([b.x, b.y, 5 - i * 0.7]));
        for (const d of drops) balls.push([d.x, d.y, d.r]);
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (const [bx, by, r] of balls) {
          x0 = Math.min(x0, bx - r * 2.2); y0 = Math.min(y0, by - r * 2.2);
          x1 = Math.max(x1, bx + r * 2.2); y1 = Math.max(y1, by + r * 2.2);
        }
        x0 = Math.floor(x0 / CELL) * CELL; y0 = Math.floor(y0 / CELL) * CELL;
        const onOrange = s.surface === "orange";
        const inkCol = CHAR;
        const edge = new Path2D();
        const body = new Path2D();
        for (let y = y0; y < y1; y += CELL)
          for (let x = x0; x < x1; x += CELL) {
            let f = 0;
            for (const [bx, by, r] of balls) {
              const dx = x + CELL / 2 - bx, dy = y + CELL / 2 - by;
              f += (r * r) / (dx * dx + dy * dy + 0.01);
            }
            if (f > 1) body.rect(x, y, CELL, CELL);
            else if (f > 0.72) edge.rect(x, y, CELL, CELL);
          }
        // keyline ring (cells just outside), then the ink
        ctx.fillStyle = onOrange ? "rgba(27,27,31,0.35)" : "rgba(255,255,255,0.9)";
        ctx.fill(edge);
        ctx.fillStyle = inkCol;
        ctx.fill(body);

        // Wicked outline: ink pixels round the button, spreading from entry.
        if (wickBox && wick > 0.02) {
          const b = wickBox;
          const reach = wick * (Math.hypot(b.w, b.h) + 20);
          const path = new Path2D();
          const step = CELL;
          const pts: [number, number][] = [];
          for (let x = b.x - 3; x <= b.x + b.w + 3; x += step) { pts.push([x, b.y - 4]); pts.push([x, b.y + b.h + 1]); }
          for (let y = b.y - 3; y <= b.y + b.h + 3; y += step) { pts.push([b.x - 4, y]); pts.push([b.x + b.w + 1, y]); }
          for (const [x, y] of pts) if (Math.hypot(x - wickFrom.x, y - wickFrom.y) < reach) path.rect(Math.round(x), Math.round(y), CELL, CELL);
          ctx.fillStyle = CHAR;
          ctx.globalAlpha = Math.min(1, wick * 1.4);
          ctx.fill(path);
          ctx.globalAlpha = 1;
        }
        hotspot(ctx, s.x, s.y, 2);
        return stretch > 0.5 || drops.length > 0 || Math.abs(pool - (s.down ? Math.min(1, s.held * 1.5) : 0)) > 0.01 || (box ? wick < 0.99 : wick > 0.02) || s.down;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
