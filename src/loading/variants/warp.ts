import { fmtRate } from "../loadStats";
import { el, hostCanvas, textSlot, type VariantInfo } from "./shared";

/**
 * 3 · Warp. A canvas-2D tunnel of square rings and pixel stars flying at the
 * camera (hand-rolled perspective divide, no WebGL). The flight speed IS the
 * download speed: the real network rate maps (log scale, 20 KB/s → 10 MB/s)
 * to how fast you travel, and at 100 it jumps to hyperspace.
 */
const STARS = 180;
const RINGS = 7;

export const warp: VariantInfo = {
  id: 3,
  name: "Warp speed",
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-warp", host);
    const pct = textSlot(el("div", "ldr-warp__pct", root));
    const rate = textSlot(el("div", "ldr-warp__rate", root));

    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const stars = Array.from({ length: STARS }, () => ({
      x: (rnd() * 2 - 1) * 1.6,
      y: (rnd() * 2 - 1) * 1.6,
      z: 0.05 + rnd() * 0.95,
    }));
    const rings = Array.from({ length: RINGS }, (_, i) => ({ z: (i + 1) / RINGS }));
    let v = 0.25;
    let last = performance.now();
    let doneAt = 0;

    return {
      frame(now, _p, n, s) {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const { ctx, box } = cv;
        const { w, h } = box;
        const cx = w / 2;
        const cy = h / 2;
        const f = Math.min(w, h) * 0.42;

        // Network rate → speed. Cached loads cruise; done → hyperspace.
        const bps = s.bytesPerSec;
        const k = bps > 0 ? Math.min(1, Math.max(0, Math.log10(bps / 2e4) / 2.7)) : 0.35;
        let target = 0.3 + 1.2 * k;
        if (n >= 100) {
          if (!doneAt) doneAt = now;
          target = 3.2;
        }
        if (reduced) target = 0;
        v += (target - v) * Math.min(1, dt * 4);

        ctx.clearRect(0, 0, w, h);
        // Rings: square tunnel sections.
        ctx.lineWidth = Math.max(1, f * 0.006);
        for (const r of rings) {
          r.z -= v * dt * 0.5;
          if (r.z < 0.06) r.z += 1;
          const half = (f * 1.1) / r.z;
          const a = Math.pow(1 - r.z, 1.6) * 0.55;
          ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`;
          ctx.strokeRect(Math.round(cx - half) + 0.5, Math.round(cy - half) + 0.5, Math.round(half * 2), Math.round(half * 2));
        }
        // Stars: pixel squares that streak with speed.
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "#fff";
        for (const st of stars) {
          const zPrev = st.z + v * 0.06;
          st.z -= v * dt;
          if (st.z < 0.04) {
            st.z = 1;
            st.x = (rnd() * 2 - 1) * 1.6;
            st.y = (rnd() * 2 - 1) * 1.6;
            continue;
          }
          const sx = cx + (st.x / st.z) * f * 0.5;
          const sy = cy + (st.y / st.z) * f * 0.5;
          if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) {
            st.z = 1;
            continue;
          }
          const near = 1 - st.z;
          const size = Math.max(1, Math.round(near * near * 5));
          ctx.globalAlpha = Math.min(1, near * 1.4);
          if (v > 0.9) {
            const px = cx + (st.x / zPrev) * f * 0.5;
            const py = cy + (st.y / zPrev) * f * 0.5;
            ctx.lineWidth = size;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(sx, sy);
            ctx.stroke();
          }
          ctx.fillRect(Math.round(sx - size / 2), Math.round(sy - size / 2), size, size);
        }
        ctx.globalAlpha = 1;

        pct(String(n));
        rate(fmtRate(bps));
      },
      destroy() {
        cv.destroy();
        root.remove();
      },
    };
  },
};
