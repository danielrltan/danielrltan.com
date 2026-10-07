import * as THREE from "three";

/**
 * "copied!" on the keypad OLED. Clicking the screen copies the email and the
 * display flickers over to an envelope + "copied!", holds, then flickers back
 * to the "Let's connect" art. Values are the owner's picks from the Copied
 * Popup Tuner (2026-10-07, .scratch/copied-lab): on-the-screen only.
 *
 * The frame is drawn into a CanvasTexture that KeypadModel swaps onto the
 * display material's map, so it gets the glass's perspective and lighting.
 * Sizes are in glass-local units: REF_W x REF_H spans the whole glass
 * (1.3 x 0.8 world, the same aspect as the 1000x616 display.png).
 */
export const COPIED = {
  email: "hello@danielrltan.com",
  text: "copied!",
  size: 32, // text px in glass units
  hold: 1.4, // seconds before the address flickers back
  bump: 0.75, // keypad hop, as a fraction of the knob-press wobble
};

const REF_W = 179;
const REF_H = 110;
const TEX_W = 1000;
const TEX_H = 616;
const FLICKER_IN = 0.14;
const FLICKER_OUT = 0.16;

// 13 x 9 envelope: a solid body with the flap's V cut out of it.
const ENVELOPE: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let y = 0; y < 9; y++)
    for (let x = 0; x < 13; x++) {
      const v = Math.round(Math.abs(x - 6) * (5 / 6));
      if (y > 0 && y < 8 && x > 0 && x < 12 && y === 5 - v) continue;
      out.push([x - 6.5, y - 4.5]);
    }
  return out;
})();

let fontReady: Promise<unknown> | null = null;
/** Offbit has to be loaded before the canvas draws with it. */
export function loadCopiedFont() {
  fontReady ??= document.fonts.load(`700 ${COPIED.size}px "Offbit"`).catch(() => {});
  return fontReady;
}

/** The "copied!" display frame as a texture laid out like display.png. */
export function makeCopiedTexture(): THREE.CanvasTexture {
  const cv = document.createElement("canvas");
  cv.width = TEX_W;
  cv.height = TEX_H;
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false; // glTF UVs
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  drawCopied(cv.getContext("2d")!);
  tex.needsUpdate = true;
  return tex;
}

function drawCopied(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#060607";
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.save();
  ctx.scale(TEX_W / REF_W, TEX_H / REF_H);
  ctx.beginPath();
  ctx.roundRect(5, 5, REF_W - 10, REF_H - 10, 6);
  ctx.clip(); // long text never spills past the art's margin

  const f = COPIED.size;
  ctx.font = `700 ${f}px Offbit, monospace`;
  const tw = ctx.measureText(COPIED.text).width;
  const cell = (f * 0.7) / 9;
  const iw = 13 * cell;
  const gap = f * 0.32;
  const x0 = REF_W / 2 - (iw + gap + tw) / 2;
  const cy = REF_H / 2;
  // OLED glow (shadowBlur is in canvas px, not transformed units)
  ctx.shadowColor = "rgba(255,255,255,.75)";
  ctx.shadowBlur = 17;
  ctx.fillStyle = "#f2f2f2";
  for (const [x, y] of ENVELOPE) ctx.fillRect(x0 + iw / 2 + x * cell, cy + y * cell, cell * 0.86, cell * 0.86);
  ctx.textBaseline = "middle";
  ctx.fillText(COPIED.text, x0 + iw + gap, cy + f * 0.04);
  ctx.shadowBlur = 0;
  // scanlines, like display.png
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "#000";
  for (let y = 6; y < REF_H - 6; y += 2.6) ctx.fillRect(5, y, REF_W - 10, 0.9);
  ctx.restore();
}

/**
 * Whether the copied frame shows `t` seconds after the click: steady for
 * COPIED.hold, strobing against the original art at both edges (no strobe
 * with reduced motion). null once it's over.
 */
export function copiedVisible(t: number, reduced: boolean): boolean | null {
  const end = COPIED.hold;
  if (t > end + FLICKER_OUT) return null;
  if (reduced) return t <= end;
  const strobe = (k: number) => Math.floor(k * 7) % 2 === 0;
  if (t < FLICKER_IN) return strobe(t / FLICKER_IN);
  if (t > end) return strobe((t - end) / FLICKER_OUT) && (t - end) / FLICKER_OUT < 0.85;
  return true;
}
