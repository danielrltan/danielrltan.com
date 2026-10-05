import { clock, diveIn, el, hostCanvas, irisRadius, pixelIris, textSlot, type VariantInfo } from "./shared";

/**
 * 18 · Vinyl. A record spinning on a tilted platter (disc thickness, grooves,
 * a sheen that stays put while the record turns, a label that turns with
 * it). The tonearm tracks from the lead-in to the run-out groove as the site
 * loads, so the needle's position IS the progress. The deck's speed switch
 * is the download rate: 33⅓ under 200 KB/s, 45 under 2 MB/s, 78 above (or
 * 45 from cache), and the record spins at that speed. Exit: the needle
 * lifts and the hero iris opens out of the spindle hole.
 */
const SPEEDS: [string, number][] = [["33", 33.33], ["45", 45], ["78", 78]];

export const vinyl: VariantInfo = {
  id: 18,
  name: "Vinyl",
  ownsExit: true,
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-vin", host);
    const pct = textSlot(el("div", "ldr-vin__pct", root));
    const sel = el("div", "ldr-vin__rpm", root);
    const opts = SPEEDS.map(([l]) => {
      const o = el("span", "", sel);
      o.textContent = l;
      return o;
    });
    el("span", "ldr-vin__unit", sel).textContent = "rpm";
    const tick = clock();
    let ang = 0;
    let rpm = 33.33;
    let arm = 0;
    let lift = 0;
    let cur = -1;

    return {
      frame(now, p, n, s, exit) {
        const dt = tick(now);
        const bps = s.bytesPerSec;
        const idx = bps <= 0 ? 1 : bps < 2e5 ? 0 : bps < 2e6 ? 1 : 2;
        if (idx !== cur) {
          cur = idx;
          opts.forEach((o, i) => o.classList.toggle("is-on", i === idx));
        }
        rpm += (SPEEDS[idx][1] - rpm) * Math.min(1, dt * 2);
        if (!reduced) ang += (rpm / 60) * Math.PI * 2 * dt;
        const P = n >= 100 ? 1 : p;
        arm += (P - arm) * Math.min(1, dt * 10);
        const e = Math.min(1, exit);
        lift += ((e > 0 || n >= 100 ? 1 : 0) - lift) * Math.min(1, dt * 10);

        const { ctx, box } = cv;
        const { w, h } = box;
        const R = Math.min(w * 0.36, h * 0.34);
        const cx = w / 2 - R * 0.12, cy = h * 0.44;
        const tilt = 0.5;
        const sy = Math.cos(tilt);
        const thick = R * 0.05;

        if (e > 0) pixelIris(ctx, w, h, cx, cy, irisRadius(e, w, h, cx, cy, R * 0.025));
        else {
          ctx.fillStyle = "#ff4f00";
          ctx.fillRect(0, 0, w, h);
        }
        diveIn(ctx, e, cx, cy);

        // Platter + record edge.
        ctx.fillStyle = "#a82e00";
        ctx.beginPath();
        ctx.ellipse(cx, cy + thick * 1.6, R * 1.04, R * 1.04 * sy, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0d0400";
        ctx.beginPath();
        ctx.ellipse(cx, cy + thick, R, R * sy, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(cx - R, cy, R * 2, thick);
        ctx.fillStyle = "#1f0a00";
        ctx.beginPath();
        ctx.ellipse(cx, cy, R, R * sy, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, sy);
        // Grooves.
        ctx.lineWidth = 1;
        for (let r = 0.36; r < 0.98; r += 0.022) {
          ctx.strokeStyle = r > 0.9 || (r > 0.6 && r < 0.62) ? "rgba(255,120,60,0.14)" : "rgba(255,120,60,0.08)";
          ctx.beginPath();
          ctx.arc(0, 0, r * R, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Sheen: two fixed wedges of light (do not rotate with the record).
        for (const a0 of [-0.9, Math.PI - 0.9]) {
          const g = ctx.createRadialGradient(0, 0, R * 0.36, 0, 0, R * 0.98);
          g.addColorStop(0, "rgba(255,200,170,0)");
          g.addColorStop(0.5, "rgba(255,200,170,0.18)");
          g.addColorStop(1, "rgba(255,200,170,0.04)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, R * 0.98, a0, a0 + 0.42);
          ctx.closePath();
          ctx.fill();
        }
        // Label, turning with the record.
        ctx.rotate(ang);
        ctx.fillStyle = "#ff4f00";
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.33, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.29, -0.2, Math.PI + 0.2, true);
        ctx.arc(0, 0, R * 0.24, Math.PI + 0.2, -0.2);
        ctx.fill();
        ctx.font = `${Math.round(R * 0.09)}px VT323, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.fillText("DANIEL TAN", 0, -R * 0.13);
        ctx.font = `${Math.round(R * 0.055)}px VT323, monospace`;
        ctx.fillText("SIDE A", 0, R * 0.09);
        ctx.fillStyle = "#0d0400";
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.025, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Tonearm: pivot off the top right, needle on the groove for `arm`.
        // In the record's plane (units of R): pivot off the top right; the
        // arm length reaches the run-out groove. Swing the arm about the
        // pivot until the needle sits on the groove for `arm`.
        const PV = [1.15, -0.72];
        const armLen = Math.hypot(PV[0] - 0.36, PV[1]);
        const grooveR = 0.95 - 0.58 * arm;
        let best = Math.PI * 0.75, bestErr = 1e9;
        for (let a = Math.PI * 0.5; a < Math.PI * 1.1; a += 0.004) {
          const x = PV[0] + Math.cos(a) * armLen, y = PV[1] + Math.sin(a) * armLen;
          const err = Math.abs(Math.hypot(x, y) - grooveR);
          if (err < bestErr) {
            bestErr = err;
            best = a;
          }
        }
        const pvx = cx + PV[0] * R, pvy = cy + PV[1] * R * sy;
        const nx = cx + (PV[0] + Math.cos(best) * armLen) * R;
        const ny = cy + (PV[1] + Math.sin(best) * armLen) * R * sy - lift * R * 0.08;
        // shadow
        ctx.strokeStyle = "rgba(90,25,0,0.45)";
        ctx.lineWidth = R * 0.035;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(pvx + R * 0.03, pvy + R * 0.06);
        ctx.lineTo(nx + R * 0.03, ny + R * 0.06 + lift * R * 0.08);
        ctx.stroke();
        // pivot base
        ctx.fillStyle = "#c23d00";
        ctx.beginPath();
        ctx.ellipse(pvx, pvy + R * 0.03, R * 0.11, R * 0.11 * sy, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffd2b4";
        ctx.beginPath();
        ctx.ellipse(pvx, pvy, R * 0.09, R * 0.09 * sy, 0, 0, Math.PI * 2);
        ctx.fill();
        // arm
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = R * 0.03;
        ctx.beginPath();
        ctx.moveTo(pvx, pvy);
        ctx.lineTo(nx, ny);
        ctx.stroke();
        // headshell
        const ax = nx - pvx, ay = ny - pvy;
        ctx.fillStyle = "#ffffff";
        ctx.save();
        ctx.translate(nx, ny);
        ctx.rotate(Math.atan2(ay, ax) + 0.5);
        ctx.fillRect(-R * 0.02, -R * 0.045, R * 0.12, R * 0.09);
        ctx.restore();
        ctx.restore();

        pct(String(n));
        root.style.opacity = String(1 - Math.min(1, exit * 4));
      },
      destroy() {
        cv.destroy();
        root.remove();
      },
    };
  },
};
