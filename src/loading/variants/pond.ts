import { fmtKB } from "../loadStats";
import { clock, el, hostCanvas, irisRadius, pixelIris, textSlot, type VariantInfo } from "./shared";

/**
 * 17 · Ripple pond. A halftone field of square dots laid out on a plane
 * tilted away in perspective. Every file the browser fetched is a drop in
 * the centre: it launches a circular ripple whose height is its size (log
 * bytes), and the waves add, so a burst of files makes a choppy pond and a
 * lull lets it settle. Dot size and brightness follow the water height,
 * halftone style. Exit: the iris opens from the drop point.
 */
const G = 46;

export const pond: VariantInfo = {
  id: 17,
  name: "Ripple pond",
  ownsExit: true,
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-pond", host);
    const pct = textSlot(el("div", "ldr-pond__pct", root));
    const meta = el("div", "ldr-pond__meta", root);
    const files = textSlot(el("span", "", meta));
    const kb = textSlot(el("span", "", meta));
    const tick = clock();
    const drops: { t0: number; amp: number }[] = [];
    let launched = 0;
    let t = 0;
    let lastLaunch = -1;

    return {
      frame(now, p, n, s, exit) {
        const dt = tick(now);
        t += dt;
        const P = n >= 100 ? 1 : p;
        const e = Math.min(1, exit);
        const list = s.entries;
        const shown = n >= 100 ? list.length : Math.min(list.length, Math.ceil(P * list.length));
        // Launch drops for newly-arrived files, at most one per 40 ms so a
        // burst reads as a patter, not one splash.
        while (launched < shown && t - lastLaunch > 0.04) {
          const b = Math.max(1, list[launched].bytes);
          drops.push({ t0: t, amp: 0.25 + Math.min(1, Math.log10(b / 300) / 3) * 0.75 });
          launched++;
          lastLaunch = t;
        }
        // Retire faded drops.
        while (drops.length && t - drops[0].t0 > 4) drops.shift();

        const { ctx, box } = cv;
        const { w, h } = box;
        const cx = w / 2, cy = h * 0.47;
        const pitch = 1.0;
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        const dist = 4.2;
        const scale = Math.min(w * 0.78, h * 1.2) * 0.62;

        if (e > 0) pixelIris(ctx, w, h, cx, cy, irisRadius(e, w, h, cx, cy, scale * 0.05));
        else {
          ctx.fillStyle = "#ff4f00";
          ctx.fillRect(0, 0, w, h);
        }

        const bands = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
        const speed = 0.9; // world units / s
        const cell = scale / G;
        for (let j = 0; j < G; j++)
          for (let i = 0; i < G; i++) {
            const x = (i / (G - 1)) * 2 - 1;
            const z = (j / (G - 1)) * 2 - 1;
            const r = Math.hypot(x, z);
            if (r > 1) continue;
            let hgt = 0;
            if (!reduced)
              for (const d of drops) {
                const age = t - d.t0;
                const front = age * speed;
                const dr = r - front;
                if (dr > 0.02 || dr < -0.5) continue;
                hgt += d.amp * Math.cos(dr * 26) * Math.exp(dr * 7) * Math.exp(-age * 0.9) * (1 - r * 0.4);
              }
            const y = hgt * 0.24;
            const y2 = y * cp + z * sp;
            const z2 = -y * sp + z * cp + dist;
            const k = dist / z2;
            const sx = cx + x * scale * k * 0.5 * 1.3;
            const sy = cy - y2 * scale * k * 0.5;
            const v = Math.max(0, Math.min(1, 0.32 + hgt * 0.55));
            const sz = Math.max(1, cell * k * (0.22 + 0.62 * v) * (1 - e));
            const band = v > 0.75 ? 3 : v > 0.5 ? 2 : v > 0.36 ? 1 : 0;
            bands[band].rect(Math.round(sx - sz / 2), Math.round(sy - sz / 2), Math.round(sz), Math.round(sz));
          }
        const cols = ["rgba(255,190,150,0.45)", "rgba(255,214,190,0.7)", "#ffe6d6", "#ffffff"];
        ctx.globalAlpha = 1 - e;
        bands.forEach((b, i) => {
          ctx.fillStyle = cols[i];
          ctx.fill(b);
        });
        ctx.globalAlpha = 1;

        // the count floats over the drop point
        root.style.top = `${Math.round(cy - root.offsetHeight * 0.75)}px`;
        pct(String(n));
        files(`${shown} files`);
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
