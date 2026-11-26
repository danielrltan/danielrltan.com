// One sponsor's face for one panel, ported from Poddle's web/sponsors.js (drawFace, aspectOf, boardOf, lum; poddle NOTES 351, 388,
// 401, 406, 510, 1061): the board (the colour the buyer picked, or the panel's own fill), the logo always in its own colours, as
// uploaded, and the small "sponsored" tag (ink on a light board, white on a dark one; the panel's mark tone on its own fill).
// Drawn 512 px wide at the panel's aspect.
import { PANELS } from "./boards";
import { place, type Fit } from "./logoFit";

const aspect = 27.8 / 5 / 2.4, endAspect = 16.5 / 3 / 2.4, beltAspect = 40.86 / 5 / 2.4, endBeltAspect = 28.78 / 3 / 2.4;
const panelById = (id: number) => PANELS.find((p) => p.id === id) ?? PANELS[3];

/** The buyer's board colour ('#rrggbb'), or null (the panel's own). */
export const boardOf = (mode: unknown) => (typeof mode === "string" && /^#[0-9a-f]{6}$/i.test(mode) ? mode : null);
/** Relative luminance of '#rrggbb'. */
export const lum = (h: string) => {
  const n = parseInt(h.slice(1), 16),
    c = (v: number) => ((v /= 255), v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(n >> 16) + 0.7152 * c((n >> 8) & 255) + 0.0722 * c(n & 255);
};

export const aspectOf = (id: number) => {
  const P = panelById(id), k = P.kind;
  return k === "belt" ? (P.wall === "east" || P.wall === "west" ? beltAspect : endBeltAspect) : k === "end" ? endAspect : aspect;
};

/** board: the buyer's '#rrggbb' (an older row's `mode` works too: anything else is the panel's own fill). */
export function drawFace(c: HTMLCanvasElement, img: CanvasImageSource & { width: number; height: number }, board: string | null | undefined, panel = 3, aspect_ = aspect, fit: Fit = null) {
  const P = panelById(panel), W = 512, H = Math.round(W / aspect_), end = P.kind === "end";
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const b = boardOf(board), word = b ? (lum(b) > 0.4 ? "#1c3150" : "#ffffff") : P.mark;
  g.fillStyle = b || P.fill;
  g.fillRect(0, 0, W, H);
  const bh = end ? 0.36 : 0.56, cy = end ? 0.74 : 0.5;
  const outer = end ? { x: W * 0.04, y: H * 0.4, w: W * 0.92, h: H * 0.55 } : { x: W * 0.04, y: H * 0.05, w: W * 0.92, h: H * 0.9 };
  const L = place({ x: W * 0.1, y: H * cy - (H * bh) / 2, w: W * 0.8, h: H * bh }, img.width, img.height, fit, outer);
  g.drawImage(img, L.x, L.y, L.w, L.h); // as uploaded
  g.globalAlpha = 0.75;
  g.fillStyle = word;
  g.font = `600 ${Math.round(H * 0.075)}px Arial, sans-serif`;
  g.textAlign = "right";
  g.textBaseline = "alphabetic";
  g.fillText("sponsored", W - H * 0.06, H - H * 0.06);
  return c;
}
