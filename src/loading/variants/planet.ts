import { fmtSec } from "../loadStats";
import { el, hostCanvas, textSlot, type VariantInfo } from "./shared";

/**
 * 6 · Ringed planet. A canvas-2D point-cloud sphere (Fibonacci lattice,
 * rotated and perspective-projected per frame) lights up from its south pole
 * as the load climbs, while its tilted ring is the progress bar: the lit arc
 * runs around the planet, passing behind it, with a moon riding the leading
 * edge. The clock under it is real time since navigation start.
 */
const PTS = 460;
const SEGS = 90;

export const planet: VariantInfo = {
  id: 6,
  name: "Ringed planet",
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-pl", host);
    const row = el("div", "ldr-pl__row", root);
    const pct = textSlot(el("span", "ldr-pl__pct", row));
    const time = textSlot(el("span", "ldr-pl__time", row));

    const golden = Math.PI * (3 - Math.sqrt(5));
    const pts = Array.from({ length: PTS }, (_, i) => {
      const y = 1 - (i / (PTS - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const a = golden * i;
      return [Math.cos(a) * r, y, Math.sin(a) * r] as const;
    });
    const t0 = performance.now();
    const tilt = 0.38;
    const ringTilt = 0.3;
    const roll = -0.28;

    return {
      frame(now, p, n, s) {
        const { ctx, box } = cv;
        const { w, h } = box;
        const P = n >= 100 ? 1 : p;
        const t = (now - t0) / 1000;
        const R = Math.min(w, h) * 0.2;
        const cx = w / 2;
        const cy = h * 0.4;
        const dist = 4.2;
        const proj = (x: number, y: number, z: number) => {
          const k = dist / (dist - z);
          return [cx + x * R * k, cy - y * R * k, k] as const;
        };
        ctx.clearRect(0, 0, w, h);

        // Ring point at segment fraction u (0..1), in view space.
        const cr = Math.cos(roll), sr = Math.sin(roll);
        const ringAt = (u: number) => {
          const a = u * Math.PI * 2 + Math.PI * 0.5;
          const rr = 1.75;
          let x = Math.cos(a) * rr, z = Math.sin(a) * rr, y = 0;
          // tilt toward the viewer, then roll
          const y1 = y * Math.cos(ringTilt) - z * Math.sin(ringTilt);
          const z1 = y * Math.sin(ringTilt) + z * Math.cos(ringTilt);
          y = y1; z = z1;
          const x2 = x * cr - y * sr, y2 = x * sr + y * cr;
          return [x2, y2, z] as const;
        };
        const drawRing = (front: boolean) => {
          for (let i = 0; i < SEGS; i++) {
            const u = i / SEGS;
            const [x, y, z] = ringAt(u);
            if (front !== z >= 0) continue;
            const [sx, sy, k] = proj(x, y, z);
            const lit = u < P;
            const sz = Math.max(2, Math.round((lit ? 4 : 2.5) * k * (R / 90)));
            ctx.globalAlpha = lit ? 1 : 0.28;
            ctx.fillRect(Math.round(sx - sz / 2), Math.round(sy - sz / 2), sz, sz);
          }
          // Moon on the leading edge.
          const [mx, my, mz] = ringAt(P);
          if (front === mz >= 0 && P < 1) {
            const [sx, sy, k] = proj(mx, my, mz);
            const r = Math.max(4, R * 0.1 * k);
            ctx.globalAlpha = 1;
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        };

        ctx.fillStyle = "#fff";
        drawRing(false);

        // Planet: rotate about Y, tilt about X; light rises from the south pole.
        const yaw = reduced ? 0.6 : t * 0.55;
        const cyw = Math.cos(yaw), syw = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
        const line = -1 + 2 * P;
        for (let pass = 0; pass < 2; pass++) {
          for (const [px, py, pz] of pts) {
            const x1 = px * cyw + pz * syw;
            const z1 = -px * syw + pz * cyw;
            const y2 = py * ct - z1 * st;
            const z2 = py * st + z1 * ct;
            if ((pass === 0) !== z2 < 0) continue;
            const [sx, sy, k] = proj(x1, y2, z2);
            const lit = py <= line;
            const facing = (z2 + 1) / 2;
            const sz = Math.max(1, Math.round((lit ? 3.2 : 2) * k * (R / 90)));
            ctx.globalAlpha = lit ? 0.45 + 0.55 * facing : 0.16 + 0.2 * facing;
            ctx.fillRect(Math.round(sx - sz / 2), Math.round(sy - sz / 2), sz, sz);
          }
        }
        ctx.globalAlpha = 1;
        drawRing(true);

        pct(String(n));
        time(fmtSec(s.elapsedMs));
      },
      destroy() {
        cv.destroy();
        root.remove();
      },
    };
  },
};
