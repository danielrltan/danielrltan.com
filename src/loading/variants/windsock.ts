import { fmtRate } from "../loadStats";
import { clamp01, clock, el, hostCanvas, mix, rateLevel, textSlot, type VariantInfo } from "./shared";

/**
 * 9 · Windsock. An airfield windsock built as a real 3D tube (rings along a
 * bending spine, lit per quad, painter-sorted). The wind IS the download
 * rate: slow links leave it drooping and lazy, fast ones snap it straight
 * with a quick flutter, and streaks of air blow past at the same speed. Its
 * five stripes fill white one by one as the load climbs, like real socks
 * count knots.
 */
const S = 25; // rings along the sock
const A = 14; // segments around
const STRIPES = 5;

type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crs = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a: V): V => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

export const windsock: VariantInfo = {
  id: 9,
  name: "Windsock",
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-sock", host);
    const pct = textSlot(el("div", "ldr-sock__pct", root));
    const rate = textSlot(el("div", "ldr-sock__rate", root));
    const tick = clock();
    let t = 0;
    let wind = 0.35;
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const streaks = Array.from({ length: 26 }, () => ({ x: rnd(), y: rnd(), l: 0.04 + rnd() * 0.1 }));
    const L = new Float32Array([-0.45, 0.75, -0.5]); // light dir
    {
      const l = Math.hypot(L[0], L[1], L[2]);
      L[0] /= l; L[1] /= l; L[2] /= l;
    }

    return {
      frame(now, p, n, s, exit) {
        const dt = tick(now);
        const target = n >= 100 ? 1 : rateLevel(s.bytesPerSec);
        wind += (target - wind) * Math.min(1, dt * 2.5);
        t += dt * (reduced ? 0 : 1);
        const P = n >= 100 ? 1 : p;
        const { ctx, box } = cv;
        const { w, h } = box;
        const scale = Math.min(w * 0.17, h * 0.22);
        const yaw = -0.5 + Math.sin(t * 0.3) * 0.08;
        const cyw = Math.cos(yaw), syw = Math.sin(yaw);
        const ox = w * 0.5 - scale * 1.25, oy = h * 0.3;
        const proj = (v: V): [number, number, number] => {
          const x = v[0] * cyw - v[2] * syw;
          const z = v[0] * syw + v[2] * cyw;
          const k = 9 / (9 + z);
          return [ox + x * scale * k, oy - v[1] * scale * k, z];
        };

        ctx.clearRect(0, 0, w, h);
        // Air streaks: same speed as the wind.
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        for (const st of streaks) {
          st.x += dt * (0.08 + wind * 0.9) * (0.6 + st.l * 4);
          if (st.x > 1.1) { st.x = -0.15; st.y = rnd(); }
          const len = st.l * w * (0.3 + wind);
          ctx.fillRect(Math.round(st.x * w), Math.round(st.y * h), Math.round(len), 2);
        }

        // Pole.
        const base = proj([0, -1.7, 0]), top = proj([0, 0.25, 0]);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(Math.round(base[0] - 2), Math.round(top[1]), 4, Math.round(base[1] - top[1]));
        ctx.fillRect(Math.round(base[0] - 14), Math.round(base[1]), 28, 3);

        // Spine: droops under gravity when the wind is weak, flutters with it.
        const droop = (1 - wind) * 1.35 + 0.08;
        const freq = 3 + wind * 9;
        const amp = 0.06 + (1 - wind) * 0.05;
        const segLen = 3.0 / S;
        const spine: V[] = [[0.05, 0, 0]];
        const dirs: V[] = [];
        for (let i = 0; i < S; i++) {
          const u = i / S;
          const pitch = -droop * Math.pow(u, 1.25) + Math.sin(t * freq - u * 5) * amp * u * 2;
          const yawS = Math.sin(t * freq * 0.7 - u * 4 + 1) * amp * u * 2.4;
          const d: V = [Math.cos(pitch) * Math.cos(yawS), Math.sin(pitch), Math.cos(pitch) * Math.sin(yawS)];
          dirs.push(d);
          const q = spine[i];
          spine.push([q[0] + d[0] * segLen, q[1] + d[1] * segLen, q[2] + d[2] * segLen]);
        }
        dirs.push(dirs[S - 1]);
        // Rings.
        const rings: V[][] = [];
        for (let i = 0; i <= S; i++) {
          const u = i / S;
          const T = dirs[i];
          let N = nrm(crs(crs(T, [0, 1, 0]), T));
          if (!isFinite(N[0])) N = [0, 1, 0];
          const B = crs(T, N);
          const breathe = 1 + Math.sin(t * freq * 1.3 - u * 9) * 0.05 * wind;
          const r = (0.42 - 0.2 * u) * breathe * (0.75 + 0.25 * wind + 0.12 * (1 - wind) * (1 - u));
          const ring: V[] = [];
          for (let a = 0; a < A; a++) {
            const ang = (a / A) * Math.PI * 2;
            const ca = Math.cos(ang) * r, sa = Math.sin(ang) * r;
            const c = spine[i];
            ring.push([c[0] + N[0] * ca + B[0] * sa, c[1] + N[1] * ca + B[1] * sa, c[2] + N[2] * ca + B[2] * sa]);
          }
          rings.push(ring);
        }
        // Quads, painter-sorted.
        const quads: { pts: [number, number, number][]; z: number; col: string }[] = [];
        for (let i = 0; i < S; i++) {
          const stripe = Math.min(STRIPES - 1, Math.floor((i / S) * STRIPES));
          const inStripe = (i / S) * STRIPES - stripe;
          const fill = clamp01(P * STRIPES - stripe);
          const on = inStripe < fill;
          for (let a = 0; a < A; a++) {
            const a2 = (a + 1) % A;
            const v0 = rings[i][a], v1 = rings[i][a2], v2 = rings[i + 1][a2], v3 = rings[i + 1][a];
            const nn = nrm(crs(sub(v1, v0), sub(v3, v0)));
            const pts = [proj(v0), proj(v1), proj(v2), proj(v3)];
            const z = (pts[0][2] + pts[1][2] + pts[2][2] + pts[3][2]) / 4;
            // facing the camera? (camera looks down +z after yaw)
            const facing = nn[0] * syw + nn[2] * cyw < 0;
            const lam = clamp01(nn[0] * L[0] + nn[1] * L[1] + nn[2] * L[2]);
            const lit = facing ? 0.45 + 0.55 * lam : 0.15; // inside of the sock is in shade
            // alternate stripes, like a real sock: white/cream when filled,
            // two deep oranges while empty
            const alt = stripe % 2 === 1;
            const hi = on ? (alt ? "#ffd9bf" : "#ffffff") : alt ? "#c23800" : "#e04800";
            const lo = on ? (alt ? "#f08a4f" : "#ffa26a") : alt ? "#5e1a00" : "#7a2200";
            quads.push({ pts, z, col: mix(lo, hi, lit) });
          }
        }
        quads.sort((a, b) => b.z - a.z);
        for (const q of quads) {
          ctx.fillStyle = q.col;
          ctx.strokeStyle = q.col;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(q.pts[0][0], q.pts[0][1]);
          for (let k = 1; k < 4; k++) ctx.lineTo(q.pts[k][0], q.pts[k][1]);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
        root.style.top = `${Math.round(base[1] + scale * 0.25)}px`;
        pct(String(n));
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
