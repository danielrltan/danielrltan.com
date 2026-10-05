import { CHAR, DEEP, ORANGE, WHITE, hotspot, layerCanvas, spring, type CursorInfo } from "../kit";

/**
 * 6 · Compass. A little compass lying on the page (tilted dial with a case
 * edge, raised two-tone needle with a lit ridge), pivoting on the exact
 * point. The needle seeks the nearest clickable thing on the page: it points
 * at the centre of the closest env.targets() box (corrected for the dial's
 * foreshortening) on an underdamped spring, so it swings and settles like a
 * real needle, with the distance in px beside it. Nothing near? It wanders,
 * lost. On a button it swings north and the bezel ticks; over text the
 * compass turns on edge; press lifts it to face you, release flicks the
 * needle round.
 */
const R = 17;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export const compass: CursorInfo = {
  id: 6,
  name: "Compass",
  family: "3D",
  blurb:
    "A tilted compass on the point whose needle swings, on a real underdamped spring, toward the nearest clickable thing on the page (with its distance); it wanders when lost, swings north and ticks on a button, and flicks on click.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const needle = { x: -Math.PI / 2, v: 0 };
    const tilt = { x: 0.95, v: 0 };
    let tgtAt = -1;
    let nearest: { x: number; y: number; d: number } | null = null;
    let wander = 0;
    let tick = 0;

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        let busy = false;
        // nearest target, refreshed ~8×/s
        if (s.t - tgtAt > 0.12 || s.hoverChanged) {
          tgtAt = s.t;
          nearest = null;
          for (const b of env.targets()) {
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            const d = Math.hypot(cx - s.x, cy - s.y);
            if (d < 700 && (!nearest || d < nearest.d)) nearest = { x: cx, y: cy, d };
          }
        }
        const kind = s.hover.kind;
        const tiltT = kind === "text" || kind === "input" ? 1.45 : s.down ? 0.18 : 0.95;
        busy = spring(tilt, tiltT, dt, 160, 0.6) || busy;
        const cosT = Math.max(0.08, Math.cos(tilt.x));

        let target: number;
        const onButton = kind === "click";
        if (onButton) target = -Math.PI / 2;
        else if (nearest) target = Math.atan2((nearest.y - s.y) / cosT, nearest.x - s.x);
        else {
          if (s.idle < 3 && !reduced) {
            wander += dt * (2.2 + Math.sin(s.t * 1.7) * 1.5);
            busy = true;
          }
          target = wander;
        }
        if (s.released && !reduced) needle.v += 26;
        if (reduced) needle.x = target;
        busy = spring(needle, needle.x + wrap(target - needle.x), dt, 90, 0.16) || busy;
        if (s.hoverChanged && onButton) tick = 1.1;
        if (tick > 0) {
          tick -= dt;
          busy = true;
        }

        const cx = s.x, cy = s.y;
        const orange = s.surface === "orange";
        const ry = R * cosT;
        // case edge (thickness below the dial)
        const edge = Math.sin(tilt.x) * 4;
        ctx.fillStyle = DEEP;
        ctx.beginPath();
        ctx.ellipse(cx, cy + edge, R + 2, ry + 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = CHAR;
        ctx.beginPath();
        ctx.ellipse(cx, cy, R + 2, ry + 2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.82)";
        ctx.beginPath();
        ctx.ellipse(cx, cy, R, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        // bezel ticks (pulse while "ticking")
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
          const major = i % 4 === 0;
          const on = tick > 0 && Math.floor((1.1 - tick) * 16) % 16 === i;
          const r0 = R - (major ? 4 : 2.5);
          const x0 = cx + Math.cos(a) * r0, y0 = cy + Math.sin(a) * r0 * cosT;
          const x1 = cx + Math.cos(a) * (R - 0.8), y1 = cy + Math.sin(a) * (R - 0.8) * cosT;
          ctx.strokeStyle = on ? ORANGE : i === 0 ? ORANGE : CHAR;
          ctx.lineWidth = on ? 2.4 : major ? 1.5 : 1;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
        // needle: diamond with a raised ridge, two shaded halves per end
        const a = needle.x;
        const ux = Math.cos(a), uy = Math.sin(a) * cosT; // along
        const px = -Math.sin(a), py = Math.cos(a) * cosT; // across
        const lift = Math.sin(tilt.x) * 2.2; // ridge sits above the dial
        const tip = [cx + ux * 14, cy + uy * 14], tail = [cx - ux * 10, cy - uy * 10];
        const l = [cx + px * 3.2, cy + py * 3.2], r = [cx - px * 3.2, cy - py * 3.2];
        const mid = [cx, cy - lift];
        const tri = (p: number[], q: number[], w: number[], fill: string) => {
          ctx.beginPath();
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(q[0], q[1]);
          ctx.lineTo(w[0], w[1]);
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
        };
        tri(tip, l, mid, "#ff7a33");
        tri(tip, mid, r, ORANGE);
        tri(tail, l, mid, "#4a4a52");
        tri(tail, mid, r, CHAR);
        ctx.strokeStyle = CHAR;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(tip[0], tip[1]); ctx.lineTo(l[0], l[1]); ctx.lineTo(tail[0], tail[1]); ctx.lineTo(r[0], r[1]); ctx.closePath();
        ctx.stroke();
        // distance chip
        if (nearest && !onButton && kind !== "text" && kind !== "input") {
          const txt = `${Math.round(nearest.d)}`;
          ctx.font = "14px VT323, monospace";
          const w = ctx.measureText(txt).width + 6;
          ctx.fillStyle = orange ? WHITE : CHAR;
          ctx.fillRect(Math.round(cx + R + 6), Math.round(cy - 7), Math.ceil(w), 14);
          ctx.fillStyle = orange ? CHAR : WHITE;
          ctx.textBaseline = "middle";
          ctx.fillText(txt, Math.round(cx + R + 9), Math.round(cy + 0.5));
        }
        hotspot(ctx, cx, cy, 3);
        return busy;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
