import { fmtKB, type LoadEntry } from "../loadStats";
import { clock, el, hostCanvas, mix, poly, spring, textSlot, type VariantInfo } from "./shared";

/**
 * 8 · Data skyline. Every file the browser actually fetched becomes a tower
 * in a little isometric city: height from its size (log scale), tint from its
 * type (scripts white, styles cream, fonts deep, images peach). Towers spiral
 * out from the centre and spring up as the count passes them; the camera
 * orbits and pulls back to keep the growing city framed.
 */
const TOP: Record<LoadEntry["kind"], string> = {
  doc: "#ffffff",
  script: "#ffffff",
  style: "#ffe0c8",
  font: "#ffa36b",
  image: "#ffc49c",
  data: "#ffd2b4",
};

/** Square spiral of grid cells from the centre. */
function spiral(n: number): [number, number][] {
  const out: [number, number][] = [[0, 0]];
  let x = 0, z = 0, dx = 1, dz = 0, len = 1;
  while (out.length < n) {
    for (let k = 0; k < 2 && out.length < n; k++) {
      for (let i = 0; i < len && out.length < n; i++) {
        x += dx; z += dz;
        out.push([x, z]);
      }
      [dx, dz] = [-dz, dx];
    }
    len++;
  }
  return out;
}

export const skyline: VariantInfo = {
  id: 8,
  name: "Data skyline",
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-sky", host);
    const pct = textSlot(el("div", "ldr-sky__pct", root));
    const meta = el("div", "ldr-sky__meta", root);
    const files = textSlot(el("span", "", meta));
    const kb = textSlot(el("span", "", meta));
    const tick = clock();
    const towers: { x: number; v: number }[] = [];
    let cells = spiral(64);
    const fit = { x: 2, v: 0 };
    let t = 0;

    return {
      frame(now, p, n, s, exit) {
        const dt = tick(now);
        t += dt;
        const list = s.entries;
        const shown = n >= 100 ? list.length : Math.min(list.length, Math.ceil(p * list.length));
        while (towers.length < list.length) towers.push({ x: 0, v: 0 });
        if (cells.length < list.length) cells = spiral(list.length * 2);
        let shownBytes = 0;
        for (let i = 0; i < shown; i++) shownBytes += list[i].bytes;

        const { ctx, box } = cv;
        const { w, h } = box;
        const yaw = reduced ? 0.7 : 0.7 + t * 0.35;
        const pitch = 0.62;
        const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        // Pull back as the city grows.
        spring(fit, Math.sqrt(Math.max(1, shown)) * 0.62 + 1.8, dt, 30, 1);
        const dist = 40;
        const scale = (Math.min(w, h * 1.1) * 0.27 * dist) / fit.x;
        const cx = w / 2, cy = h * 0.46;
        const P = (x: number, y: number, z: number): [number, number, number] => {
          const x1 = x * cyw - z * syw;
          const z1 = x * syw + z * cyw;
          const y2 = y * cp + z1 * sp;
          const z2 = -y * sp + z1 * cp + dist;
          return [cx + (x1 / z2) * scale, cy - (y2 / z2) * scale, z1];
        };

        ctx.clearRect(0, 0, w, h);
        // Ground plate.
        const g = fit.x * 1.05;
        ctx.fillStyle = "rgba(168,46,0,0.28)";
        poly(ctx, [P(-g, 0, -g), P(g, 0, -g), P(g, 0, g), P(-g, 0, g)]);
        ctx.fill();

        const idx: number[] = [];
        for (let i = 0; i < towers.length; i++) {
          const target = i < shown ? 0.25 + Math.max(0, Math.log10(Math.max(1, list[i].bytes) / 400)) * 0.62 : 0;
          spring(towers[i], exit > 0 ? 0 : target, dt, 140, 0.45);
          if (towers[i].x > 0.01) idx.push(i);
        }
        const dep = (i: number) => cells[i][0] * syw + cells[i][1] * cyw;
        idx.sort((a, b) => dep(b) - dep(a));

        const hw = 0.38;
        for (const i of idx) {
          const [gx, gz] = cells[i];
          const H = towers[i].x;
          const top = TOP[list[i].kind];
          const c = [
            P(gx - hw, 0, gz - hw), P(gx + hw, 0, gz - hw), P(gx + hw, 0, gz + hw), P(gx - hw, 0, gz + hw),
            P(gx - hw, H, gz - hw), P(gx + hw, H, gz - hw), P(gx + hw, H, gz + hw), P(gx - hw, H, gz + hw),
          ];
          // Four walls, keep the ones facing the camera (screen winding).
          const walls = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
          walls.forEach((q, k) => {
            const [a, b, d] = [c[q[0]], c[q[1]], c[q[2]]];
            const cross = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
            if (cross <= 0) return;
            ctx.fillStyle = mix(top.length === 7 ? top : "#ffffff", "#a82e00", k % 2 ? 0.42 : 0.24);
            poly(ctx, q.map((j) => c[j]));
            ctx.fill();
          });
          ctx.fillStyle = list[i].cached ? mix(top, "#ff4f00", 0.35) : top;
          poly(ctx, [c[4], c[5], c[6], c[7]]);
          ctx.fill();
        }

        pct(String(n));
        files(`${shown} files`);
        kb(fmtKB(shownBytes));
        root.style.opacity = String(1 - Math.min(1, exit * 3));
      },
      destroy() {
        cv.destroy();
        root.remove();
      },
    };
  },
};
