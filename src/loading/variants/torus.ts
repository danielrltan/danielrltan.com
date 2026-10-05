import { fmtSec } from "../loadStats";
import { bayer4, clock, el, hostCanvas, irisRadius, pixelIris, textSlot, type VariantInfo } from "./shared";

/**
 * 13 · Tile torus. The hero ring, in miniature and in its own language: a
 * 3D torus point-sampled into a 10 px cell buffer (nearest depth wins), each
 * cell lit by its normal and drawn as a tile from the hero's density ramp
 * (small square → diagonal → cross → outline box → box+slash → inset →
 * full), over orange contour bands. The ring sweeps closed from a C to a full
 * O as the site loads, then dives: the hero's pixel iris opens from its
 * centre.
 */
const BANDS = ["#c23d00", "#e04800", "#ff4f00", "#ff6a1f", "#ff8a4d"];

export const torus: VariantInfo = {
  id: 13,
  name: "Tile torus",
  ownsExit: true,
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-tor", host);
    const pct = textSlot(el("div", "ldr-tor__pct", root));
    const time = textSlot(el("div", "ldr-tor__time", root));
    const tick = clock();
    let t = 0;
    let cols = 0, rows = 0;
    let depth = new Float32Array(0), lum = new Float32Array(0), band = new Float32Array(0);
    let sweep = 0;

    return {
      frame(now, p, n, s, exit) {
        const dt = tick(now);
        t += reduced ? 0 : dt;
        const { ctx, box } = cv;
        const { w, h } = box;
        const cell = w < 600 ? 8 : 10;
        if (Math.ceil(w / cell) !== cols || Math.ceil(h / cell) !== rows) {
          cols = Math.ceil(w / cell);
          rows = Math.ceil(h / cell);
          depth = new Float32Array(cols * rows);
          lum = new Float32Array(cols * rows);
          band = new Float32Array(cols * rows);
        }
        depth.fill(1e9);
        // The C closes into an O; ease so the gap snaps shut at 100.
        const target = n >= 100 ? 1 : 0.06 + p * 0.9;
        sweep += (target - sweep) * Math.min(1, dt * 10);

        const e = Math.min(1, exit);
        const cx = w / 2, cy = h * 0.46;
        const R = Math.min(w, h) * 0.3 * (1 + e * e * 2.5);
        const tilt = 0.68 + Math.sin(t * 0.6) * 0.07;
        const spin = t * 0.45;
        const ct = Math.cos(tilt), st = Math.sin(tilt);
        const yaw = Math.sin(t * 0.35) * 0.25;
        const cyw = Math.cos(yaw), syw = Math.sin(yaw);
        const L = [-0.45, 0.62, -0.64];

        const minor = 0.36;
        const NU = Math.ceil(240 * sweep) + 2;
        const NV = 70;
        const start = -Math.PI / 2 - spin;
        for (let i = 0; i < NU; i++) {
          const u = start + (i / (NU - 1)) * sweep * Math.PI * 2;
          const cu = Math.cos(u), su = Math.sin(u);
          for (let j = 0; j < NV; j++) {
            const v = (j / NV) * Math.PI * 2;
            const cvv = Math.cos(v), svv = Math.sin(v);
            // torus in its own plane (x, y), thickness along z
            let x = (1 + minor * cvv) * cu, y = (1 + minor * cvv) * su, z = minor * svv;
            let nx = cvv * cu, ny = cvv * su, nz = svv;
            // tilt about X, then a little yaw
            let y2 = y * ct - z * st, z2 = y * st + z * ct;
            y = y2; z = z2;
            let x2 = x * cyw + z * syw;
            z2 = -x * syw + z * cyw;
            x = x2; z = z2;
            y2 = ny * ct - nz * st; z2 = ny * st + nz * ct;
            ny = y2; nz = z2;
            x2 = nx * cyw + nz * syw;
            z2 = -nx * syw + nz * cyw;
            nx = x2; nz = z2;
            const k = 5 / (5 + z);
            const sx = cx + x * R * k, sy = cy - y * R * k;
            const gx = (sx / cell) | 0, gy = (sy / cell) | 0;
            if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) continue;
            const id = gy * cols + gx;
            if (z >= depth[id]) continue;
            depth[id] = z;
            const d = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
            lum[id] = Math.min(1, 0.1 + 0.6 * d + Math.pow(d, 24) * 0.35);
            band[id] = Math.min(BANDS.length - 1, Math.floor((nx * -0.6 + ny * 0.8) * 0.5 * BANDS.length + BANDS.length / 2));
          }
        }

        // Field + iris, then the tiles.
        if (e > 0) pixelIris(ctx, w, h, cx, cy, irisRadius(e, w, h, cx, cy, R * 0.55));
        else {
          ctx.fillStyle = "#ff4f00";
          ctx.fillRect(0, 0, w, h);
        }
        const bandPaths = BANDS.map(() => new Path2D());
        const tiles = new Path2D();
        const faint = new Path2D();
        const q = cell / 5;
        for (let gy = 0; gy < rows; gy++)
          for (let gx = 0; gx < cols; gx++) {
            const id = gy * cols + gx;
            const x = gx * cell, y = gy * cell;
            if (depth[id] > 1e8) {
              // the hero's sparse tile field
              if (e === 0 && bayer4(gx, gy) === 0 && (gx + gy * 3) % 3 === 0) faint.rect(x + 2 * q, y + 2 * q, q, q);
              continue;
            }
            bandPaths[band[id] | 0].rect(x, y, cell, cell);
            const lvl = Math.min(7, Math.floor(lum[id] * 8 + bayer4(gx, gy) / 16 - 0.5));
            switch (lvl) {
              case 1: tiles.rect(x + 2 * q, y + 2 * q, q, q); break;
              case 2: tiles.rect(x + q, y + 3 * q, q, q); tiles.rect(x + 2 * q, y + 2 * q, q, q); tiles.rect(x + 3 * q, y + q, q, q); break;
              case 3: tiles.rect(x + 2 * q, y + q, q, 3 * q); tiles.rect(x + q, y + 2 * q, 3 * q, q); break;
              case 4: tiles.rect(x + q, y + q, 3 * q, q); tiles.rect(x + q, y + 3 * q, 3 * q, q); tiles.rect(x + q, y + 2 * q, q, q); tiles.rect(x + 3 * q, y + 2 * q, q, q); break;
              case 5: tiles.rect(x + q, y + q, 3 * q, q); tiles.rect(x + q, y + 3 * q, 3 * q, q); tiles.rect(x + q, y + 2 * q, q, q); tiles.rect(x + 3 * q, y + 2 * q, q, q); tiles.rect(x + 2 * q, y + 2 * q, q, q); break;
              case 6: tiles.rect(x + q * 0.5, y + q * 0.5, 4 * q, 4 * q); break;
              case 7: tiles.rect(x, y, cell, cell); break;
            }
          }
        ctx.globalAlpha = Math.max(0, 1 - e * 2);
        BANDS.forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.fill(bandPaths[i]);
        });
        ctx.fillStyle = "#ffffff";
        ctx.fill(tiles);
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fill(faint);
        ctx.globalAlpha = 1;

        pct(String(n));
        time(fmtSec(s.elapsedMs));
        root.style.opacity = String(1 - Math.min(1, exit * 4));
      },
      destroy() {
        cv.destroy();
        root.remove();
      },
    };
  },
};
