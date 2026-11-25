// King of the Court's logo on the end mat, ported from Poddle's web/billboard-mat.js (drawMat; poddle NOTES 358, 388, 510). Here
// always `flat` (the mat seen from straight above, as the old sponsor admin showed it): transparent but for the logo, in the word's
// cream (mode 'mark') or its colours, and the "sponsored" tag. 1024 px wide at the mat's 3.75 x 1.08 m shape.
import { FLOOR_WORD } from "./boards";
import { place, type Fit } from "./logoFit";

const TW = 1024, TH = Math.round((TW * FLOOR_WORD.d) / FLOOR_WORD.w);

export function drawMat(c: HTMLCanvasElement, img: CanvasImageSource & { width: number; height: number }, mode: string, fit: Fit = null, col = FLOOR_WORD.col) {
  c.width = TW;
  c.height = TH;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, TW, TH);
  const P = place({ x: -TW * 0.47, y: -TH * 0.41, w: TW * 0.94, h: TH * 0.82 }, img.width, img.height, fit, { x: -TW * 0.49, y: -TH * 0.47, w: TW * 0.98, h: TH * 0.94 });
  g.save();
  g.translate(TW / 2, TH / 2);
  if (mode === "colour") g.drawImage(img, P.x, P.y, P.w, P.h);
  else {
    const m = document.createElement("canvas");
    m.width = Math.ceil(P.w);
    m.height = Math.ceil(P.h);
    const mg = m.getContext("2d")!;
    mg.drawImage(img, 0, 0, P.w, P.h);
    mg.globalCompositeOperation = "source-in";
    mg.fillStyle = col;
    mg.fillRect(0, 0, m.width, m.height);
    g.drawImage(m, P.x, P.y);
  }
  g.restore();
  g.globalAlpha = 0.8;
  g.fillStyle = col;
  g.font = `600 ${Math.round(TH * 0.13)}px Arial, sans-serif`;
  g.textAlign = "right";
  g.textBaseline = "alphabetic";
  g.fillText("sponsored", TW - 18, TH - 14);
  return c;
}
