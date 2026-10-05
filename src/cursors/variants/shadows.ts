import { CHAR, ORANGE, WHITE, damp, hotspot, layerCanvas, type Box, type CursorInfo } from "../kit";

/**
 * 23 · Light source. The cursor is a lamp held a little above the page, and
 * every button, card and heading in the scope is a slab standing on it, so
 * each casts a hard shadow AWAY from the light: the shadow is the convex hull
 * of the slab's footprint and its top projected from the lamp (similar
 * triangles), with the slab's own area cut out so it reads as underneath.
 * Shadows lengthen as you get close and swing as you move. The hovered button
 * lifts (taller slab, longer shadow); a click drops the lamp low for a beat,
 * stretching every shadow across the page. The lamp itself is a pixel bulb
 * whose rays lengthen with speed.
 */
const LAMP_Z = 150;
const CAST_SEL = 'a[href], button, [role="button"], input, textarea, h1, h2, h3, [data-cast]';

function hull(pts: [number, number][]): [number, number][] {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  up.pop(); lo.pop();
  return lo.concat(up);
}

export const shadows: CursorInfo = {
  id: 23,
  name: "Light source",
  family: "field",
  blurb:
    "The cursor is a lamp: every button, card, field and heading casts a hard shadow away from it (lengthening as you near, swinging as you move), the hovered button lifts higher, and a click drops the lamp to stretch every shadow.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    let lampZ = LAMP_Z;
    let lift = 0;
    let liftEl: Element | null = null;

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        if (s.released && !reduced) lampZ = 60;
        lampZ = damp(lampZ, s.down ? 90 : LAMP_Z, s.down ? 10 : 3.5, dt);
        if (s.hover.el !== liftEl && s.hover.kind === "click") { liftEl = s.hover.el; lift = 0; }
        if (s.hover.kind !== "click") liftEl = null;
        lift = damp(lift, liftEl ? 1 : 0, 8, dt);

        const L = { x: s.x, y: s.y };
        const els = Array.from(env.scope.querySelectorAll(CAST_SEL)).slice(0, 40);
        const lay = env.layer.getBoundingClientRect();
        ctx.fillStyle = "rgba(60,22,4,0.2)";
        for (const el of els) {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.bottom < lay.top - 200 || r.top > lay.bottom + 200) continue;
          const b: Box = { x: r.left - lay.left, y: r.top - lay.top, w: r.width, h: r.height, r: 0 };
          // slab height: headings are low, controls stand taller; hover lifts.
          const isHead = /^H[1-3]$/.test(el.tagName);
          let hgt = isHead ? 7 : 12;
          if (el === liftEl) hgt += 16 * lift;
          const k = hgt / Math.max(10, lampZ - hgt); // similar triangles
          const corners: [number, number][] = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
          const pts: [number, number][] = corners.slice();
          for (const [cx, cy] of corners) pts.push([cx + (cx - L.x) * k, cy + (cy - L.y) * k]);
          const H = hull(pts);
          // shadow minus the slab itself (so it reads as underneath)
          const near = Math.max(0.35, 1 - Math.hypot(b.x + b.w / 2 - L.x, b.y + b.h / 2 - L.y) / 900);
          ctx.globalAlpha = near;
          ctx.beginPath();
          H.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.closePath();
          const rad = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
          ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(rad, b.h / 2, b.w / 2));
          ctx.fill("evenodd");
        }
        ctx.globalAlpha = 1;

        // The lamp: a pixel bulb with rays that lengthen with speed.
        const onOrange = s.surface === "orange";
        const ray = 3 + Math.min(7, s.speed / 250) + (lampZ < 100 ? 4 : 0);
        ctx.fillStyle = onOrange ? WHITE : ORANGE;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          for (let d = 8; d < 8 + ray; d += 2) ctx.fillRect(Math.round(s.x + Math.cos(a) * d - 1), Math.round(s.y + Math.sin(a) * d - 1), 2, 2);
        }
        ctx.fillStyle = CHAR;
        ctx.fillRect(Math.round(s.x - 5), Math.round(s.y - 5), 10, 10);
        ctx.fillStyle = onOrange ? WHITE : "#ffe14d";
        ctx.fillRect(Math.round(s.x - 4), Math.round(s.y - 4), 8, 8);
        hotspot(ctx, s.x, s.y, 2);
        return Math.abs(lampZ - (s.down ? 90 : LAMP_Z)) > 0.5 || (liftEl ? lift < 0.99 : lift > 0.01);
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
