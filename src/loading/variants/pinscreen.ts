import { fmtRate } from "../loadStats";
import { clock, el, hostCanvas, rateLevel, spring, textSlot, type VariantInfo } from "./shared";

/**
 * 7 · Pinscreen. The pin-art toy: a bed of square pins seen in perspective,
 * each on its own underdamped spring, pushes up to emboss the count in
 * relief. When a digit changes the old pins drop and the new ones punch up
 * with a little overshoot. A ripple rolls across the resting pins, and its
 * speed is the real download rate.
 */
const COLS = 42;
const ROWS = 15;

export const pinscreen: VariantInfo = {
  id: 7,
  name: "Pinscreen",
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-pin", host);
    const rate = textSlot(el("div", "ldr-pin__rate", root));
    const tick = clock();

    // Glyph mask: the count rasterised at pin resolution.
    const g = document.createElement("canvas");
    g.width = COLS;
    g.height = ROWS;
    const gx = g.getContext("2d", { willReadFrequently: true })!;
    const mask = new Float32Array(COLS * ROWS);
    let maskFor = "";
    const rasterise = (txt: string) => {
      gx.clearRect(0, 0, COLS, ROWS);
      gx.fillStyle = "#fff";
      gx.textBaseline = "middle";
      gx.textAlign = "center";
      let fs = ROWS * 1.55;
      gx.font = `${fs}px VT323, monospace`;
      const w = gx.measureText(txt).width;
      if (w > COLS - 4) {
        fs *= (COLS - 4) / w;
        gx.font = `${fs}px VT323, monospace`;
      }
      gx.fillText(txt, COLS / 2, ROWS / 2 + 0.5);
      const d = gx.getImageData(0, 0, COLS, ROWS).data;
      for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] > 110 ? 1 : 0;
    };

    const pins = Array.from({ length: COLS * ROWS }, () => ({ x: 0, v: 0 }));
    const order = pins.map((_, i) => i);
    const depth = new Float32Array(pins.length);
    let t = 0;
    let wind = 0.35;

    return {
      frame(now, _p, n, s, exit) {
        const dt = tick(now);
        t += dt;
        const txt = `${n}`;
        if (txt !== maskFor) {
          maskFor = txt;
          rasterise(txt);
        }
        wind += (rateLevel(s.bytesPerSec) - wind) * Math.min(1, dt * 3);
        const { ctx, box } = cv;
        const { w, h } = box;

        // Camera: tilted bed, gentle yaw sway.
        const yaw = reduced ? 0.12 : 0.12 + Math.sin(t * 0.5) * 0.1;
        const pitch = 0.92;
        const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const dist = 60;
        // Portrait: let the bed's edges run off-screen so the number stays big.
        const scale = Math.min(w / (COLS * (w < h ? 0.72 : 1.12)), (h * 1.05) / ROWS) * dist;
        const cx = w / 2, cy = h * 0.46;
        const P = (x: number, y: number, z: number): [number, number] => {
          const x1 = x * cyw - z * syw;
          const z1 = x * syw + z * cyw;
          const y2 = y * cp + z1 * sp;
          const z2 = -y * sp + z1 * cp + dist;
          return [cx + (x1 / z2) * scale, cy - (y2 / z2) * scale];
        };

        // Springs. Exit: everything sinks flat, back to front.
        const omega = reduced ? 0 : 2 + wind * 7;
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) {
            const i = r * COLS + c;
            const dx = c - COLS / 2, dz = ROWS / 2 - r; // glyph row 0 = far edge
            const ripple = 0.07 * Math.sin(Math.hypot(dx, dz * 1.6) * 0.55 - t * omega);
            let target = mask[i] ? 2.6 : 0.12 + ripple;
            if (exit > 0 && exit > (ROWS - r) / ROWS * 0.5) target = -0.2;
            spring(pins[i], target, dt, 260, 0.38);
            const x = dx, z = dz;
            depth[i] = x * syw + z * cyw;
          }
        order.sort((a, b) => depth[b] - depth[a]);

        ctx.clearRect(0, 0, w, h);
        ctx.lineJoin = "round";
        const hw = 0.42;
        for (const i of order) {
          const r = (i / COLS) | 0, c = i % COLS;
          const x = c - COLS / 2, z = ROWS / 2 - r;
          const y = Math.max(0, pins[i].x);
          const lift = Math.min(1, y / 2.6);
          // top
          const a = P(x - hw, y, z - hw), b = P(x + hw, y, z - hw), cc = P(x + hw, y, z + hw), d = P(x - hw, y, z + hw);
          if (y > 0.05) {
            // front (-z faces the camera) and the side turned toward it
            const fa = P(x - hw, 0, z - hw), fb = P(x + hw, 0, z - hw);
            ctx.fillStyle = lift > 0.5 ? "#ffb184" : "#e04800";
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(fb[0], fb[1]); ctx.lineTo(fa[0], fa[1]);
            ctx.fill();
            const sx = yaw > 0 ? -hw : hw;
            const s1 = P(x + sx, y, z - hw), s2 = P(x + sx, y, z + hw), s3 = P(x + sx, 0, z + hw), s4 = P(x + sx, 0, z - hw);
            ctx.fillStyle = lift > 0.5 ? "#ff8a4d" : "#c23d00";
            ctx.beginPath();
            ctx.moveTo(s1[0], s1[1]); ctx.lineTo(s2[0], s2[1]); ctx.lineTo(s3[0], s3[1]); ctx.lineTo(s4[0], s4[1]);
            ctx.fill();
          }
          ctx.fillStyle = lift > 0.04 ? `rgb(255,${Math.round(122 + 133 * lift)},${Math.round(64 + 191 * lift)})` : "#ff6a1f";
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(cc[0], cc[1]); ctx.lineTo(d[0], d[1]);
          ctx.fill();
        }
        rate(fmtRate(s.bytesPerSec));
        root.style.opacity = String(1 - Math.min(1, exit * 3));
      },
      destroy() {
        cv.destroy();
        root.remove();
      },
    };
  },
};
