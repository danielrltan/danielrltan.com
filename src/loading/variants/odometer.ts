import { fmtKB, fmtSec } from "../loadStats";
import { el, textSlot, type VariantInfo } from "./shared";

/**
 * 1 · Odometer. Three CSS-3D drums (ten faces each, preserve-3d) roll the
 * percentage like a car's trip meter: the ones drum spins continuously, the
 * tens drum only turns while the ones roll 9→0. Under it a stopwatch reads the
 * real time since navigation start and the bytes fetched.
 */
export const odometer: VariantInfo = {
  id: 1,
  name: "Odometer",
  create(host) {
    const root = el("div", "ldr-odo", host);
    const row = el("div", "ldr-odo__row", root);
    const drums: HTMLElement[] = [];
    const wins: HTMLElement[] = [];
    for (let d = 0; d < 3; d++) {
      const win = el("div", "ldr-odo__win", row);
      const drum = el("div", "ldr-odo__drum", win);
      for (let i = 0; i < 10; i++) {
        const f = el("div", "ldr-odo__face", drum);
        f.style.setProperty("--i", String(i));
        f.textContent = String(i);
      }
      drums.push(drum);
      wins.push(win);
    }
    el("div", "ldr-odo__pct", row).textContent = "%";
    const meta = el("div", "ldr-odo__meta", root);
    const time = textSlot(el("span", "", meta));
    const kb = textSlot(el("span", "", meta));

    const set = (i: number, v: number) => {
      drums[i].style.transform = `translateZ(calc(var(--r) * -1)) rotateX(${(v * 36).toFixed(2)}deg)`;
    };
    let hundredsOn = false;

    return {
      frame(_now, p, n, s) {
        // Continuous value; n pins the final 100 exactly.
        const v = n >= 100 ? 100 : Math.min(99.999, p * 100);
        const ones = v % 10;
        const carryT = Math.max(0, ones - 9); // tens turns during 9→10
        const tens = Math.floor(v / 10) % 10 + carryT;
        const carryH = v >= 99 ? Math.min(1, v - 99) : 0;
        set(2, ones);
        set(1, tens);
        set(0, carryH);
        if (!hundredsOn && v >= 99.5) {
          hundredsOn = true;
          wins[0].classList.add("is-on");
        }
        time(fmtSec(s.elapsedMs));
        kb(fmtKB(s.bytes));
      },
      destroy() {
        root.remove();
      },
    };
  },
};
