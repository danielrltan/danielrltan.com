import { CHAR, DEEP, WHITE, hotspot, layerCanvas, spring, type CursorInfo } from "../kit";

/**
 * 1 · Gimbal reticle. The boot loader's gimbal, shrunk onto the pointer:
 * three nested rings tumble at a speed set by yours. Over something clickable
 * they spring flat into a target and throw hairlines out to the element's
 * real edges (lock-on). Over text they turn edge-on, stacked into an I-beam.
 * Press squeezes them; release fires the loader's iris: a ring flies out and
 * fades. Idle, they settle flat and the loop parks.
 */
type M = number[];
const mul = (a: M, b: M): M => {
  const o = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
const rotY = (a: number): M => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotX = (a: number): M => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const SEG = 40;
const RADII = [21, 15.5, 10];
const nearest = (x: number, base: number, period: number) => base + Math.round((x - base) / period) * period;

export const gimbal: CursorInfo = {
  id: 1,
  name: "Gimbal reticle",
  family: "3D",
  blurb:
    "The loader's gimbal on the pointer: rings tumble at your speed, lock flat with hairlines to a button's edges, turn edge-on into an I-beam over text, and iris out on click.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const ang = [{ x: 0.9, v: 0 }, { x: 2.1, v: 0 }, { x: -1.3, v: 0 }];
    const tilt = { x: -0.32, v: 0 };
    const squeeze = { x: 1, v: 0 };
    const lock = { x: 0, v: 0 }; // 0..1 hairline reach
    const pulses: { r: number; a: number }[] = [];
    const segs: { x0: number; y0: number; x1: number; y1: number; z: number; k: number }[] = [];

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        const mode = s.hover.kind === "click" ? "lock" : s.hover.kind === "text" || s.hover.kind === "input" ? "beam" : s.idle > 1.2 || reduced ? "rest" : "spin";
        let busy = false;
        for (let k = 0; k < 3; k++) {
          if (mode === "spin") {
            ang[k].x += dt * (0.8 + Math.min(14, s.speed / 120)) * (k === 1 ? -1.3 : 1 + k * 0.4);
            ang[k].v = 0;
            busy = true;
          } else {
            const target = mode === "beam" ? (k === 0 ? nearest(ang[k].x, Math.PI / 2, Math.PI) : nearest(ang[k].x, 0, Math.PI)) : nearest(ang[k].x, 0, Math.PI);
            busy = spring(ang[k], target, dt, 260, 0.55) || busy;
          }
        }
        busy = spring(tilt, mode === "beam" ? 0 : -0.32, dt, 200, 0.7) || busy;
        busy = spring(squeeze, s.down ? 0.72 : 1, dt, 500, s.down ? 0.9 : 0.35) || busy;
        busy = spring(lock, mode === "lock" && s.hover.box ? 1 : 0, dt, 260, 0.8) || busy;
        if (s.released && !reduced) pulses.push({ r: RADII[0], a: 1 });

        const orange = s.surface === "orange";
        const ink = orange ? WHITE : CHAR;
        const line = orange ? DEEP : WHITE;
        const cx = s.x, cy = s.y;

        // Lock-on hairlines to the hovered element's edges.
        if (lock.x > 0.01 && s.hover.box) {
          const b = s.hover.box;
          ctx.strokeStyle = ink;
          ctx.globalAlpha = lock.x;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          const reach = (from: number, to: number) => from + (to - from) * lock.x;
          ctx.beginPath();
          ctx.moveTo(cx - RADII[0], cy); ctx.lineTo(reach(cx - RADII[0], b.x), cy);
          ctx.moveTo(cx + RADII[0], cy); ctx.lineTo(reach(cx + RADII[0], b.x + b.w), cy);
          ctx.moveTo(cx, cy - RADII[0]); ctx.lineTo(cx, reach(cy - RADII[0], b.y));
          ctx.moveTo(cx, cy + RADII[0]); ctx.lineTo(cx, reach(cy + RADII[0], b.y + b.h));
          ctx.stroke();
          ctx.setLineDash([]);
          // edge ticks
          ctx.fillStyle = ink;
          const t = 3;
          ctx.fillRect(b.x - 1, cy - t, 2, t * 2);
          ctx.fillRect(b.x + b.w - 1, cy - t, 2, t * 2);
          ctx.fillRect(cx - t, b.y - 1, t * 2, 2);
          ctx.fillRect(cx - t, b.y + b.h - 1, t * 2, 2);
          ctx.globalAlpha = 1;
        }

        // Rings, depth-sorted across all three (tubes: outline, then core).
        const T = rotX(tilt.x);
        const m0 = mul(T, rotY(ang[0].x));
        const m1 = mul(m0, rotX(ang[1].x));
        const Ms = [m0, m1, mul(m1, rotY(ang[2].x))];
        let n = 0;
        for (let k = 0; k < 3; k++) {
          const Mk = Ms[k];
          const r = RADII[k] * squeeze.x;
          let px = 0, py = 0, pz = 0;
          for (let i = 0; i <= SEG; i++) {
            const a = (i / SEG) * Math.PI * 2;
            const lx = Math.cos(a) * r, ly = Math.sin(a) * r;
            const x = Mk[0] * lx + Mk[1] * ly, y = Mk[3] * lx + Mk[4] * ly, z = Mk[6] * lx + Mk[7] * ly;
            const kz = 80 / (80 + z);
            const sx = cx + x * kz, sy = cy - y * kz;
            if (i) {
              const sg = segs[n] ?? (segs[n] = { x0: 0, y0: 0, x1: 0, y1: 0, z: 0, k: 0 });
              sg.x0 = px; sg.y0 = py; sg.x1 = sx; sg.y1 = sy; sg.z = (pz + z) / 2; sg.k = k;
              n++;
            }
            px = sx; py = sy; pz = z;
          }
        }
        const live = segs.slice(0, n).sort((a, b) => b.z - a.z);
        for (const sg of live) {
          const front = sg.z < 0 || mode !== "spin";
          const wd = 2.6 - sg.k * 0.3;
          ctx.lineCap = "butt";
          ctx.strokeStyle = line;
          ctx.lineWidth = wd + 2;
          ctx.beginPath();
          ctx.moveTo(sg.x0, sg.y0);
          ctx.lineTo(sg.x1, sg.y1);
          ctx.stroke();
          ctx.lineCap = "round";
          ctx.strokeStyle = front ? ink : orange ? "#ffd2b4" : "#6b6b73";
          ctx.lineWidth = wd;
          ctx.stroke();
        }

        // Click iris pulses.
        for (let i = pulses.length - 1; i >= 0; i--) {
          const p = pulses[i];
          p.r += dt * 260;
          p.a -= dt * 3.2;
          if (p.a <= 0) {
            pulses.splice(i, 1);
            continue;
          }
          ctx.globalAlpha = p.a;
          ctx.strokeStyle = ink;
          ctx.lineWidth = 2.5 * p.a + 0.5;
          ctx.beginPath();
          ctx.arc(cx, cy, p.r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
          busy = true;
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
