import { CHAR, ORANGE, WHITE, clamp01, hotspot, layerCanvas, type CursorInfo } from "../kit";

/**
 * 17 · Fountain pen. A broad italic nib held at a fixed 40° writes as you
 * move: each stroke segment is the sweep of the nib's edge (a true quad), so
 * the ink is thick on down-strokes and hairline along the nib, exactly like
 * calligraphy; speed starves the nib thinner. Wet ink is glossy charcoal, then
 * dries to deep orange and fades. Over a button the pen signs a flourish
 * under its real bottom edge. Holding the button pools a ragged blot that
 * spreads with time held and dries like the rest.
 */
const NIB = (-40 * Math.PI) / 180;
const NX = Math.cos(NIB), NY = Math.sin(NIB);
const LIFE = 2.6;
type Seg = { x0: number; y0: number; x1: number; y1: number; h0: number; h1: number; age: number };
type Blot = { x: number; y: number; r: number; seed: number; age: number };

function inkColor(age: number) {
  // wet charcoal → dry deep orange, then fade
  const d = clamp01((age - 0.35) / 0.9);
  const r = Math.round(27 + (194 - 27) * d), g = Math.round(27 + (61 - 27) * d), b = Math.round(31 + (0 - 31) * d);
  const a = 1 - clamp01((age - 1.2) / (LIFE - 1.2));
  return `rgba(${r},${g},${b},${a.toFixed(3)})`;
}

export const pen: CursorInfo = {
  id: 17,
  name: "Fountain pen",
  family: "pixel",
  blurb:
    "A broad italic nib that writes as you move (thick down-strokes, hairline across, thinner when fast); the ink dries to orange and fades, it signs a flourish under any button you hover, and holding pools a blot.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const segs: Seg[] = [];
    const blots: Blot[] = [];
    let last: { x: number; y: number; h: number } | null = null;
    let blot: Blot | null = null;
    let flourish: { pts: { x: number; y: number }[]; i: number } | null = null;
    let flourishFor: Element | null = null;

    const push = (x: number, y: number, h: number) => {
      if (last && Math.hypot(x - last.x, y - last.y) > 0.5) segs.push({ x0: last.x, y0: last.y, x1: x, y1: y, h0: last.h, h1: h, age: 0 });
      last = { x, y, h };
    };

    const blotPath = (ctx: CanvasRenderingContext2D, b: Blot) => {
      ctx.beginPath();
      for (let i = 0; i <= 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const wob = 1 + 0.16 * Math.sin(a * 3 + b.seed) + 0.09 * Math.sin(a * 7 + b.seed * 2.3);
        const x = b.x + Math.cos(a) * b.r * wob, y = b.y + Math.sin(a) * b.r * wob;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.closePath();
    };

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        // Pen lifts after a pause or a teleport.
        if (s.idle > 0.25 || !s.inside) last = null;
        const hw = 5.5 * Math.max(0.42, Math.min(1, 1.15 - s.speed / 2600));
        if (s.idle < 0.25 && s.inside) push(s.x, s.y, hw);

        // Flourish under a newly hovered button: a wave + an end loop.
        if (s.hover.kind === "click" && s.hover.box && s.hover.el !== flourishFor) {
          flourishFor = s.hover.el;
          const b = s.hover.box;
          const pts: { x: number; y: number }[] = [];
          const y0 = b.y + b.h + 7;
          const n = 34;
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            pts.push({ x: b.x - 6 + (b.w + 12) * t, y: y0 + Math.sin(t * Math.PI * 2) * 2.5 - t * 3 });
          }
          const ex = b.x + b.w + 6, ey = y0 - 3;
          for (let i = 1; i <= 16; i++) {
            const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
            pts.push({ x: ex + 5 + Math.cos(a) * 6, y: ey + 6 + Math.sin(a) * 6 });
          }
          flourish = { pts, i: 0 };
        }
        if (!s.hover.el) flourishFor = null;
        if (flourish) {
          const per = reduced ? flourish.pts.length : Math.max(1, Math.round(dt * 150));
          for (let k = 0; k < per && flourish.i < flourish.pts.length - 1; k++, flourish.i++) {
            const a = flourish.pts[flourish.i], b = flourish.pts[flourish.i + 1];
            segs.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, h0: 3.6, h1: 3.6, age: 0 });
          }
          if (flourish.i >= flourish.pts.length - 1) flourish = null;
        }

        // Blot while held; it dries once released.
        if (s.pressed) blot = { x: s.x, y: s.y, r: 2, seed: Math.random() * 6, age: 0 };
        if (blot) {
          blot.x = s.x;
          blot.y = s.y;
          blot.r = 4 + Math.min(1, s.held / 0.7) * 16;
          if (!s.down) {
            blots.push(blot);
            blot = null;
          }
        }

        // Ink: quads swept by the nib edge, plus a hairline spine.
        for (let i = segs.length - 1; i >= 0; i--) {
          const g = segs[i];
          g.age += dt;
          if (g.age > LIFE) segs.splice(i, 1);
        }
        for (const g of segs) {
          ctx.fillStyle = inkColor(g.age);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.beginPath();
          ctx.moveTo(g.x0 + NX * g.h0, g.y0 + NY * g.h0);
          ctx.lineTo(g.x1 + NX * g.h1, g.y1 + NY * g.h1);
          ctx.lineTo(g.x1 - NX * g.h1, g.y1 - NY * g.h1);
          ctx.lineTo(g.x0 - NX * g.h0, g.y0 - NY * g.h0);
          ctx.closePath();
          ctx.fill();
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(g.x0, g.y0);
          ctx.lineTo(g.x1, g.y1);
          ctx.stroke();
        }
        for (let i = blots.length - 1; i >= 0; i--) {
          const b = blots[i];
          b.age += dt;
          if (b.age > LIFE) {
            blots.splice(i, 1);
            continue;
          }
          ctx.fillStyle = inkColor(b.age);
          blotPath(ctx, b);
          ctx.fill();
        }
        if (blot) {
          ctx.fillStyle = CHAR;
          blotPath(ctx, blot);
          ctx.fill();
          // wet gloss
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.beginPath();
          ctx.ellipse(blot.x - blot.r * 0.35, blot.y - blot.r * 0.4, blot.r * 0.3, blot.r * 0.16, -0.6, 0, Math.PI * 2);
          ctx.fill();
        }

        // The nib: tip on the hotspot, body up and to the right; more upright
        // over text (a pen poised to edit).
        const tilt = s.hover.kind === "text" || s.hover.kind === "input" ? -0.25 : -0.78;
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(tilt);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(5.5, -11);
        ctx.lineTo(5.5, -21);
        ctx.quadraticCurveTo(0, -25, -5.5, -21);
        ctx.lineTo(-5.5, -11);
        ctx.closePath();
        ctx.lineWidth = 3;
        ctx.strokeStyle = WHITE;
        ctx.stroke();
        ctx.fillStyle = CHAR;
        ctx.fill();
        ctx.fillStyle = s.surface === "orange" ? WHITE : ORANGE;
        ctx.fillRect(-5.5, -21, 11, 3);
        ctx.strokeStyle = WHITE;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -1.5);
        ctx.lineTo(0, -10);
        ctx.stroke();
        ctx.fillStyle = WHITE;
        ctx.beginPath();
        ctx.arc(0, -11.5, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        hotspot(ctx, s.x, s.y, 2);
        return segs.length > 0 || blots.length > 0 || !!blot || !!flourish;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
