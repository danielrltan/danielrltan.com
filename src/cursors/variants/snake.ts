import { CHAR, ORANGE, WHITE, hotspot, layerCanvas, type Box, type CursorInfo } from "../kit";

/**
 * 16 · Snake. Classic Snake on a 6 px grid, with the head as the exact
 * pointer: every cell the pointer crosses becomes a body cell (4-connected,
 * so it only ever turns at right angles), and the body is as long as you are
 * fast, retracting cell by cell when you slow down. Clickables leave food
 * pixels just outside their edges; eat one and the snake grows for good. Over
 * a button its body leaves the path and coils round the button's real outline,
 * crawling. Hold to rattle; release flicks a forked tongue.
 */
const C = 6;
type Cell = { cx: number; cy: number };

/** Clockwise ring of cells one cell outside a box. */
function perimeter(b: Box): Cell[] {
  const x0 = Math.floor(b.x / C) - 1, y0 = Math.floor(b.y / C) - 1;
  const x1 = Math.floor((b.x + b.w) / C) + 1, y1 = Math.floor((b.y + b.h) / C) + 1;
  const out: Cell[] = [];
  for (let x = x0; x < x1; x++) out.push({ cx: x, cy: y0 });
  for (let y = y0; y < y1; y++) out.push({ cx: x1, cy: y });
  for (let x = x1; x > x0; x--) out.push({ cx: x, cy: y1 });
  for (let y = y1; y > y0; y--) out.push({ cx: x0, cy: y });
  return out;
}

export const snake: CursorInfo = {
  id: 16,
  name: "Snake",
  family: "pixel",
  blurb:
    "A pixel snake whose head is the point: as long as you are fast, it eats food pixels left by buttons to grow for good, coils round a button's outline while you hover, rattles when held and flicks its tongue on release.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    let body: Cell[] = [];
    let eaten = 0;
    let trim = 0;
    let crawl = 0;
    let spawnT = 0;
    let tongue = 0;
    let dir = { x: 1, y: 0 };
    const food: Cell[] = [];
    const bursts: { x: number; y: number; t: number }[] = [];
    let ring: Cell[] = [];
    let ringFor: Element | null = null;

    const cellRect = (ctx: CanvasRenderingContext2D, c: Cell, col: string, inset = 0.5) => {
      ctx.fillStyle = col;
      ctx.fillRect(c.cx * C + inset, c.cy * C + inset, C - inset * 2 + 1, C - inset * 2 + 1);
    };

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const hx = Math.floor(s.x / C), hy = Math.floor(s.y / C);
        if (!body.length) body = [{ cx: hx, cy: hy }];
        // Walk the head to the pointer cell, right angles only.
        let { cx, cy } = body[0];
        let steps = 0;
        while ((cx !== hx || cy !== hy) && steps < 400) {
          if (Math.abs(hx - cx) >= Math.abs(hy - cy)) {
            const d = Math.sign(hx - cx);
            cx += d;
            dir = { x: d, y: 0 };
          } else {
            const d = Math.sign(hy - cy);
            cy += d;
            dir = { x: 0, y: d };
          }
          body.unshift({ cx, cy });
          steps++;
        }
        const want = Math.round(6 + eaten * 3 + Math.min(40, s.speed / 35));
        let busy = false;
        if (body.length > want) {
          // retract at ~70 cells / s (all at once under reduced motion)
          trim += reduced ? 999 : s.dt * (70 + (body.length - want) * 5);
          while (trim >= 1 && body.length > want) {
            body.pop();
            trim -= 1;
          }
          busy = body.length > want;
        } else trim = 0;

        // Food near clickables, while you're moving.
        spawnT += s.dt;
        if (s.idle < 0.6 && food.length < 4 && spawnT > 0.9) {
          spawnT = 0;
          const ts = env.targets().filter((b) => b.x + b.w > 0 && b.x < s.w && b.y + b.h > 0 && b.y < s.h);
          if (ts.length) {
            const per = perimeter(ts[Math.floor(Math.random() * ts.length)]);
            const c = per[Math.floor(Math.random() * per.length)];
            food.push({ cx: c.cx, cy: c.cy });
          }
        }
        for (let i = food.length - 1; i >= 0; i--) {
          const f = food[i];
          if (Math.abs(f.cx - hx) <= 1 && Math.abs(f.cy - hy) <= 1) {
            food.splice(i, 1);
            eaten = Math.min(5, eaten + 1);
            bursts.push({ x: f.cx * C + C / 2, y: f.cy * C + C / 2, t: 0 });
          }
        }

        const orange = s.surface === "orange";
        const stripe = orange ? WHITE : ORANGE;

        // Food: orange pixels with a charcoal keyline.
        for (const f of food) {
          ctx.fillStyle = CHAR;
          ctx.fillRect(f.cx * C - 1, f.cy * C - 1, C + 2, C + 2);
          ctx.fillStyle = orange ? WHITE : ORANGE;
          ctx.fillRect(f.cx * C + 1, f.cy * C + 1, C - 2, C - 2);
        }

        // Body: the path, or coiled round the hovered button.
        let cells: Cell[] = body;
        const b = s.hover.kind === "click" ? s.hover.box : null;
        if (b) {
          if (s.hover.el !== ringFor) {
            ringFor = s.hover.el;
            ring = perimeter(b);
          }
          crawl += s.dt * (reduced ? 0 : 26);
          // nearest ring cell to the head, then a neck to it
          let best = 0, bd = 1e9;
          ring.forEach((c, i) => {
            const d = Math.abs(c.cx - hx) + Math.abs(c.cy - hy);
            if (d < bd) {
              bd = d;
              best = i;
            }
          });
          const neck: Cell[] = [{ cx: hx, cy: hy }];
          let nx = hx, ny = hy;
          const tgt = ring[best];
          while ((nx !== tgt.cx || ny !== tgt.cy) && neck.length < 60) {
            if (nx !== tgt.cx) nx += Math.sign(tgt.cx - nx);
            else ny += Math.sign(tgt.cy - ny);
            neck.push({ cx: nx, cy: ny });
          }
          const len = ring.length - 3;
          const start = best + Math.floor(crawl);
          cells = neck.slice();
          for (let i = 0; i < len; i++) cells.push(ring[(start + i) % ring.length]);
          busy = true;
        } else ringFor = null;

        const rattle = s.down && !reduced;
        for (let i = cells.length - 1; i >= 1; i--) {
          const c = cells[i];
          let col = i % 3 === 0 ? stripe : CHAR;
          if (rattle && (i + Math.floor(s.t * 24)) % 2) col = orange ? "#ffd2b4" : "#6b6b73";
          cellRect(ctx, c, col);
        }
        if (rattle) busy = true;

        // Head: a cell with an eye, keyed to the travel direction.
        const head = { cx: hx, cy: hy };
        ctx.fillStyle = CHAR;
        ctx.fillRect(hx * C - 1, hy * C - 1, C + 2, C + 2);
        cellRect(ctx, head, orange ? WHITE : ORANGE, 0);
        // Tongue on release.
        if (s.released && !reduced) tongue = 0.28;
        if (tongue > 0) {
          tongue -= s.dt;
          busy = true;
          const tx = hx + dir.x, ty = hy + dir.y;
          ctx.fillStyle = "#e0002a";
          ctx.fillRect(tx * C + 2, ty * C + 2, 2, 2);
          const fx = tx + dir.x, fy = ty + dir.y;
          ctx.fillRect(fx * C + 2 + dir.y * 3, fy * C + 2 + dir.x * 3, 2, 2);
          ctx.fillRect(fx * C + 2 - dir.y * 3, fy * C + 2 - dir.x * 3, 2, 2);
        }
        // Bursts where food was eaten.
        for (let i = bursts.length - 1; i >= 0; i--) {
          const bu = bursts[i];
          bu.t += s.dt;
          if (bu.t > 0.35) {
            bursts.splice(i, 1);
            continue;
          }
          const r = 4 + bu.t * 40;
          ctx.fillStyle = orange ? WHITE : ORANGE;
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            ctx.fillRect(Math.round(bu.x + Math.cos(a) * r) - 1, Math.round(bu.y + Math.sin(a) * r) - 1, 3, 3);
          }
          busy = true;
        }
        hotspot(ctx, s.x, s.y, 2);
        return busy;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
