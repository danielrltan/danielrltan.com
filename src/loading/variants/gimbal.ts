import { fmtRate, fmtSec } from "../loadStats";
import { clock, el, hostCanvas, inCubic, rateLevel, spring, textSlot, type VariantInfo } from "./shared";

/**
 * 10 · Gimbal. Three nested rings (an armillary / gyroscope) tumble on
 * their own axes, each nested in the last, spun at a speed set by the real
 * download rate. At a third, two thirds and 100 a ring locks: it springs
 * square to the camera with a tick. Fully locked they read as one flat
 * target, and the exit is an iris: the rings fly outward and the orange
 * field opens through the middle onto the hero.
 */
const SEG = 120;
const RADII = [1, 0.8, 0.6];
type M = number[]; // 3x3 row-major

const mul = (a: M, b: M): M => {
  const o = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
const rotY = (a: number): M => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotX = (a: number): M => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];

export const gimbal: VariantInfo = {
  id: 10,
  name: "Gimbal iris",
  ownsExit: true,
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-gim", host);
    const pct = textSlot(el("div", "ldr-gim__pct", root));
    const meta = el("div", "ldr-gim__meta", root);
    const time = textSlot(el("span", "", meta));
    const rate = textSlot(el("span", "", meta));
    const tick = clock();
    // Each ring's own angle (spring once locked); outer turns about Y, the
    // middle about X inside it, the inner about Y inside that.
    const ang = [{ x: 0.9, v: 0 }, { x: 2.1, v: 0 }, { x: -1.3, v: 0 }];
    const locked = [false, false, false];
    const flash = [0, 0, 0];
    let wind = 0.35;

    return {
      frame(now, p, n, s, exit) {
        const dt = tick(now);
        wind += (rateLevel(s.bytesPerSec) - wind) * Math.min(1, dt * 3);
        const P = n >= 100 ? 1 : p;
        for (let k = 0; k < 3; k++) {
          const lockAt = (k + 1) / 3;
          if (!locked[k] && (P >= lockAt - 1e-6 || reduced)) {
            locked[k] = true;
            flash[k] = 1;
            ang[k].v *= 0.3;
          }
          if (locked[k]) spring(ang[k], Math.round(ang[k].x / Math.PI) * Math.PI, dt, 220, 0.42);
          else ang[k].x += dt * (0.6 + wind * 4.2) * (k === 1 ? -1.25 : 1 + k * 0.35);
          flash[k] = Math.max(0, flash[k] - dt * 3);
        }
        const tilt = rotX(-0.32);
        const Ms = [mul(tilt, rotY(ang[0].x))];
        Ms.push(mul(Ms[0], rotX(ang[1].x)));
        Ms.push(mul(Ms[1], rotY(ang[2].x)));

        const { ctx, box } = cv;
        const { w, h } = box;
        const R = Math.min(w, h) * 0.3;
        const cx = w / 2, cy = h * 0.45;
        const e = inCubic(Math.min(1, exit));
        const grow = 1 + e * 5;

        ctx.clearRect(0, 0, w, h);
        // The orange field, with the iris hole once the exit starts.
        ctx.fillStyle = "#ff4f00";
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        if (exit > 0) ctx.arc(cx, cy, Math.max(0.1, RADII[2] * R * grow * 0.92 * Math.min(1, exit * 3)), 0, Math.PI * 2);
        ctx.fill("evenodd");

        // Collect segments from all rings, then depth-sort them together so the
        // rings pass through each other correctly.
        const segs: { x0: number; y0: number; x1: number; y1: number; z: number; ring: number; tick: boolean }[] = [];
        for (let k = 0; k < 3; k++) {
          const m = Ms[k];
          const r = RADII[k];
          let prev: number[] | null = null;
          for (let i = 0; i <= SEG; i++) {
            const a = (i / SEG) * Math.PI * 2;
            const lx = Math.cos(a) * r, ly = Math.sin(a) * r;
            const x = m[0] * lx + m[1] * ly, y = m[3] * lx + m[4] * ly, z = m[6] * lx + m[7] * ly;
            const kz = 4 / (4 + z);
            const sx = cx + x * R * kz * grow, sy = cy - y * R * kz * grow;
            if (prev) segs.push({ x0: prev[0], y0: prev[1], x1: sx, y1: sy, z: (prev[2] + z) / 2, ring: k, tick: i % 10 === 0 });
            prev = [sx, sy, z];
          }
        }
        segs.sort((a, b) => b.z - a.z);
        ctx.lineCap = "round";
        for (const sg of segs) {
          const front = sg.z < 0;
          const k = sg.ring;
          const width = R * (0.045 - k * 0.008) * (1 + flash[k] * 0.8) * (0.8 + (1 - sg.z) * 0.25);
          ctx.strokeStyle = locked[k] || front ? "#ffffff" : "rgba(255,190,150,0.55)";
          ctx.globalAlpha = 1 - e;
          ctx.lineWidth = Math.max(1.5, width);
          ctx.beginPath();
          ctx.moveTo(sg.x0, sg.y0);
          ctx.lineTo(sg.x1, sg.y1);
          ctx.stroke();
          if (sg.tick) {
            ctx.fillStyle = "#a82e00";
            const q = Math.max(1.5, width * 0.35);
            ctx.fillRect(sg.x1 - q / 2, sg.y1 - q / 2, q, q);
          }
        }
        ctx.globalAlpha = 1;

        pct(String(n));
        time(fmtSec(s.elapsedMs));
        rate(fmtRate(s.bytesPerSec));
        root.style.opacity = String(1 - Math.min(1, exit * 4));
      },
      destroy() {
        cv.destroy();
        root.remove();
      },
    };
  },
};
