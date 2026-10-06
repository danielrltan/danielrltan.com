import { useEffect, useRef } from "react";
import { drawVoxels, sparkBar, VOXEL, type Pose } from "../voxelArt";
import { reducedMotion } from "../motion";

/**
 * Knob-press sparks: three orange voxel wedges pop off the right of the cat
 * knob, one after another, hold, then retract. Owner's pick from the
 * 2026-10-06 lab (.scratch/bang-lab): draft 4's tapered "comic" wedges at 3x
 * thickness, orange face + rust walls, the set rotated 90° clockwise, with
 * draft 8's one-by-one pop. Same voxel material as the cursor's hover sparks
 * (white keyline round the extruded volume).
 *
 * A 2D canvas laid over the keypad <Canvas> (same box). KeypadModel writes
 * the knob's projected top-face centre + radius into `knobAnchor` every frame
 * (canvas px), so the sparks ride the tilt, float and press wobble. Fired by
 * the existing `keypad-knob-press` window event; parks its rAF when idle.
 */

/** Written by KeypadModel each frame: knob top-face centre + radius, canvas px. */
export const knobAnchor = { x: 0, y: 0, r: 0 };
// Measurement mirror for the e2e probes (like window.__keypadMotion).
(window as unknown as { __knobAnchor?: typeof knobAnchor }).__knobAnchor = knobAnchor;

// Sizes are px at the lab's reference knob radius (58 px on a 1440x900
// viewport) and scale with the live projected radius.
const REF_R = 58;
const VOXEL_SCALE = 1.6; // 3 px voxels at the reference size
const R0 = 84; // inner end of each wedge, from the knob centre (~26 px clear of the rim)
const WEDGES = [
  { a: 45, len: 36 }, // stagger order: upper right, right, lower right
  { a: 0, len: 42 },
  { a: -45, len: 36 },
].map((w) => ({ ...w, a: (-w.a * Math.PI) / 180 }));
const W0 = 9; // px at the knob end
const W1 = 39; // px at the tip
const STAGGER_S = 0.07;
const HOLD_S = 0.6;
const STIFF = 420; // out: springy pop (zeta 0.28)
const ZETA_OUT = 0.28;
const RETRACT = { k: 380, zeta: 1 }; // in: critically damped (no flash-back)
const POSE = { rx: 0.3, ry: -0.4, depth: 0.6 };
const LIFT = 5;
const FACE = "#ff4f00";
const WALLS = ["#e04800", "#c23d00", "#a83300", "#8f2a00"];

interface Spring { x: number; v: number }

function step(s: Spring, target: number, dt: number, k: number, zeta: number) {
  const c = 2 * zeta * Math.sqrt(k);
  const n = Math.max(1, Math.ceil(dt * 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (-k * (s.x - target) - c * s.v) * h;
    s.x += s.v * h;
  }
}

export function KnobSparks() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const bars = WEDGES.map(() => ({ s: { x: 0, v: 0 } as Spring, t: Infinity }));
    let frame = 0;
    let last = 0;
    let dpr = 1;

    const fit = () => {
      const r = cv.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const rm = reducedMotion.value;
      let live = false;
      for (const b of bars) {
        b.t += dt;
        const on = b.t >= 0 && b.t < HOLD_S;
        if (rm) {
          b.s.x = on ? 1 : 0;
          b.s.v = 0;
        } else if (on) step(b.s, 1, dt, STIFF, ZETA_OUT);
        else {
          step(b.s, 0, dt, RETRACT.k, RETRACT.zeta);
          if (b.s.x < 0) b.s.x = b.s.v = 0;
        }
        if (b.t < HOLD_S || b.s.x > 0.002) live = true;
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      const k = knobAnchor.r > 0 ? knobAnchor.r / REF_R : 1;
      const S = VOXEL * VOXEL_SCALE * k; // px per voxel
      const cells: [number, number][] = [];
      let amt = 0;
      bars.forEach((b, i) => {
        const x = b.s.x;
        if (x < 0.03) return;
        amt = Math.max(amt, x);
        const w = WEDGES[i];
        cells.push(...sparkBar(w.a, (R0 * k) / S, Math.max(1, ((w.len * k) / S) * x), (W0 * k) / S, (W1 * k) / S));
      });
      if (cells.length) {
        const pose: Pose = { ...POSE, scale: VOXEL_SCALE * k };
        ctx.globalAlpha = Math.min(1, amt * 1.6);
        drawVoxels(ctx, cells, knobAnchor.x, knobAnchor.y, pose, dpr, {
          face: FACE,
          walls: WALLS,
          shadow: false,
          lift: LIFT * k * Math.min(1.3, amt),
        });
        ctx.globalAlpha = 1;
      }
      frame = live ? requestAnimationFrame(tick) : 0;
    };

    const onPress = () => {
      fit();
      bars.forEach((b, i) => {
        b.t = -i * STAGGER_S;
        if (b.s.x > 0.6) b.s.v += 6; // re-press while out: a little kick
      });
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    window.addEventListener("keypad-knob-press", onPress);
    return () => {
      window.removeEventListener("keypad-knob-press", onPress);
      cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas ref={ref} className="knob-sparks" aria-hidden />;
}
