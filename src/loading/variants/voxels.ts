import { fmtSec } from "../loadStats";
import { el, textSlot, type VariantInfo } from "./shared";

/**
 * 2 · Voxel build. A 3×3×3 cube assembles from 27 CSS-3D blocks (6 faces
 * each) on a slowly turning turntable; each block drops in as its 1/27th of
 * the load lands, bottom layer first. Progress reads as blocks placed.
 */
const N = 3;

export const voxels: VariantInfo = {
  id: 2,
  name: "Voxel build",
  create(host, reduced) {
    const root = el("div", "ldr-vox", host);
    const scene = el("div", "ldr-vox__scene", root);
    const world = el("div", "ldr-vox__world", scene);
    el("div", "ldr-vox__floor", world);

    // Bottom layer first; within a layer, spiral in from the back corner so
    // the stack reads as built, not random.
    const slots: [number, number, number][] = [];
    const ring = [
      [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [0, 0],
    ];
    for (let y = 0; y < N; y++) for (const [x, z] of ring) slots.push([x, y, z]);

    const cubes = slots.map(([x, y, z]) => {
      const c = el("div", "ldr-vox__cube", world);
      c.style.setProperty("--x", String(x));
      c.style.setProperty("--y", String(y));
      c.style.setProperty("--z", String(z));
      for (const f of ["t", "f", "b", "l", "r", "u"]) el("div", `ldr-vox__f ldr-vox__f--${f}`, c);
      return c;
    });

    const pct = textSlot(el("div", "ldr-vox__pct", root));
    const meta = el("div", "ldr-vox__meta", root);
    const placed = textSlot(el("span", "", meta));
    const time = textSlot(el("span", "", meta));
    let on = 0;
    const t0 = performance.now();

    return {
      frame(now, p, n, s) {
        const want = n >= 100 ? cubes.length : Math.min(cubes.length - 1, Math.floor(p * cubes.length));
        while (on < want) cubes[on++].classList.add("is-on");
        if (n >= 100) root.classList.add("is-done");
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
  },
};
