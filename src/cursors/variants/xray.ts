import { CHAR, WHITE, hotspot, layerCanvas, spring, type CursorInfo } from "../kit";

/**
 * 20 · X-ray iris. The hero's pixel iris (a cell staircase, 15 cells per
 * radius, with a sparse dithered half-cell rim; see hero/heroWipe.ts) used as
 * a lens onto the page's skeleton: inside it the page turns to x-ray film and
 * every element under it shows as its box outline with its tag, text as line
 * bars. Over an element the iris opens just wide enough to frame its real box
 * and labels it with its size; holding the button reveals its padding and
 * margin bands. Speed narrows the iris, idle closes it to a pinhole.
 */
const CELLS = 15;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const xray: CursorInfo = {
  id: 20,
  name: "X-ray iris",
  family: "field",
  blurb:
    "The hero's pixel-staircase iris as an x-ray lens: inside it the page shows its skeleton (element boxes, tags, text lines); it opens to frame the element you hover with its size, holding reveals padding and margin, speed narrows it and idle closes it.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const r = { x: 40, v: 0 };
    let els: Element[] = [];
    let elsAt = -1;
    const textRange = document.createRange();

    const refresh = (t: number) => {
      if (t - elsAt < 2 && elsAt >= 0) return;
      elsAt = t;
      els = Array.from(env.scope.querySelectorAll("*")).filter((e) => !env.layer.contains(e) && e !== env.layer && !(e instanceof HTMLBRElement)).slice(0, 700);
    };
    const staircase = (ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number) => {
      const c = R / CELLS;
      ctx.beginPath();
      for (let j = -CELLS; j < CELLS; j++) {
        const dy = (j < 0 ? -j - 0.5 : j + 0.5) * c;
        if (dy >= R) continue;
        const half = Math.round(Math.sqrt(R * R - dy * dy) / c) * c;
        if (half > 0) ctx.rect(cx - half, cy + j * c, half * 2, c + 0.4);
      }
    };

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        refresh(s.t);
        const L = env.layer.getBoundingClientRect();
        const b = s.hover.box;
        // Radius: frame the hovered element, narrow with speed, pinhole idle.
        let target = 40 - Math.min(14, s.speed / 120);
        if (b) {
          const far = Math.max(
            Math.hypot(b.x - s.x, b.y - s.y), Math.hypot(b.x + b.w - s.x, b.y - s.y),
            Math.hypot(b.x - s.x, b.y + b.h - s.y), Math.hypot(b.x + b.w - s.x, b.y + b.h - s.y),
          );
          target = Math.min(s.hover.kind === "click" ? 240 : 84, far + 14);
        }
        if (s.idle > 2 && !b) target = 12;
        if (s.down) target *= b ? 1.08 : 0.6;
        let busy = spring(r, target, s.dt, reduced ? 2000 : 210, 0.62);
        const R = Math.max(6, r.x);
        const cx = s.x, cy = s.y;

        // Film.
        ctx.save();
        staircase(ctx, cx, cy, R);
        ctx.clip();
        ctx.fillStyle = "rgba(27,27,31,0.92)";
        ctx.fillRect(cx - R - 2, cy - R - 2, R * 2 + 4, R * 2 + 4);
        // graph-paper dots, fixed to the page, so even empty film reads
        ctx.fillStyle = "rgba(255,79,0,0.28)";
        for (let gy = Math.floor((cy - R) / 8) * 8; gy < cy + R; gy += 8)
          for (let gx = Math.floor((cx - R) / 8) * 8; gx < cx + R; gx += 8) ctx.fillRect(gx, gy, 1, 1);
        // Skeleton of whatever intersects the iris.
        ctx.font = "11px VT323, monospace";
        ctx.textBaseline = "top";
        ctx.lineWidth = 1;
        for (const e of els) {
          const rc = e.getBoundingClientRect();
          const x = rc.left - L.left, y = rc.top - L.top;
          if (rc.width < 2 || rc.height < 2 || x > cx + R || x + rc.width < cx - R || y > cy + R || y + rc.height < cy - R) continue;
          const hovered = e === s.hover.el;
          ctx.strokeStyle = hovered ? WHITE : "rgba(255,79,0,0.75)";
          ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(rc.width) - 1, Math.round(rc.height) - 1);
          if (rc.width > 28 && rc.height > 12) {
            ctx.fillStyle = hovered ? WHITE : "rgba(255,180,137,0.9)";
            ctx.fillText(e.tagName.toLowerCase(), Math.round(x) + 3, Math.round(y) + 2);
          }
          // text as line bars
          for (const n of Array.from(e.childNodes)) {
            if (n.nodeType !== 3 || !n.textContent?.trim()) continue;
            textRange.selectNodeContents(n);
            for (const lr of Array.from(textRange.getClientRects())) {
              const lx = lr.left - L.left, ly = lr.top - L.top;
              if (ly > cy + R || ly + lr.height < cy - R) continue;
              ctx.fillStyle = "rgba(255,180,137,0.45)";
              ctx.fillRect(Math.round(lx), Math.round(ly + lr.height * 0.32), Math.round(lr.width), Math.max(2, Math.round(lr.height * 0.36)));
            }
          }
        }
        // Box model of the hovered element while held.
        if (b && s.down && s.hover.el) {
          const cs = getComputedStyle(s.hover.el);
          const n = (v: string) => parseFloat(v) || 0;
          const pt = n(cs.paddingTop), pr = n(cs.paddingRight), pb = n(cs.paddingBottom), pl = n(cs.paddingLeft);
          const mt = n(cs.marginTop), mr = n(cs.marginRight), mb = n(cs.marginBottom), ml = n(cs.marginLeft);
          ctx.fillStyle = "rgba(255,79,0,0.35)";
          ctx.beginPath();
          ctx.rect(b.x - ml, b.y - mt, b.w + ml + mr, b.h + mt + mb);
          ctx.rect(b.x, b.y, b.w, b.h);
          ctx.fill("evenodd");
          ctx.fillStyle = "rgba(255,210,180,0.35)";
          ctx.beginPath();
          ctx.rect(b.x, b.y, b.w, b.h);
          ctx.rect(b.x + pl, b.y + pt, b.w - pl - pr, b.h - pt - pb);
          ctx.fill("evenodd");
        }
        ctx.restore();

        // Size label for the hovered element, just outside the iris.
        if (b) {
          const tag = `${(s.hover.el?.tagName || "").toLowerCase()} ${Math.round(b.w)}×${Math.round(b.h)}`;
          ctx.font = "15px VT323, monospace";
          const w = ctx.measureText(tag).width + 8;
          const lx = Math.round(Math.min(s.w - w - 2, cx + R * 0.72)), ly = Math.round(cy + R * 0.72);
          ctx.fillStyle = CHAR;
          ctx.fillRect(lx, ly, w, 16);
          ctx.fillStyle = WHITE;
          ctx.textBaseline = "middle";
          ctx.fillText(tag, lx + 4, ly + 8.5);
        }

        // Dithered rim (two half-cell rings at 4/16 and 1/16, like the hero).
        const hc = R / CELLS / 2;
        const rim = s.surface === "orange" ? WHITE : CHAR;
        ctx.fillStyle = rim;
        const nCells = Math.ceil((R + hc * 3) / hc);
        for (let gy = -nCells; gy < nCells; gy++)
          for (let gx = -nCells; gx < nCells; gx++) {
            const d = Math.hypot((gx + 0.5) * hc, (gy + 0.5) * hc);
            const ring = Math.floor((d - R) / hc);
            if (ring < 0 || ring > 1) continue;
            if (BAYER[((gy + 64) & 3) * 4 + ((gx + 64) & 3)] < (ring === 0 ? 5 : 2)) ctx.fillRect(cx + gx * hc, cy + gy * hc, Math.max(1, hc), Math.max(1, hc));
          }
        hotspot(ctx, cx, cy, 3);
        if (s.idle < 2.4) busy = true;
        return busy;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
