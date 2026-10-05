import { fmtRate } from "../loadStats";
import { clock, el, hostCanvas, irisRadius, pixelIris, rateLevel, textSlot, type VariantInfo } from "./shared";

/**
 * 16 · Ring tunnel. A corridor of 30 pixel rings, one per ~3% of the load,
 * and the camera travels down it as the site loads: rings swell as they near
 * and their squares grow with them (the hero iris's "pixels growing").
 * Rings already passed through light white; the ones ahead wait faint. Each
 * ring is a dashed circle, and the tunnel twists faster with the download
 * rate. At 100 you reach the light at the end, and it opens as the hero's
 * pixel iris.
 */
const RINGS = 30;
const GAP = 0.6;
const DOTS = 52;

export const tunnel: VariantInfo = {
  id: 16,
  name: "Ring tunnel",
  ownsExit: true,
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-tun", host);
    const pct = textSlot(el("div", "ldr-tun__pct", root));
    const rate = textSlot(el("div", "ldr-tun__rate", root));
    const tick = clock();
    let twist = 0;
    let cam = 0;
    let wind = 0.35;
    let t = 0;

    return {
      frame(now, p, n, s, exit) {
        const dt = tick(now);
        t += reduced ? 0 : dt;
        wind += (rateLevel(s.bytesPerSec) - wind) * Math.min(1, dt * 3);
        twist += reduced ? 0 : dt * (0.3 + wind * 2.2);
        const P = n >= 100 ? 1 : p;
        const e = Math.min(1, exit);
        // Camera z: ring k sits at z = k * GAP; we glide to the last one.
        const target = P * (RINGS - 1) * GAP + e * 2;
        cam += (target - cam) * Math.min(1, dt * 8);

        const { ctx, box } = cv;
        const { w, h } = box;
        const cx0 = w / 2, cy0 = h * 0.45;
        const f = Math.min(w, h) * 0.34;
        // gentle curve: the far end of the tunnel drifts
        const bend = (z: number) => [Math.sin(z * 0.35 + t * 0.6) * 0.22 * z, Math.cos(z * 0.3 + t * 0.5) * 0.12 * z];

        const endZ = (RINGS - 1) * GAP + 0.6 - cam;
        const [ebx, eby] = bend(Math.max(0, endZ));
        const ex = cx0 + (ebx / Math.max(0.3, endZ)) * f, ey = cy0 + (eby / Math.max(0.3, endZ)) * f;
        if (e > 0) pixelIris(ctx, w, h, ex, ey, irisRadius(e, w, h, ex, ey, f / Math.max(0.3, endZ) * 0.5));
        else {
          ctx.fillStyle = "#ff4f00";
          ctx.fillRect(0, 0, w, h);
          // light at the end of the tunnel
          const lr = (f / Math.max(0.35, endZ)) * 0.5;
          const g = ctx.createRadialGradient(ex, ey, 0, ex, ey, lr * 2.2);
          g.addColorStop(0, `rgba(255,236,220,${(0.25 + 0.6 * P).toFixed(3)})`);
          g.addColorStop(1, "rgba(255,236,220,0)");
          ctx.fillStyle = g;
          ctx.fillRect(ex - lr * 3, ey - lr * 3, lr * 6, lr * 6);
        }
        ctx.globalAlpha = 1 - e;

        // Far to near.
        for (let k = RINGS - 1; k >= 0; k--) {
          const z = k * GAP + 0.6 - cam;
          if (z <= 0.08) continue;
          const [bx, by] = bend(z);
          const r = f / z;
          const ccx = cx0 + (bx / z) * f, ccy = cy0 + (by / z) * f;
          const passed = k <= P * (RINGS - 1) + 1e-6;
          const near = Math.min(1, 1.2 / z);
          const size = Math.max(2, Math.round((r * Math.PI * 2) / DOTS * 0.42));
          const fade = Math.max(0, Math.min(1, (z - 0.12) * 1.8));
          ctx.fillStyle = passed ? "#ffffff" : "rgba(255,214,190,0.5)";
          ctx.globalAlpha = (1 - e) * fade * (passed ? 0.55 + 0.45 * near : 0.6);
          const rot = twist * (k % 2 ? 1 : -1) * 0.5 + k * 0.4;
          for (let i = 0; i < DOTS; i++) {
            // dashed: drop every 4th + one notch per ring so the twist reads
            if (i % 4 === 3 || i === k % DOTS) continue;
            const a = rot + (i / DOTS) * Math.PI * 2;
            const x = ccx + Math.cos(a) * r, y = ccy + Math.sin(a) * r;
            ctx.fillRect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
          }
        }
        ctx.globalAlpha = 1;

        pct(String(n));
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
