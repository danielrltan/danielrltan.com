// One sponsor's face for one panel, ported from Poddle's web/sponsors.js (drawFace, aspectOf, colourOk; poddle NOTES 351, 388,
// 401, 406, 510): the panel's own fill, the logo in the panel's mark tone (mode 'mark') or in its colours (mode 'colour', never on a
// calm corner/end panel), and the small "sponsored" tag. Drawn 512 px wide at the panel's aspect.
import { PANELS } from "./boards";
import { place, type Fit } from "./logoFit";

const aspect = 27.8 / 5 / 2.4, endAspect = 16.5 / 3 / 2.4, beltAspect = 40.86 / 5 / 2.4, endBeltAspect = 28.78 / 3 / 2.4;
const panelById = (id: number) => PANELS.find((p) => p.id === id) ?? PANELS[3];
export const colourOk = (id: number) => panelById(id).theme !== "far";

export const aspectOf = (id: number) => {
  const P = panelById(id), k = P.kind;
  return k === "belt" ? (P.wall === "east" || P.wall === "west" ? beltAspect : endBeltAspect) : k === "end" ? endAspect : aspect;
};

export function drawFace(c: HTMLCanvasElement, img: CanvasImageSource & { width: number; height: number }, mode: string, panel = 3, aspect_ = aspect, fit: Fit = null) {
  const P = panelById(panel), W = 512, H = Math.round(W / aspect_), end = P.kind === "end";
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = P.fill;
  g.fillRect(0, 0, W, H);
  const bh = end ? 0.36 : 0.56, cy = end ? 0.74 : 0.5;
  const outer = end ? { x: W * 0.04, y: H * 0.4, w: W * 0.92, h: H * 0.55 } : { x: W * 0.04, y: H * 0.05, w: W * 0.92, h: H * 0.9 };
  const L = place({ x: W * 0.1, y: H * cy - (H * bh) / 2, w: W * 0.8, h: H * bh }, img.width, img.height, fit, outer);
  if (mode === "colour" && colourOk(P.id)) g.drawImage(img, L.x, L.y, L.w, L.h);
  else {
    const m = document.createElement("canvas");
    m.width = Math.ceil(L.w);
    m.height = Math.ceil(L.h);
    const mg = m.getContext("2d")!;
    mg.drawImage(img, 0, 0, L.w, L.h);
    mg.globalCompositeOperation = "source-in";
    mg.fillStyle = P.mark;
    mg.fillRect(0, 0, m.width, m.height);
    g.drawImage(m, L.x, L.y);
  }
  g.globalAlpha = 0.75;
  g.fillStyle = P.mark;
  g.font = `600 ${Math.round(H * 0.075)}px Arial, sans-serif`;
  g.textAlign = "right";
  g.textBaseline = "alphabetic";
  g.fillText("sponsored", W - H * 0.06, H - H * 0.06);
  return c;
}
