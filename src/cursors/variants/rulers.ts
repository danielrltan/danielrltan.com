import { CHAR, ORANGE, WHITE, damp, hotspot, layerCanvas, type Box, type CursorInfo } from "../kit";

/**
 * 24 · Rulers. A designer's measuring cursor. Hairline guides run to the
 * layer edges with live x / y chips, and fast moves leave a few fading ghost
 * guides like ruler ticks. On hover it measures the REAL element: dashed
 * outline, W and H dimension lines, and red-line distances from each edge to
 * its parent's (Figma's alt-hover); over text it also reads the type
 * (size / line-height). Press-and-drag draws a marquee with its own W×H.
 * Idle, the long guides fade so only the crosshair stays.
 */
export const rulers: CursorInfo = {
  id: 24,
  name: "Rulers",
  family: "field",
  blurb:
    "A designer's measuring cursor: hairline guides with live coordinates, the hovered element's width, height and distances to its parent's edges, type specs over text, and drag-to-measure.",
  create(env) {
    const cv = layerCanvas(env.layer);
    let guideA = 1;
    const ghosts: { x: number; y: number; a: number }[] = [];
    let lastGhost = { x: 0, y: 0 };
    let drag: { x: number; y: number } | null = null;
    let frozen: { b: Box; a: number } | null = null;
    let parentBox: Box | null = null;
    let typeSpec = "";
    let prevEl: Element | null = null;

    const chip = (ctx: CanvasRenderingContext2D, x: number, y: number, txt: string, bg = CHAR, fg = WHITE, align: "l" | "c" | "r" = "c") => {
      ctx.font = "15px VT323, monospace";
      const w = Math.ceil(ctx.measureText(txt).width) + 8;
      const lx = align === "c" ? x - w / 2 : align === "r" ? x - w : x;
      ctx.fillStyle = bg;
      ctx.fillRect(Math.round(lx), Math.round(y - 8), w, 16);
      ctx.fillStyle = fg;
      ctx.textBaseline = "middle";
      ctx.fillText(txt, Math.round(lx + 4), Math.round(y + 0.5));
    };
    const dimLine = (ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, col: string) => {
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0 + 0.5, y0 + 0.5);
      ctx.lineTo(x1 + 0.5, y1 + 0.5);
      ctx.stroke();
      // end caps
      const vert = x0 === x1;
      ctx.beginPath();
      if (vert) {
        ctx.moveTo(x0 - 3, y0 + 0.5); ctx.lineTo(x0 + 4, y0 + 0.5);
        ctx.moveTo(x1 - 3, y1 + 0.5); ctx.lineTo(x1 + 4, y1 + 0.5);
      } else {
        ctx.moveTo(x0 + 0.5, y0 - 3); ctx.lineTo(x0 + 0.5, y0 + 4);
        ctx.moveTo(x1 + 0.5, y1 - 3); ctx.lineTo(x1 + 0.5, y1 + 4);
      }
      ctx.stroke();
    };

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const { x, y, w, h } = s;
        const orange = s.surface === "orange";
        const hair = orange ? "rgba(255,255,255,0.75)" : "rgba(27,27,31,0.38)";
        let busy = false;

        guideA = damp(guideA, s.idle > 1.6 ? 0 : 1, 6, s.dt);
        if (Math.abs(guideA - (s.idle > 1.6 ? 0 : 1)) > 0.01) busy = true;

        // Ghost guides at speed: a tick every ~28 px travelled.
        if (s.speed > 600 && Math.hypot(x - lastGhost.x, y - lastGhost.y) > 28) {
          ghosts.push({ x, y, a: 0.7 });
          lastGhost = { x, y };
        }
        ctx.lineWidth = 1;
        for (let i = ghosts.length - 1; i >= 0; i--) {
          const g = ghosts[i];
          g.a -= s.dt * 2.4;
          if (g.a <= 0) {
            ghosts.splice(i, 1);
            continue;
          }
          ctx.strokeStyle = orange ? `rgba(255,255,255,${g.a * 0.5})` : `rgba(255,79,0,${g.a * 0.55})`;
          ctx.beginPath();
          ctx.moveTo(Math.round(g.x) + 0.5, 0); ctx.lineTo(Math.round(g.x) + 0.5, h);
          ctx.moveTo(0, Math.round(g.y) + 0.5); ctx.lineTo(w, Math.round(g.y) + 0.5);
          ctx.stroke();
          busy = true;
        }

        // Guides to the edges (gap around the point), coordinate chips.
        if (guideA > 0.01) {
          ctx.globalAlpha = guideA;
          ctx.strokeStyle = hair;
          ctx.beginPath();
          const X = Math.round(x) + 0.5, Y = Math.round(y) + 0.5;
          ctx.moveTo(X, 0); ctx.lineTo(X, y - 10);
          ctx.moveTo(X, y + 10); ctx.lineTo(X, h);
          ctx.moveTo(0, Y); ctx.lineTo(x - 10, Y);
          ctx.moveTo(x + 10, Y); ctx.lineTo(w, Y);
          ctx.stroke();
          chip(ctx, Math.min(w - 30, Math.max(30, x)), 10, `x ${Math.round(x)}`);
          chip(ctx, 4, Math.min(h - 10, Math.max(10, y)), `y ${Math.round(y)}`, CHAR, WHITE, "l");
          ctx.globalAlpha = 1;
        }
        // Short crosshair, always.
        ctx.strokeStyle = orange ? WHITE : CHAR;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, y - 9); ctx.lineTo(Math.round(x) + 0.5, y - 4);
        ctx.moveTo(Math.round(x) + 0.5, y + 4); ctx.lineTo(Math.round(x) + 0.5, y + 9);
        ctx.moveTo(x - 9, Math.round(y) + 0.5); ctx.lineTo(x - 4, Math.round(y) + 0.5);
        ctx.moveTo(x + 4, Math.round(y) + 0.5); ctx.lineTo(x + 9, Math.round(y) + 0.5);
        ctx.stroke();

        // Hovered element: measure it against its parent.
        const el = s.hover.el;
        if (el !== prevEl) {
          prevEl = el;
          parentBox = el && el.parentElement ? env.boxOf(el.parentElement) : null;
          typeSpec = "";
          if (el && (s.hover.kind === "text" || s.hover.kind === "input")) {
            const cs = getComputedStyle(el);
            const lh = cs.lineHeight === "normal" ? "normal" : String(Math.round(parseFloat(cs.lineHeight)));
            typeSpec = `${Math.round(parseFloat(cs.fontSize))}/${lh} ${cs.fontWeight}`;
          }
        } else if (el && el.parentElement) parentBox = env.boxOf(el.parentElement);
        const b = s.hover.box;
        if (b && !drag) {
          const red = "#ff2d55";
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = ORANGE;
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5, Math.round(b.w), Math.round(b.h));
          ctx.setLineDash([]);
          // W above, H to the right
          dimLine(ctx, Math.round(b.x), Math.round(b.y - 10), Math.round(b.x + b.w), Math.round(b.y - 10), ORANGE);
          chip(ctx, b.x + b.w / 2, b.y - 10, `${Math.round(b.w)}`, ORANGE);
          dimLine(ctx, Math.round(b.x + b.w + 10), Math.round(b.y), Math.round(b.x + b.w + 10), Math.round(b.y + b.h), ORANGE);
          chip(ctx, b.x + b.w + 12, b.y + b.h / 2, `${Math.round(b.h)}`, ORANGE, WHITE, "l");
          // distances to the parent's edges
          const pb = parentBox;
          if (pb) {
            const mid = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
            const gaps: [number, number, number, number, number][] = [
              [b.x, mid.y, pb.x, mid.y, b.x - pb.x],
              [b.x + b.w, mid.y, pb.x + pb.w, mid.y, pb.x + pb.w - b.x - b.w],
              [mid.x, b.y, mid.x, pb.y, b.y - pb.y],
              [mid.x, b.y + b.h, mid.x, pb.y + pb.h, pb.y + pb.h - b.y - b.h],
            ];
            for (const [x0, y0, x1, y1, d] of gaps) {
              if (d < 4) continue;
              dimLine(ctx, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), red);
              chip(ctx, (x0 + x1) / 2, (y0 + y1) / 2, `${Math.round(d)}`, red);
            }
          }
          if (typeSpec) chip(ctx, b.x, b.y + b.h + 12, typeSpec, CHAR, WHITE, "l");
          const tag = (el?.tagName || "").toLowerCase();
          if (tag) chip(ctx, b.x, b.y - 26, `<${tag}>`, CHAR, WHITE, "l");
        }

        // Drag-to-measure marquee.
        if (s.pressed) drag = { x, y };
        if (drag) {
          const mb: Box = { x: Math.min(drag.x, x), y: Math.min(drag.y, y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y), r: 0 };
          if (s.released) {
            if (mb.w > 3 || mb.h > 3) frozen = { b: mb, a: 1 };
            drag = null;
          } else {
            ctx.fillStyle = "rgba(255,79,0,0.08)";
            ctx.fillRect(mb.x, mb.y, mb.w, mb.h);
            ctx.strokeStyle = ORANGE;
            ctx.strokeRect(Math.round(mb.x) + 0.5, Math.round(mb.y) + 0.5, Math.round(mb.w), Math.round(mb.h));
            if (mb.w > 3 || mb.h > 3) chip(ctx, mb.x + mb.w / 2, mb.y + mb.h + 12, `${Math.round(mb.w)} × ${Math.round(mb.h)}`, ORANGE);
            busy = true;
          }
        }
        if (frozen) {
          frozen.a -= s.dt * 1.2;
          if (frozen.a <= 0) frozen = null;
          else {
            ctx.globalAlpha = frozen.a;
            const fb = frozen.b;
            ctx.strokeStyle = ORANGE;
            ctx.strokeRect(Math.round(fb.x) + 0.5, Math.round(fb.y) + 0.5, Math.round(fb.w), Math.round(fb.h));
            chip(ctx, fb.x + fb.w / 2, fb.y + fb.h + 12, `${Math.round(fb.w)} × ${Math.round(fb.h)}`, ORANGE);
            ctx.globalAlpha = 1;
            busy = true;
          }
        }
        hotspot(ctx, x, y, 2);
        return busy;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
