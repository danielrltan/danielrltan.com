// How a buyer arranged their logo in its box, ported from Poddle's web/logo-fit.js (place, cleanFit; poddle NOTES 510),
// so the owner's previews here draw it exactly as the game's boards and mats do.

export type Fit = { s: number; x: number; y: number } | null | undefined;
type Box = { x: number; y: number; w: number; h: number };

const FIT_MIN = 0.4, FIT_MAX = 1.6;
const clamp = (v: unknown, a: number, b: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d);
function cleanFit(f: Fit) {
  return f && typeof f === "object" ? { s: clamp(f.s, FIT_MIN, FIT_MAX, 1), x: clamp(f.x, -1, 1, 0), y: clamp(f.y, -1, 1, 0) } : { s: 1, x: 0, y: 0 };
}

/** The logo's rectangle: image iw x ih fitted into box, sized and moved by fit, never past outer. */
export function place(box: Box, iw: number, ih: number, fit: Fit, outer: Box = box) {
  const f = cleanFit(fit), k = Math.min(Math.min(box.w / iw, box.h / ih) * f.s, outer.w / iw, outer.h / ih), w = iw * k, h = ih * k;
  const axis = (b0: number, bw: number, o0: number, ow: number, n: number, t: number): [number, number] => {
    if (n <= bw + 1e-6) {
      const room = (bw - n) / 2;
      return [b0 + room + t * room, room];
    }
    return [Math.min(o0 + ow - n, Math.max(o0, b0 + (bw - n) / 2)), 0];
  };
  const [x, roomX] = axis(box.x, box.w, outer.x, outer.w, w, f.x), [y, roomY] = axis(box.y, box.h, outer.y, outer.h, h, f.y);
  return { x, y, w, h, roomX, roomY };
}
