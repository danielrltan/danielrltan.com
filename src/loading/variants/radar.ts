import { fmtKB } from "../loadStats";
import { bayer4, clock, diveIn, el, hostCanvas, irisRadius, pixelIris, rateLevel, textSlot, type VariantInfo } from "./shared";

/**
 * 15 · Radar. A scope tilted back in 3D, drawn in square pixels: pixel
 * staircase range rings, a sweep arm with a dithered afterglow, and the bezel
 * filling as the load climbs. Every file the browser fetched is a contact,
 * placed by arrival and standing up out of the scope as a little pillar sized
 * by its bytes, lit only when the sweep passes it (then decaying, like real
 * phosphor). The sweep turns at the download rate. Exit: the hero iris
 * opens from the centre of the scope.
 */
export const radar: VariantInfo = {
  id: 15,
  name: "Radar",
  ownsExit: true,
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-rad", host);
    const pct = textSlot(el("div", "ldr-rad__pct", root));
    const meta = el("div", "ldr-rad__meta", root);
    const contacts = textSlot(el("span", "", meta));
    const kb = textSlot(el("span", "", meta));
    const tick = clock();
    let sweep = -Math.PI / 2;
    let wind = 0.35;
    let t = 0;
    const glow: number[] = [];

    return {
      frame(now, p, n, s, exit) {
        const dt = tick(now);
        t += reduced ? 0 : dt;
        wind += (rateLevel(s.bytesPerSec) - wind) * Math.min(1, dt * 3);
        const prev = sweep;
        if (!reduced) sweep += dt * (2.2 + wind * 7);
        const P = n >= 100 ? 1 : p;
        const e = Math.min(1, exit);
        const { ctx, box } = cv;
        const { w, h } = box;
        const cx = w / 2, cy = h * 0.44;
        const R = Math.min(w * 0.42, h * 0.36);
        const tilt = 0.55 + Math.sin(t * 0.4) * 0.04;
        const sy = Math.cos(tilt);
        const px = Math.max(2, Math.round(R / 70)); // pixel size
        const at = (a: number, r: number, up = 0): [number, number] => [
          cx + Math.cos(a) * r * R,
          cy + Math.sin(a) * r * R * sy - up * R * Math.sin(tilt),
        ];
        const dot = (x: number, y: number, s = px) => ctx.fillRect(Math.round(x / px) * px, Math.round(y / px) * px, s, s);

        if (e > 0) pixelIris(ctx, w, h, cx, cy, irisRadius(e, w, h, cx, cy, R * 0.1));
        else {
          ctx.fillStyle = "#ff4f00";
          ctx.fillRect(0, 0, w, h);
        }
        diveIn(ctx, e, cx, cy);

        // Scope disc + thickness.
        ctx.fillStyle = "#a82e00";
        ctx.beginPath();
        ctx.ellipse(cx, cy + R * 0.05, R * 1.06, R * 1.06 * sy, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#c23d00";
        ctx.beginPath();
        ctx.ellipse(cx, cy, R * 1.06, R * 1.06 * sy, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#e04800";
        ctx.beginPath();
        ctx.ellipse(cx, cy, R, R * sy, 0, 0, Math.PI * 2);
        ctx.fill();

        // Afterglow: dithered pixels trailing the arm (~110°).
        const span = 1.9;
        const steps = 90;
        for (let k = 0; k < steps; k++) {
          const f = k / steps;
          const a = sweep - f * span;
          const level = Math.floor((1 - f) * (1 - f) * 16);
          for (let rr = 0.06; rr < 1; rr += px / R * 1.4) {
            const [x, y] = at(a, rr);
            const gx = Math.round(x / px), gy = Math.round(y / px);
            if (bayer4(gx, gy) < level) {
              ctx.fillStyle = "rgba(255,200,160,0.55)";
              dot(x, y);
            }
          }
        }
        // Range rings + crosshair, in pixels.
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        for (const rr of [0.25, 0.5, 0.75, 1]) {
          const m = Math.round(rr * 120);
          for (let i = 0; i < m; i++) {
            const [x, y] = at((i / m) * Math.PI * 2, rr);
            dot(x, y);
          }
        }
        for (let i = -20; i <= 20; i++) {
          if (i % 2) continue;
          let [x, y] = at(0, i / 20);
          dot(x, y);
          [x, y] = at(Math.PI / 2, i / 20);
          dot(x, y);
        }
        // Bezel: progress arc, chunky pixels.
        const segs = 96;
        for (let i = 0; i < segs; i++) {
          const a = -Math.PI / 2 + (i / segs) * Math.PI * 2;
          const [x, y] = at(a, 1.03);
          ctx.fillStyle = i / segs < P ? "#ffffff" : "rgba(255,255,255,0.22)";
          dot(x, y, px * 2);
        }

        // Contacts.
        const list = s.entries;
        const shown = n >= 100 ? list.length : Math.min(list.length, Math.ceil(P * list.length));
        while (glow.length < list.length) glow.push(0);
        const drawn: { x: number; y: number; hgt: number; g: number; z: number }[] = [];
        for (let i = 0; i < shown; i++) {
          const a = i * 2.39996 - Math.PI / 2; // golden angle
          const rr = 0.18 + 0.78 * ((i * 0.618034) % 1);
          // lit when the arm crosses it
          const rel = ((sweep - a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          const relPrev = ((prev - a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
          if (rel < relPrev || reduced) glow[i] = 1;
          glow[i] = Math.max(0, glow[i] - dt * 0.7);
          const hgt = 0.04 + Math.max(0, Math.log10(Math.max(1, list[i].bytes) / 500)) * 0.07;
          const [x, y] = at(a, rr);
          drawn.push({ x, y, hgt, g: glow[i], z: Math.sin(a) * rr });
        }
        drawn.sort((a, b) => a.z - b.z);
        for (const d of drawn) {
          const top = d.y - d.hgt * R * Math.sin(tilt);
          const wpx = px * 2;
          ctx.fillStyle = `rgba(122,34,0,0.6)`;
          ctx.fillRect(d.x - wpx / 2, d.y - px / 2, wpx * 1.6, px); // shadow
          ctx.fillStyle = d.g > 0.05 ? `rgba(255,${180 + Math.round(75 * d.g)},${140 + Math.round(115 * d.g)},${0.35 + 0.65 * d.g})` : "rgba(255,170,120,0.3)";
          ctx.fillRect(Math.round(d.x - wpx / 2), Math.round(top), wpx, Math.max(px, Math.round(d.y - top)));
          ctx.fillStyle = d.g > 0.05 ? "#ffffff" : "rgba(255,210,180,0.45)";
          ctx.fillRect(Math.round(d.x - wpx / 2), Math.round(top - px), wpx, px);
        }
        // Arm.
        ctx.fillStyle = "#ffffff";
        for (let rr = 0; rr <= 1; rr += px / R) {
          const [x, y] = at(sweep, rr);
          dot(x, y);
        }
        ctx.restore();

        pct(String(n));
        contacts(`${shown} files`);
        let b = 0;
        for (let i = 0; i < shown; i++) b += list[i].bytes;
        kb(fmtKB(b));
        root.style.opacity = String(1 - Math.min(1, exit * 4));
      },
      destroy() {
        cv.destroy();
        root.remove();
      },
    };
  },
};
