import { fmtSec } from "../loadStats";
import { el, mix, textSlot, type VariantInfo } from "./shared";

/**
 * 4 · Extruded number. Today's big VT323 count, given depth: 14 copies
 * stacked back in Z with a hue-shifted ramp (white → peach → deep orange),
 * swaying on a CSS-3D turntable and leaning toward the pointer. Below it a
 * solid 3D bar fills: front, top and end cap are real faces.
 */
const LAYERS = 14;

export const extrude: VariantInfo = {
  id: 4,
  name: "Extruded number",
  create(host, reduced) {
    const root = el("div", "ldr-ext", host);
    const stack = el("div", "ldr-ext__stack", root);
    const num = el("div", "ldr-ext__num", stack);
    const layers: HTMLElement[] = [];
    for (let k = LAYERS - 1; k >= 0; k--) {
      const l = el("span", "ldr-ext__layer", num);
      l.style.setProperty("--k", String(k));
      l.style.color = k === 0 ? "#ffffff" : mix("#ffc9a3", "#a82e00", k / (LAYERS - 1));
      l.textContent = "0";
      layers.push(l);
    }
    const bar = el("div", "ldr-ext__bar", stack);
    el("div", "ldr-ext__track", bar);
    el("div", "ldr-ext__fill ldr-ext__fill--front", bar);
    el("div", "ldr-ext__fill ldr-ext__fill--top", bar);
    el("div", "ldr-ext__fill ldr-ext__fill--cap", bar);
    const time = textSlot(el("div", "ldr-ext__meta", root));

    let px = 0;
    let py = 0;
    const onMove = (e: PointerEvent) => {
      px = (e.clientX / window.innerWidth) * 2 - 1;
      py = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    let shown = -1;
    let rx = 14;
    let ry = -20;
    const t0 = performance.now();

    return {
      frame(now, p, n, s) {
        if (n !== shown) {
          shown = n;
          const t = String(n);
          for (const l of layers) l.textContent = t;
        }
        const t = (now - t0) / 1000;
        const tx = reduced ? 12 : 12 + Math.sin(t * 0.8) * 5 - py * 10;
        const ty = reduced ? -20 : -20 + Math.sin(t * 1.1) * 14 + px * 18;
        rx += (tx - rx) * 0.12;
        ry += (ty - ry) * 0.12;
        stack.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
        bar.style.setProperty("--p", (n >= 100 ? 1 : p).toFixed(4));
        time(fmtSec(s.elapsedMs));
      },
      destroy() {
        window.removeEventListener("pointermove", onMove);
        root.remove();
      },
    };
  },
};
