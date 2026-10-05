import { CHAR, DEEP, ORANGE, WHITE, hotspot, layerCanvas, type CursorInfo } from "../kit";

/**
 * 21 · Iron filings. The cursor is a bar magnet (north orange) and the layer
 * is strewn with iron filings that start unmagnetised (random). Each filing
 * turns toward the real dipole field B = (3(m·r̂)r̂ − m)/r³ of the magnet,
 * faster and longer the closer it is, and KEEPS its orientation once the
 * magnet has gone, so the page remembers where you've been, combed into
 * field lines. The magnet's axis turns with your direction of travel. A
 * hovered button becomes a second magnet the filings wrap around; pressing
 * makes it an electromagnet (stronger reach); releasing flips the polarity
 * and every nearby filing swings round.
 */
const G = 18;
const REACH = 380;

export const filings: CursorInfo = {
  id: 21,
  name: "Iron filings",
  family: "field",
  blurb:
    "The cursor is a magnet: iron filings across the page turn to its real dipole field and stay combed where you've been, a hovered button magnetises too, pressing strengthens it and a click flips the polarity.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    let W = 0, H = 0;
    let X = new Float32Array(0), Y = new Float32Array(0), A = new Float32Array(0), K = new Float32Array(0);
    let mAng = -Math.PI / 2;
    let pol = 1;

    const build = (w: number, h: number) => {
      W = w;
      H = h;
      const cols = Math.ceil(w / G) + 1, rows = Math.ceil(h / G) + 1;
      const n = cols * rows;
      X = new Float32Array(n);
      Y = new Float32Array(n);
      A = new Float32Array(n);
      K = new Float32Array(n);
      let seed = 9;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let j = 0, i = 0; j < rows; j++)
        for (let c = 0; c < cols; c++, i++) {
          X[i] = c * G + (rnd() - 0.5) * G * 0.6;
          Y[i] = j * G + (rnd() - 0.5) * G * 0.6;
          A[i] = rnd() * Math.PI * 2;
        }
    };

    return {
      frame(s) {
        const { ctx } = cv;
        if (Math.abs(s.w - W) > 1 || Math.abs(s.h - H) > 1) build(s.w, s.h);
        cv.clear();
        const dt = s.dt;
        // Magnet axis follows the direction of travel.
        if (s.speed > 80) {
          const want = Math.atan2(s.vy, s.vx);
          let d = want - mAng;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          mAng += d * Math.min(1, dt * 8);
        }
        if (s.released) pol = -pol;
        const strength = s.down ? 2.4 : 1;
        const mx = Math.cos(mAng) * pol, my = Math.sin(mAng) * pol;
        const b = s.hover.kind === "click" ? s.hover.box : null;
        const bx = b ? b.x + b.w / 2 : 0, by = b ? b.y + b.h / 2 : 0;
        const bs = b ? Math.max(b.w, b.h) * 0.5 : 0;

        let maxD = 0;
        const reach = REACH * (s.down ? 1.3 : 1);
        for (let i = 0; i < X.length; i++) {
          const dx = X[i] - s.x, dy = Y[i] - s.y;
          const d2 = dx * dx + dy * dy;
          // Field DIRECTIONS from each magnet, weighted by its local reach.
          let fx = 0, fy = 0, k = 0;
          if (d2 < reach * reach) {
            const d = Math.sqrt(d2) + 8;
            const rx = dx / d, ry = dy / d;
            const dot = mx * rx + my * ry;
            const ux = 3 * dot * rx - mx, uy = 3 * dot * ry - my;
            const ul = Math.hypot(ux, uy) || 1;
            k = Math.min(1, Math.pow((90 * strength) / d, 2));
            fx += (ux / ul) * k;
            fy += (uy / ul) * k;
          }
          if (b) {
            const ex = X[i] - bx, ey = Y[i] - by;
            const d = Math.hypot(ex, ey) + 6;
            if (d < bs * 3.2) {
              const rx = ex / d, ry = ey / d;
              const dot = pol * rx;
              const ux = 3 * dot * rx - pol, uy = 3 * dot * ry;
              const ul = Math.hypot(ux, uy) || 1;
              const kb = Math.min(1, Math.pow((bs * 1.3) / d, 2));
              fx += (ux / ul) * kb * 1.5;
              fy += (uy / ul) * kb * 1.5;
              k = Math.max(k, kb);
            }
          }
          K[i] += (k - K[i]) * Math.min(1, dt * 6);
          if (k < 0.004) continue;
          const want = Math.atan2(fy, fx);
          let delta = want - A[i];
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          const step = reduced ? delta : delta * Math.min(1, dt * (2 + 16 * k));
          A[i] += step;
          if (Math.abs(step) > maxD) maxD = Math.abs(step);
        }

        // Draw in batches: three alpha bands × south (charcoal) / north (deep).
        const south = [new Path2D(), new Path2D(), new Path2D()];
        const north = [new Path2D(), new Path2D(), new Path2D()];
        for (let i = 0; i < X.length; i++) {
          const k = K[i];
          const band = k > 0.35 ? 0 : k > 0.06 ? 1 : 2;
          const half = 2.5 + 4.5 * Math.min(1, k * 1.5);
          const c = Math.cos(A[i]) * half, sn = Math.sin(A[i]) * half;
          south[band].moveTo(X[i] - c, Y[i] - sn);
          south[band].lineTo(X[i], Y[i]);
          north[band].moveTo(X[i], Y[i]);
          north[band].lineTo(X[i] + c, Y[i] + sn);
        }
        const alphas = [0.9, 0.42, 0.12];
        ctx.lineCap = "round";
        for (let k = 2; k >= 0; k--) {
          ctx.globalAlpha = alphas[k];
          ctx.lineWidth = k === 0 ? 1.9 : 1.4;
          ctx.strokeStyle = CHAR;
          ctx.stroke(south[k]);
          ctx.strokeStyle = DEEP;
          ctx.stroke(north[k]);
        }
        ctx.globalAlpha = 1;

        // The magnet: a bar along the axis, north end orange.
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(mAng + (pol < 0 ? Math.PI : 0));
        ctx.fillStyle = WHITE;
        ctx.fillRect(-12, -4.5, 24, 9);
        ctx.fillStyle = CHAR;
        ctx.fillRect(-11, -3.5, 11, 7);
        ctx.fillStyle = s.surface === "orange" ? WHITE : ORANGE;
        ctx.fillRect(0, -3.5, 11, 7);
        ctx.fillStyle = s.surface === "orange" ? DEEP : WHITE;
        ctx.fillRect(7, -1, 2, 2);
        ctx.restore();
        hotspot(ctx, s.x, s.y, 2);
        return maxD > 0.002;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
