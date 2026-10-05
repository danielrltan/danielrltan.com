import { fmtRate, fmtSec, type LoadStats } from "./loadStats";

/**
 * The boot loader's look: a gimbal iris. Three nested rings (an armillary /
 * gyroscope) tumble on their own axes, each nested in the last, spun at a
 * speed set by the real download rate. At a third, two thirds and 100 a ring
 * locks: it springs square to the camera with a pulse. Fully locked they read
 * as one flat target around the count, and the exit is an iris: the rings fly
 * outward and the orange field opens through the middle onto the hero (the
 * same circle-opening gesture as the hero → About scroll iris).
 *
 * Canvas 2D with its own rotation + perspective maths: no three.js on the
 * first-paint path. The rings are thick tubes (a deep-orange outline under a
 * white/peach core), drawn as one depth-sorted list of segments across all
 * three so they pass through each other correctly. BootLoader owns the clock
 * and calls frame() every rAF; nothing here touches React.
 */
export interface Gimbal {
  /** p: shown progress 0..1, n: the integer shown (100 only once done).
   *  exit: 0 until the reveal starts, then 0..1 across LOADER_FADE_MS. */
  frame(now: number, p: number, n: number, s: LoadStats, exit: number): void;
  destroy(): void;
}

const SEG = 120;
const RADII = [1, 0.8, 0.6];
/** Tube thickness per ring, as a fraction of the outer radius. */
const THICK = [0.085, 0.075, 0.065];
type M = number[]; // 3x3 row-major

const mul = (a: M, b: M): M => {
  const o = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
const rotY = (a: number): M => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotX = (a: number): M => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Network rate → 0..1, log scale 20 KB/s .. 10 MB/s; all-cached = 0.35. */
const rateLevel = (bps: number) => (bps > 0 ? clamp01(Math.log10(bps / 2e4) / 2.7) : 0.35);

function spring(st: { x: number; v: number }, target: number, dt: number, k: number, zeta: number) {
  st.v += (k * (target - st.x) - 2 * zeta * Math.sqrt(k) * st.v) * dt;
  st.x += st.v * dt;
}

function div(cls: string, parent: HTMLElement) {
  const e = document.createElement("div");
  e.className = cls;
  parent.appendChild(e);
  return e;
}

/** Writes a text node only when its value changes. */
function textSlot(el: HTMLElement) {
  let last = "";
  return (s: string) => {
    if (s !== last) el.textContent = last = s;
  };
}

interface Seg {
  x0: number; y0: number; x1: number; y1: number;
  z: number; ring: number; tick: boolean;
}

export function createGimbal(host: HTMLElement, reduced: boolean): Gimbal {
  const c = document.createElement("canvas");
  c.className = "gimbal__canvas";
  host.appendChild(c);
  const ctx = c.getContext("2d")!;
  let w = 1, h = 1;
  const fit = () => {
    const r = host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = Math.max(1, r.width);
    h = Math.max(1, r.height);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(host);

  const text = div("gimbal__text", host);
  const pct = textSlot(div("gimbal__pct", text));
  const meta = div("gimbal__meta", text);
  const time = textSlot(div("", meta));
  const rate = textSlot(div("", meta));

  // Each ring's own angle (a spring once locked): the outer turns about Y,
  // the middle about X inside it, the inner about Y inside that.
  const ang = [{ x: 0.9, v: 0 }, { x: 2.1, v: 0 }, { x: -1.3, v: 0 }];
  const locked = [false, false, false];
  const flash = [0, 0, 0];
  let wind = 0.35;
  let last = -1;
  const segs: Seg[] = [];
  for (let i = 0; i < SEG * 3; i++) segs.push({ x0: 0, y0: 0, x1: 0, y1: 0, z: 0, ring: 0, tick: false });

  return {
    frame(now, p, n, s, exit) {
      const dt = last < 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
      last = now;
      wind += (rateLevel(s.bytesPerSec) - wind) * Math.min(1, dt * 3);
      const P = n >= 100 ? 1 : p;
      for (let k = 0; k < 3; k++) {
        if (!locked[k] && (P >= (k + 1) / 3 - 1e-6 || reduced)) {
          locked[k] = true;
          flash[k] = reduced ? 0 : 1;
          ang[k].v *= 0.3;
          if (reduced) ang[k].x = Math.round(ang[k].x / Math.PI) * Math.PI;
        }
        if (locked[k]) spring(ang[k], Math.round(ang[k].x / Math.PI) * Math.PI, dt, 220, 0.42);
        else ang[k].x += dt * (0.6 + wind * 4.2) * (k === 1 ? -1.25 : 1 + k * 0.35);
        flash[k] = Math.max(0, flash[k] - dt * 3);
      }
      const tilt = rotX(-0.32);
      const m0 = mul(tilt, rotY(ang[0].x));
      const m1 = mul(m0, rotX(ang[1].x));
      const Ms = [m0, m1, mul(m1, rotY(ang[2].x))];

      const R = Math.min(w, h) * 0.3;
      const cx = w / 2, cy = h * 0.45;
      // Reduced motion: no iris sweep, the field simply clears.
      const e = reduced ? (exit > 0 ? 1 : 0) : Math.min(1, exit);
      const eIn = e * e * e;
      const grow = 1 + eIn * 7;

      ctx.clearRect(0, 0, w, h);
      // The orange field, with the iris hole once the exit starts.
      if (e < 1) {
        ctx.fillStyle = "#ff4f00";
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        if (e > 0) {
          // The hole is the inner ring's own projected outline (shrunk to sit
          // inside the tube), so it stays concentric with the tilted rings.
          const M = Ms[2];
          const rh = RADII[2] * (1 - THICK[2] * 0.8) * Math.min(1, e * 3);
          ctx.closePath();
          for (let i = 0; i <= SEG; i++) {
            const a = (i / SEG) * Math.PI * 2;
            const lx = Math.cos(a) * rh, ly = Math.sin(a) * rh;
            const x = M[0] * lx + M[1] * ly, y = M[3] * lx + M[4] * ly, z = M[6] * lx + M[7] * ly;
            const kz = 4 / (4 + z);
            if (i) ctx.lineTo(cx + x * R * kz * grow, cy - y * R * kz * grow);
            else ctx.moveTo(cx + x * R * kz * grow, cy - y * R * kz * grow);
          }
          ctx.closePath();
        }
        ctx.fill("evenodd");
      }

      // All segments from all rings, depth-sorted together so the rings pass
      // through each other correctly.
      let m = 0;
      for (let k = 0; k < 3; k++) {
        const M = Ms[k];
        const r = RADII[k];
        let px = 0, py = 0, pz = 0;
        for (let i = 0; i <= SEG; i++) {
          const a = (i / SEG) * Math.PI * 2;
          const lx = Math.cos(a) * r, ly = Math.sin(a) * r;
          const x = M[0] * lx + M[1] * ly, y = M[3] * lx + M[4] * ly, z = M[6] * lx + M[7] * ly;
          const kz = 4 / (4 + z);
          const sx = cx + x * R * kz * grow, sy = cy - y * R * kz * grow;
          if (i) {
            const sg = segs[m++];
            sg.x0 = px; sg.y0 = py; sg.x1 = sx; sg.y1 = sy;
            sg.z = (pz + z) / 2; sg.ring = k; sg.tick = i % 10 === 0;
          }
          px = sx; py = sy; pz = z;
        }
      }
      segs.sort((a, b) => b.z - a.z);
      if (e > 0 && e < 1) {
        // Exit: every ring is locked flat by now, so nothing crosses. Stroke
        // each ring as ONE path: per-segment round caps would overlap into
        // beads once the rings fade.
        ctx.globalAlpha = 1 - e;
        for (let k = 0; k < 3; k++) {
          const M = Ms[k];
          ctx.beginPath();
          for (let i = 0; i <= SEG; i++) {
            const a = (i / SEG) * Math.PI * 2;
            const lx = Math.cos(a) * RADII[k], ly = Math.sin(a) * RADII[k];
            const x = M[0] * lx + M[1] * ly, y = M[3] * lx + M[4] * ly, z = M[6] * lx + M[7] * ly;
            const kz = 4 / (4 + z);
            if (i) ctx.lineTo(cx + x * R * kz * grow, cy - y * R * kz * grow);
            else ctx.moveTo(cx + x * R * kz * grow, cy - y * R * kz * grow);
          }
          ctx.closePath();
          const width = R * THICK[k] * grow;
          ctx.strokeStyle = "#c23d00";
          ctx.lineWidth = width + Math.max(2, width * 0.22);
          ctx.stroke();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = width;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (e === 0) {
        ctx.globalAlpha = 1 - e;
        for (const sg of segs) {
          const k = sg.ring;
          const front = sg.z < 0 || locked[k];
          // Perspective: nearer segments are a touch thicker.
          const width = R * THICK[k] * (1 + flash[k] * 0.5) * (0.88 + (0.5 - sg.z * 0.5) * 0.24) * grow;
          // Outline first (butt caps, so it never paints over the previous
          // segment's core), then the core with round caps to close joints.
          ctx.lineCap = "butt";
          ctx.strokeStyle = front ? "#c23d00" : "#a83300";
          ctx.lineWidth = width + Math.max(2, width * 0.22);
          ctx.beginPath();
          ctx.moveTo(sg.x0, sg.y0);
          ctx.lineTo(sg.x1, sg.y1);
          ctx.stroke();
          ctx.lineCap = "round";
          ctx.strokeStyle = front ? "#ffffff" : "#ffb489";
          ctx.lineWidth = width;
          ctx.stroke();
          if (sg.tick) {
            ctx.fillStyle = front ? "#ff8a4d" : "#e86a2c";
            const q = Math.max(2, width * 0.3);
            ctx.fillRect(sg.x1 - q / 2, sg.y1 - q / 2, q, q);
          }
        }
        ctx.globalAlpha = 1;
      }

      pct(String(n));
      time(fmtSec(s.elapsedMs));
      rate(fmtRate(s.bytesPerSec));
      text.style.opacity = String(1 - Math.min(1, e * 4));
    },
    destroy() {
      ro.disconnect();
      c.remove();
      text.remove();
    },
  };
}
