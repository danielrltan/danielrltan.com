import * as THREE from "three";

/**
 * Hovering the keypad OLED turns the email address site orange (the rest of
 * the screen stays white), so it reads as the thing a click copies. The
 * owner's pick from the Screen Hover lab (2026-10-07, .scratch/hover-lab,
 * draft 09).
 *
 * The orange frame is built once from the screen's own art: the email row is
 * wiped with the art's empty bottom band, then its glyphs are redrawn from a
 * luminance mask of the original row, tinted, with an orange glow. Hover
 * fades that frame over the art in a CanvasTexture that KeypadModel swaps
 * onto the display material, like copiedScreen.ts.
 *
 * Coordinates are display.png px (1000 x 616), measured from the art; they
 * scale with whatever size the GLB's copy of it decodes to. A new screen
 * layout needs these re-measured.
 */
export const HOVER_ORANGE = "#ff5a12";
const ART_W = 1000;
const ROW = { x: 80, y: 268, w: 860, h: 94 }; // the email + its glow
const BLANK_Y = 492; // empty band at the bottom of the art
const GLOW = 17;

export type HoverScreen = {
  tex: THREE.CanvasTexture;
  /** Redraw at hover amount k (0 = the plain art, 1 = fully orange). */
  draw(k: number): void;
  dispose(): void;
};

export function makeHoverScreen(art: THREE.Texture): HoverScreen | null {
  const img = art.image as CanvasImageSource & { width: number; height: number };
  if (!img?.width) return null;
  const W = img.width, H = img.height, s = W / ART_W;
  const r = { x: Math.round(ROW.x * s), y: Math.round(ROW.y * s), w: Math.round(ROW.w * s), h: Math.round(ROW.h * s) };

  // glyphs alone: the row's brightness as alpha, filled orange
  const glyphs = document.createElement("canvas");
  glyphs.width = r.w;
  glyphs.height = r.h;
  const g = glyphs.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  const src = g.getImageData(0, 0, r.w, r.h);
  g.fillStyle = HOVER_ORANGE;
  g.fillRect(0, 0, r.w, r.h);
  const out = g.getImageData(0, 0, r.w, r.h);
  for (let i = 0; i < src.data.length; i += 4) {
    out.data[i + 3] = 255 * Math.max(0, Math.min(1, (src.data[i] - 40) / 200));
  }
  g.putImageData(out, 0, 0);

  // the fully orange frame
  const lit = document.createElement("canvas");
  lit.width = W;
  lit.height = H;
  const l = lit.getContext("2d")!;
  l.drawImage(img, 0, 0);
  l.drawImage(img, 0, BLANK_Y * s, W, r.h, 0, r.y, W, r.h);
  l.shadowColor = "rgba(255,90,18,.8)";
  l.shadowBlur = GLOW * s;
  l.drawImage(glyphs, r.x, r.y);

  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d")!;
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = art.flipY;
  tex.colorSpace = art.colorSpace;
  tex.anisotropy = art.anisotropy;

  return {
    tex,
    draw(k) {
      ctx.globalAlpha = 1;
      ctx.drawImage(img, 0, 0);
      ctx.globalAlpha = k;
      ctx.drawImage(lit, 0, 0);
      tex.needsUpdate = true;
    },
    dispose: () => tex.dispose(),
  };
}
