import { CHAR, ORANGE, WHITE, hotspot, layerCanvas, spring, type Box, type CursorInfo } from "../kit";

/**
 * 8 · Orbit. The point is a planet; a small moon rides a tilted 3D orbit
 * round it (perspective, passes behind the planet, dotted path brighter on
 * the near side, short fading trail). Speed widens the orbit and quickens the
 * moon. Over a button the orbit morphs, by blending each orbit point toward
 * the matching point on the button's padded rounded-rect outline (tilted a
 * touch into the page), so the moon laps the button itself. Over text the
 * orbit swings edge-on; press pulls the moon in tight and fast; release
 * slingshots it wide. Idle, it slows to a stop on the near side and parks.
 */

/** Point at arc-length fraction u (0..1) round a rounded rect, centred. */
function rrectPoint(b: Box, pad: number, u: number): [number, number] {
  const w = b.w + pad * 2, h = b.h + pad * 2;
  const r = Math.min(b.r + pad, w / 2, h / 2);
  const sw = w - 2 * r, sh = h - 2 * r, arc = (Math.PI / 2) * r;
  const L = 2 * sw + 2 * sh + 4 * arc;
  let d = (((u % 1) + 1) % 1) * L;
  const x0 = -w / 2, y0 = -h / 2;
  // start at the middle of the bottom edge, go clockwise (matches the circle)
  d = (d + sw * 1.5 + sh + arc * 2) % L;
  const segs: [number, (t: number) => [number, number]][] = [
    [sw, (t) => [x0 + r + t, y0]],
    [arc, (t) => { const a = -Math.PI / 2 + t / r; return [x0 + w - r + Math.cos(a) * r, y0 + r + Math.sin(a) * r]; }],
    [sh, (t) => [x0 + w, y0 + r + t]],
    [arc, (t) => { const a = t / r; return [x0 + w - r + Math.cos(a) * r, y0 + h - r + Math.sin(a) * r]; }],
    [sw, (t) => [x0 + w - r - t, y0 + h]],
    [arc, (t) => { const a = Math.PI / 2 + t / r; return [x0 + r + Math.cos(a) * r, y0 + h - r + Math.sin(a) * r]; }],
    [sh, (t) => [x0, y0 + h - r - t]],
    [arc, (t) => { const a = Math.PI + t / r; return [x0 + r + Math.cos(a) * r, y0 + r + Math.sin(a) * r]; }],
  ];
  for (const [len, f] of segs) {
    if (d <= len) return f(d);
    d -= len;
  }
  return [x0, y0];
}

export const orbit: CursorInfo = {
  id: 8,
  name: "Orbit",
  family: "3D",
  blurb:
    "A moon on a tilted 3D orbit round the point (it passes behind the planet); speed widens the orbit, over a button the orbit morphs to lap the button's own outline, press pulls it tight and release slingshots it wide.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    let u = 0.15;
    const rad = { x: 16, v: 0 };
    const morph = { x: 0, v: 0 };
    const yaw = { x: 0, v: 0 };
    let lastBox: Box | null = null;
    let omega = 1;
    const trail: [number, number][] = [];

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        let busy = false;
        const kind = s.hover.kind;
        if (kind === "click" && s.hover.box) lastBox = s.hover.box;
        busy = spring(morph, kind === "click" && s.hover.box ? 1 : 0, dt, 140, 0.8) || busy;
        if (s.released && !reduced) rad.v += 520;
        const rT = s.down ? 8 : 15 + Math.min(30, s.speed / 40);
        busy = spring(rad, rT, dt, 120, 0.42) || busy;
        busy = spring(yaw, kind === "text" || kind === "input" ? 1.42 : 0, dt, 160, 0.7) || busy;

        // angular speed: faster when moving / pressed; winds down when idle
        const wT = reduced ? 0 : s.idle > 3 && !s.down ? 0 : (s.down ? 7 : 2.4) + Math.min(6, s.speed / 300);
        omega += (wT - omega) * Math.min(1, dt * (wT < omega ? 1.2 : 6));
        if (omega > 0.02) busy = true;
        // on a button: constant linear speed round the outline
        const perim = lastBox ? 2 * (lastBox.w + lastBox.h) + 28 : 1;
        const du = morph.x > 0.5 && lastBox ? (220 / perim) * Math.min(1, omega / 2.4) : omega / (Math.PI * 2);
        u = (u + du * dt) % 1;

        const tilt = 1.12, roll = -0.32;
        const cyw = Math.cos(yaw.x), syw = Math.sin(yaw.x);
        const ct = Math.cos(tilt), st = Math.sin(tilt), cr = Math.cos(roll), sr = Math.sin(roll);
        const F = 240;
        const point = (q: number): [number, number, number] => {
          const a = q * Math.PI * 2 + Math.PI / 2;
          // circle in its plane, tilted (Rx), rolled (Rz), yawed (Ry for text)
          let x = Math.cos(a) * rad.x, y = Math.sin(a) * rad.x, z = 0;
          [y, z] = [y * ct - z * st, y * st + z * ct];
          [x, y] = [x * cr - y * sr, x * sr + y * cr];
          [x, z] = [x * cyw + z * syw, -x * syw + z * cyw];
          let ox = s.x, oy = s.y;
          if (morph.x > 0.001 && lastBox) {
            const b = lastBox;
            const [bx, by] = rrectPoint(b, 7, q);
            const bt = 0.3; // a touch of tilt so it stays 3D
            const bz = -by * Math.sin(bt);
            const m = morph.x;
            const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
            ox = s.x + (bcx - s.x) * m;
            oy = s.y + (bcy - s.y) * m;
            x = x + (bx - x) * m;
            y = y + (by * Math.cos(bt) - y) * m;
            z = z + (bz - z) * m;
          }
          const k = F / (F - z);
          return [ox + x * k, oy + y * k, z];
        };
        const orange = s.surface === "orange";
        const ink = CHAR; // the path can cross white and orange at once
        // path dots
        const N = 56;
        const pts = Array.from({ length: N }, (_, i) => point(i / N));
        const drawDots = (front: boolean) => {
          for (const p of pts) {
            if (front !== p[2] >= 0) continue;
            ctx.globalAlpha = front ? 0.9 : 0.35;
            ctx.fillStyle = ink;
            const sz = front ? 2 : 1.5;
            ctx.fillRect(Math.round(p[0] - sz / 2), Math.round(p[1] - sz / 2), sz, sz);
          }
          ctx.globalAlpha = 1;
        };
        const m = point(u);
        trail.unshift([m[0], m[1]]);
        if (trail.length > 7) trail.pop();
        const drawMoon = () => {
          for (let i = trail.length - 1; i > 0; i--) {
            ctx.globalAlpha = (1 - i / trail.length) * 0.5;
            ctx.fillStyle = orange ? WHITE : ORANGE;
            ctx.fillRect(Math.round(trail[i][0] - 1.5), Math.round(trail[i][1] - 1.5), 3, 3);
          }
          ctx.globalAlpha = 1;
          const k = F / (F - m[2]);
          const r = 4.2 * k;
          ctx.beginPath();
          ctx.arc(m[0], m[1], r + 1.5, 0, Math.PI * 2);
          ctx.fillStyle = CHAR;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(m[0], m[1], r, 0, Math.PI * 2);
          ctx.fillStyle = WHITE;
          ctx.fill();
          // terminator: shade the side away from the planet
          ctx.beginPath();
          ctx.arc(m[0], m[1], r, 0, Math.PI * 2);
          ctx.save();
          ctx.clip();
          ctx.fillStyle = "rgba(27,27,31,0.28)";
          const ang = Math.atan2(m[1] - s.y, m[0] - s.x);
          ctx.beginPath();
          ctx.arc(m[0] + Math.cos(ang) * r * 0.9, m[1] + Math.sin(ang) * r * 0.9, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        };
        drawDots(false);
        if (m[2] < 0) drawMoon();
        // planet: the click point, with a ring of keyline
        ctx.beginPath();
        ctx.arc(s.x, s.y, 6.2, 0, Math.PI * 2);
        ctx.fillStyle = WHITE;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = orange ? CHAR : ORANGE;
        ctx.fill();
        hotspot(ctx, s.x, s.y, 2);
        drawDots(true);
        if (m[2] >= 0) drawMoon();
        return busy || trail.some((p) => Math.abs(p[0] - m[0]) + Math.abs(p[1] - m[1]) > 0.5);
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
