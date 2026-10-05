import { fmtSec } from "../loadStats";
import { el, inOutCubic, textSlot, type VariantInfo } from "./shared";

/**
 * 12 · Speedcube. A scrambled 3×3 cube solves itself as the site loads: one
 * face turn per 1/14th of the load, eased so each turn snaps. 27 CSS-3D
 * cubies, each positioned by a matrix3d built from its integer position and
 * orientation (plus the live turn's rotation), so turns are real layer
 * rotations, not faked. The counter is moves left; a solved cube pops and
 * spins.
 */
const MOVES = 14;
type M3 = number[]; // row-major 3x3

const rot = (axis: number, a: number): M3 => {
  const c = Math.cos(a), s = Math.sin(a);
  if (axis === 0) return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 1) return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
const mul = (a: M3, b: M3): M3 => {
  const o = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return o;
};
const apply = (m: M3, v: number[]) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
const snap = (a: number[]) => a.map((x) => Math.round(x));

// Sticker tints: one hue family, spread in value so the scramble reads.
// +x, -x, +y(down), -y(up), +z(front), -z(back)
const STICKER = ["#ffe14d", "#8f2a00", "#ffc9a3", "#ffffff", "#ff8a4d", "#3a1400"];
const FACES: [string, number, number][] = [
  // [transform, axis, sign]
  ["rotateY(90deg)", 0, 1],
  ["rotateY(-90deg)", 0, -1],
  ["rotateX(-90deg)", 1, 1],
  ["rotateX(90deg)", 1, -1],
  ["", 2, 1],
  ["rotateY(180deg)", 2, -1],
];

export const cube: VariantInfo = {
  id: 12,
  name: "Speedcube",
  create(host, reduced) {
    const root = el("div", "ldr-cube", host);
    const scene = el("div", "ldr-cube__scene", root);
    const world = el("div", "ldr-cube__world", scene);
    const pct = textSlot(el("div", "ldr-cube__pct", root));
    const meta = el("div", "ldr-cube__meta", root);
    const left = textSlot(el("span", "", meta));
    const time = textSlot(el("span", "", meta));

    const cubies: { node: HTMLElement; pos: number[]; ori: M3 }[] = [];
    for (let x = -1; x <= 1; x++)
      for (let y = -1; y <= 1; y++)
        for (let z = -1; z <= 1; z++) {
          const node = el("div", "ldr-cube__cubie", world);
          const pos = [x, y, z];
          FACES.forEach(([tf, axis, sign], i) => {
            const f = el("div", "ldr-cube__f", node);
            f.style.transform = `${tf} translateZ(calc(var(--s) / 2))`;
            if (pos[axis] === sign) {
              const st = el("div", "ldr-cube__st", f);
              st.style.background = STICKER[i];
            }
          });
          cubies.push({ node, pos, ori: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
        }

    // Scramble (seeded), then solve by playing it backwards.
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const scramble: { axis: number; layer: number; dir: number }[] = [];
    while (scramble.length < MOVES) {
      const axis = Math.floor(rnd() * 3);
      if (scramble.length && scramble[scramble.length - 1].axis === axis) continue;
      scramble.push({ axis, layer: rnd() < 0.5 ? -1 : 1, dir: rnd() < 0.5 ? -1 : 1 });
    }
    const commit = (mv: { axis: number; layer: number; dir: number }) => {
      const r = rot(mv.axis, (mv.dir * Math.PI) / 2);
      for (const c of cubies)
        if (c.pos[mv.axis] === mv.layer) {
          c.pos = snap(apply(r, c.pos));
          c.ori = mul(r, c.ori).map((v) => Math.round(v));
        }
    };
    scramble.forEach(commit);
    const solve = scramble.slice().reverse().map((m) => ({ ...m, dir: -m.dir }));
    let done = 0;
    const t0 = performance.now();

    return {
      frame(now, p, n, s) {
        const P = n >= 100 ? 1 : p;
        const f = P * MOVES;
        const target = Math.min(MOVES, Math.floor(f + 1e-6));
        while (done < target) commit(solve[done++]);
        const live = done < MOVES ? solve[done] : null;
        const th = live ? inOutCubic(Math.min(1, (f - done) * 1.25)) * live.dir * (Math.PI / 2) : 0;
        const r = live ? rot(live.axis, th) : null;
        for (const c of cubies) {
          let pos = c.pos, ori = c.ori;
          if (live && r && c.pos[live.axis] === live.layer) {
            pos = apply(r, pos);
            ori = mul(r, ori);
          }
          const [a, b, cc, d, e, ff, g, h, i] = ori;
          c.node.style.transform = `translate3d(calc(${pos[0].toFixed(4)} * var(--g)), calc(${pos[1].toFixed(4)} * var(--g)), calc(${pos[2].toFixed(4)} * var(--g))) matrix3d(${a},${d},${g},0,${b},${e},${h},0,${cc},${ff},${i},0,0,0,0,1)`;
        }
        const t = (now - t0) / 1000;
        const spin = reduced ? 0 : t * 24;
        world.style.transform = `rotateX(-24deg) rotateY(${(-35 + spin).toFixed(2)}deg)`;
        if (n >= 100) root.classList.add("is-solved");
        pct(String(n));
        left(MOVES - done === 1 ? "1 move" : `${MOVES - done} moves`);
        time(fmtSec(s.elapsedMs));
      },
      destroy() {
        root.remove();
      },
    };
  },
};
