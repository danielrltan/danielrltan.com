import { fmtRate } from "../loadStats";
import { clock, diveIn, el, hostCanvas, irisRadius, pixelIris, textSlot, type VariantInfo } from "./shared";

/**
 * 14 · Aperture. A camera lens seen in 3D (a tilted barrel: back rim, side
 * wall, front face) whose seven iris blades open as the site loads. The
 * aperture ring turns under a fixed index from f/22 to f/1.4, so the f-stop
 * is the progress readout; the blades are a true partition of the annulus
 * (each bounded by its leading edge and the next blade's), so they overlap
 * like the real thing. The exit: blades retract into the barrel and the
 * hero's pixel iris opens through the glass.
 */
const BLADES = 7;
const STOPS = ["22", "16", "11", "8", "5.6", "4", "2.8", "2", "1.4"];

export const aperture: VariantInfo = {
  id: 14,
  name: "Aperture",
  ownsExit: true,
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-ap", host);
    const stop = textSlot(el("div", "ldr-ap__stop", root));
    const meta = el("div", "ldr-ap__meta", root);
    const pct = textSlot(el("span", "", meta));
    const rate = textSlot(el("span", "", meta));
    const tick = clock();
    let t = 0;
    let open = 0.04;

    return {
      frame(now, p, n, s, exit) {
        const dt = tick(now);
        t += reduced ? 0 : dt;
        const P = n >= 100 ? 1 : p;
        const e = Math.min(1, exit);
        // Opening radius (fraction of the housing), sprung so blades snap.
        const target = 0.08 + 0.8 * P + e * 0.6;
        open += (target - open) * Math.min(1, dt * 12);

        const { ctx, box } = cv;
        const { w, h } = box;
        const cx = w / 2, cy = h * 0.44;
        const R = Math.min(w, h) * 0.3;
        const pitch = 0.42 + Math.sin(t * 0.5) * 0.06;
        const yaw = Math.sin(t * 0.37) * 0.22;
        const sxs = Math.cos(yaw), sys = Math.cos(pitch);
        // Disc normal on screen: the barrel extends back along it.
        const depth = R * 0.32;
        const bx = -Math.sin(yaw) * depth, by = -Math.sin(pitch) * depth;

        if (e > 0) pixelIris(ctx, w, h, cx, cy, irisRadius(e, w, h, cx, cy, R * open * 0.7));
        else {
          ctx.fillStyle = "#ff4f00";
          ctx.fillRect(0, 0, w, h);
        }
        diveIn(ctx, e, cx, cy);

        // Barrel: back rim + side wall (front-face ellipse swept back).
        const ell = (ox: number, oy: number, r: number) => {
          ctx.beginPath();
          ctx.ellipse(cx + ox, cy + oy, r * sxs, r * sys, 0, 0, Math.PI * 2);
        };
        ctx.fillStyle = "#7a2200";
        ell(bx, by, R * 1.14);
        ctx.fill();
        // side wall: hull of the two ellipses, approximated with a thick sweep
        for (let k = 0; k <= 8; k++) {
          const f = k / 8;
          ctx.fillStyle = k === 8 ? "#e04800" : "#a82e00";
          ell(bx * (1 - f), by * (1 - f), R * 1.14);
          ctx.fill();
        }
        // front face ring with the aperture scale
        ctx.fillStyle = "#c23d00";
        ell(0, 0, R * 1.1);
        ctx.fill();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(sxs, sys);
        // f-number ring: rotates so the current stop sits under the index
        const ringRot = -P * ((STOPS.length - 1) / STOPS.length) * Math.PI * 1.1;
        ctx.font = `${Math.round(R * 0.085)}px VT323, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const cur = Math.round(P * (STOPS.length - 1));
        STOPS.forEach((sv, i) => {
          const a = -Math.PI / 2 + ringRot + (i / STOPS.length) * Math.PI * 1.1;
          ctx.fillStyle = i === cur ? "#ffffff" : "rgba(255,220,200,0.6)";
          ctx.fillText(sv, Math.cos(a) * R * 1.03, Math.sin(a) * R * 1.03);
        });
        for (let i = 0; i < 60; i++) {
          const a = (i / 60) * Math.PI * 2 + ringRot;
          const r0 = R * 0.95, r1 = R * (i % 5 ? 0.92 : 0.9);
          ctx.fillStyle = "rgba(255,230,210,0.5)";
          ctx.fillRect(Math.cos(a) * r0 - 1, Math.sin(a) * r0 - 1, 2, 2);
          if (!(i % 5)) ctx.fillRect(Math.cos(a) * r1 - 1, Math.sin(a) * r1 - 1, 2, 2);
        }
        // index mark
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(0, -R * 1.1);
        ctx.lineTo(-R * 0.03, -R * 1.17);
        ctx.lineTo(R * 0.03, -R * 1.17);
        ctx.fill();

        // Glass behind the blades.
        const Rg = R * 0.86;
        const g = ctx.createRadialGradient(-Rg * 0.3, -Rg * 0.35, Rg * 0.05, 0, 0, Rg);
        g.addColorStop(0, "#5a1a00");
        g.addColorStop(1, "#1a0600");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, Rg, 0, Math.PI * 2);
        ctx.fill();
        // reflections
        ctx.strokeStyle = "rgba(255,138,77,0.45)";
        ctx.lineWidth = Math.max(1, R * 0.012);
        ctx.beginPath();
        ctx.arc(0, 0, Rg * 0.55, Math.PI * 1.1, Math.PI * 1.45);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, Rg * 0.3, Math.PI * 1.15, Math.PI * 1.35);
        ctx.stroke();

        // Blades, clipped to the glass.
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, Rg, 0, Math.PI * 2);
        ctx.clip();
        const r = Math.min(1.6, open) * Rg;
        const rot = P * 1.2 + t * 0.05;
        const V: [number, number][] = [];
        for (let i = 0; i < BLADES; i++) {
          const a = rot + (i / BLADES) * Math.PI * 2;
          V.push([Math.cos(a) * r, Math.sin(a) * r]);
        }
        const dir = (i: number) => {
          const a = V[i % BLADES], b = V[(i + 1) % BLADES];
          const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
        };
        const Lx = Rg * 4;
        for (let i = 0; i < BLADES; i++) {
          const a = V[i], b = V[(i + 1) % BLADES];
          const dp = dir(i + BLADES - 1), di = dir(i);
          const pts = [
            [a[0] + dp[0] * Lx, a[1] + dp[1] * Lx],
            a,
            b,
            [b[0] + di[0] * Lx, b[1] + di[1] * Lx],
          ];
          const lg = ctx.createLinearGradient(a[0], a[1], pts[3][0], pts[3][1]);
          lg.addColorStop(0, i % 2 ? "#3a1200" : "#4a1800");
          lg.addColorStop(1, "#140500");
          ctx.fillStyle = lg;
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let k = 1; k < 4; k++) ctx.lineTo(pts[k][0], pts[k][1]);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "rgba(255,160,110,0.75)";
          ctx.lineWidth = Math.max(1, R * 0.008);
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(pts[3][0], pts[3][1]);
          ctx.stroke();
        }
        ctx.restore();
        ctx.restore();
        ctx.restore();

        stop(`f/${STOPS[cur]}`);
        pct(`${n}%`);
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
