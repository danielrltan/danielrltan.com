import { fmtKB } from "../loadStats";
import { el, hostCanvas, textSlot, type VariantInfo } from "./shared";

/**
 * 5 · Blueprint room. The room from the hero, drafted as a 3D wireframe on a
 * canvas (own camera + perspective projection): a pen traces floor, walls,
 * window, desk, monitor, bed and shelf edge by edge, and the drawn length IS
 * the progress. A ticker counts the real files and bytes as they arrive. At
 * 100 the walls fill in.
 */
type V3 = [number, number, number];
type Seg = [V3, V3];

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Seg[] {
  const p = (x: number, y: number, z: number): V3 => [x, y, z];
  const c = [
    p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1),
    p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1),
  ];
  const e = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 5], [2, 6], [3, 7], [4, 5], [5, 6], [6, 7], [7, 4]];
  return e.map(([a, b]) => [c[a], c[b]]);
}
const rect = (pts: V3[]): Seg[] => pts.map((a, i) => [a, pts[(i + 1) % pts.length]]);

const W = 4, D = 4, H = 2.6;
const SEGS: Seg[] = [
  ...rect([[0, 0, 0], [W, 0, 0], [W, 0, D], [0, 0, D]]), // floor
  [[0, 0, 0], [0, H, 0]], [[W, 0, 0], [W, H, 0]], [[0, 0, D], [0, H, D]], // posts
  [[0, H, 0], [W, H, 0]], [[0, H, 0], [0, H, D]], // wall tops
  ...rect([[2.5, 1.1, 0], [3.6, 1.1, 0], [3.6, 2.1, 0], [2.5, 2.1, 0]]), // window
  [[3.05, 1.1, 0], [3.05, 2.1, 0]],
  ...box(2.2, 0, 0.05, 3.9, 0.75, 0.85), // desk
  ...box(2.7, 0.75, 0.15, 3.4, 1.2, 0.3), // monitor
  ...box(0.05, 0, 2.0, 1.9, 0.45, 3.95), // bed
  ...box(0.15, 0.45, 3.3, 1.2, 0.6, 3.85), // pillow
  ...box(0, 1.5, 0.6, 0.35, 1.58, 1.8), // shelf
  ...rect([[1.4, 0.005, 1.0], [3.2, 0.005, 1.0], [3.2, 0.005, 2.6], [1.4, 0.005, 2.6]]), // rug
];
const LEN = SEGS.map(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
const TOTAL = LEN.reduce((s, l) => s + l, 0);
const WALLS: V3[][] = [
  [[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]],
  [[0, 0, 0], [0, H, 0], [0, H, D], [0, 0, D]],
  [[0, 0, 0], [W, 0, 0], [W, 0, D], [0, 0, D]],
];

export const blueprint: VariantInfo = {
  id: 5,
  name: "Blueprint room",
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-bp", host);
    const pct = textSlot(el("div", "ldr-bp__pct", root));
    const meta = el("div", "ldr-bp__meta", root);
    const files = textSlot(el("span", "", meta));
    const kb = textSlot(el("span", "", meta));
    const t0 = performance.now();
    let doneAt = 0;

    return {
      frame(now, p, n, s) {
        const { ctx, box: b } = cv;
        const { w, h } = b;
        const t = (now - t0) / 1000;
        // + π puts the walls' corner at the back, facing the camera.
        const yaw = Math.PI + 0.78 + (reduced ? 0 : Math.sin(t * 0.6) * 0.22);
        const pitch = 0.5;
        const dist = 13;
        const scale = Math.min(w, h * 0.9) * 1.4;
        const cx = w / 2;
        const cy = h * 0.36;
        const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const proj = (v: V3): [number, number] => {
          const x = v[0] - W / 2, y = v[1] - H / 2, z = v[2] - D / 2;
          const x1 = x * cyw - z * syw;
          const z1 = x * syw + z * cyw;
          const y2 = y * cp + z1 * sp;
          const z2 = -y * sp + z1 * cp + dist;
          return [cx + (x1 / z2) * scale, cy - (y2 / z2) * scale];
        };

        ctx.clearRect(0, 0, w, h);
        // Faint floor grid: the paper.
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0.5; i < W; i += 0.5) {
          const a = proj([i, 0, 0]), c = proj([i, 0, D]);
          ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]);
          const d = proj([0, 0, i]), e = proj([W, 0, i]);
          ctx.moveTo(d[0], d[1]); ctx.lineTo(e[0], e[1]);
        }
        ctx.stroke();

        if (n >= 100 && !doneAt) doneAt = now;
        if (doneAt) {
          const a = Math.min(1, (now - doneAt) / 420) * 0.16;
          ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
          for (const poly of WALLS) {
            ctx.beginPath();
            poly.forEach((v, i) => { const q = proj(v); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
            ctx.closePath();
            ctx.fill();
          }
        }

        let left = (n >= 100 ? 1 : p) * TOTAL;
        let tip: [number, number] | null = null;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = Math.max(1.5, scale * 0.0022);
        ctx.lineCap = "square";
        ctx.beginPath();
        for (let i = 0; i < SEGS.length && left > 0; i++) {
          const [a, c] = SEGS[i];
          const k = Math.min(1, left / LEN[i]);
          left -= LEN[i];
          const end: V3 = [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k];
          const pa = proj(a), pe = proj(end);
          ctx.moveTo(pa[0], pa[1]);
          ctx.lineTo(pe[0], pe[1]);
          if (k < 1) tip = pe;
        }
        ctx.stroke();
        if (tip && !doneAt) {
          const r = Math.max(3, scale * 0.005);
          ctx.fillStyle = "#fff";
          ctx.fillRect(Math.round(tip[0] - r), Math.round(tip[1] - r), Math.round(r * 2), Math.round(r * 2));
          ctx.strokeStyle = "rgba(255,255,255,0.45)";
          ctx.lineWidth = 1;
          const g = r * (2.2 + Math.sin(t * 14) * 0.5);
          ctx.strokeRect(Math.round(tip[0] - g) + 0.5, Math.round(tip[1] - g) + 0.5, Math.round(g * 2), Math.round(g * 2));
        }

        pct(String(n));
        files(`${s.files} files`);
        kb(fmtKB(s.bytes));
      },
      destroy() {
        cv.destroy();
        root.remove();
      },
    };
  },
};
