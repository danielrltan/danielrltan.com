import { fmtSec, type LoadStats } from "./loadStats";

/**
 * The boot loader's look: a VOXEL BUILD (owner's pick, 2026-10-05, over the
 * gimbal iris). A 3×3×3 cube assembles from 27 CSS-3D blocks (6 faces each)
 * on a slowly turning turntable; each block drops in as its 1/27th of the
 * count lands, bottom layer first, spiralling in from the back corner so the
 * stack reads as built, not random. Under it: the count, blocks placed and
 * the real time since navigation start. Same voxel language as the site
 * cursor (voxelArt.ts). The exit is the scrim's crossfade (boot-loader.css).
 *
 * Plain DOM + CSS 3D (162 faces): no three.js on the first-paint path.
 * BootLoader owns the clock and calls frame() every rAF; nothing here touches
 * React. Reduced motion: no turntable spin and blocks appear without the drop.
 */
export interface VoxelBuild {
  /** p: shown progress 0..1, n: the integer shown (100 only once done). */
  frame(now: number, p: number, n: number, s: LoadStats): void;
  destroy(): void;
}

const N = 3;
// Bottom layer first; within a layer, spiral in from the back corner.
const RING: [number, number][] = [
  [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [0, 0],
];
const FACES = ["t", "f", "b", "l", "r", "u"];

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

export function createVoxelBuild(host: HTMLElement, reduced: boolean): VoxelBuild {
  const root = div(`vbuild${reduced ? " is-reduced" : ""}`, host);
  const scene = div("vbuild__scene", root);
  const world = div("vbuild__world", scene);
  div("vbuild__floor", world);
  const cubes: HTMLElement[] = [];
  for (let y = 0; y < N; y++)
    for (const [x, z] of RING) {
      const c = div("vbuild__cube", world);
      c.style.setProperty("--x", String(x));
      c.style.setProperty("--y", String(y));
      c.style.setProperty("--z", String(z));
      for (const f of FACES) div(`vbuild__f vbuild__f--${f}`, c);
      cubes.push(c);
    }
  const pct = textSlot(div("vbuild__pct", root));
  const meta = div("vbuild__meta", root);
  const placed = textSlot(div("", meta));
  const time = textSlot(div("", meta));
  let on = 0;
  let t0 = -1;

  return {
    frame(now, p, n, s) {
      if (t0 < 0) t0 = now;
      // The last block waits for the real 100.
      const want = n >= 100 ? cubes.length : Math.min(cubes.length - 1, Math.floor(p * cubes.length));
      while (on < want) cubes[on++].classList.add("is-on");
      const yaw = reduced ? 38 : 38 + ((now - t0) / 1000) * 34;
      world.style.transform = `rotateX(-28deg) rotateY(${yaw.toFixed(2)}deg)`;
      pct(String(n));
      placed(`${on}/${cubes.length}`);
      time(fmtSec(s.elapsedMs));
    },
    destroy() {
      root.remove();
    },
  };
}
