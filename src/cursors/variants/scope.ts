import { CHAR, WHITE, hotspot, layerCanvas, spring, type CursorInfo } from "../kit";

/**
 * 18 · Oscilloscope. The pointer carries a tiny CRT on a probe lead. Its beam
 * is drawn additively into an offscreen phosphor buffer that decays every
 * frame, so traces glow and smear like a real tube. At rest the beam draws a
 * slowly turning 3:2 Lissajous figure; moving feeds your x and y velocity in
 * as the two signal frequencies, so every gesture has its own figure. Over a
 * button the scope traces the button's own outline (its real aspect ratio);
 * over text it flatlines with a travelling blip. Press collapses the beam to
 * a burning dot; release powers it back on with an overshoot. Long idle, the
 * tube goes dark and the loop parks.
 */
const SW = 78, SH = 56;

export const scope: CursorInfo = {
  id: 18,
  name: "Oscilloscope",
  family: "pixel",
  blurb:
    "A pocket CRT on a probe lead: idle it draws a turning Lissajous, your x/y velocity becomes its signals, it traces a hovered button's outline, flatlines over text, collapses to a dot when pressed, and the phosphor glows and decays like a real tube.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    const ph = document.createElement("canvas");
    const pctx = ph.getContext("2d")!;
    let dpr = 0;
    let tau = 0;
    let phase = 0;
    const amp = { x: 0.8, v: 0 };
    let fa = 3, fb = 2;
    let beam: { x: number; y: number } | null = null;

    // Beam position (-1..1) at time u for the current mode.
    const at = (u: number, mode: string, ar: number) => {
      if (mode === "box") {
        // rounded-rect outline with the button's aspect ratio
        const hw = ar >= 1 ? 1 : ar, hh = ar >= 1 ? 1 / ar : 1;
        const per = 4;
        const t = (((u * 0.6) % per) + per) % per;
        if (t < 1) return { x: -hw + 2 * hw * t, y: -hh };
        if (t < 2) return { x: hw, y: -hh + 2 * hh * (t - 1) };
        if (t < 3) return { x: hw - 2 * hw * (t - 2), y: hh };
        return { x: -hw, y: hh - 2 * hh * (t - 3) };
      }
      if (mode === "flat") {
        const x = ((u * 0.5) % 2) - 1;
        const blip = Math.exp(-Math.pow((x - Math.sin(u * 0.4) * 0.6) * 9, 2));
        return { x, y: -blip * 0.7 };
      }
      return { x: Math.sin(fa * u + phase), y: Math.sin(fb * u) };
    };

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const d = Math.min(2, window.devicePixelRatio || 1);
        if (d !== dpr) {
          dpr = d;
          ph.width = Math.round(SW * dpr);
          ph.height = Math.round(SH * dpr);
          pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          pctx.fillStyle = "#140804";
          pctx.fillRect(0, 0, SW, SH);
        }
        const mode = s.hover.kind === "click" ? "box" : s.hover.kind === "text" || s.hover.kind === "input" ? "flat" : "liss";
        const ar = s.hover.box ? Math.max(0.25, Math.min(4, s.hover.box.w / Math.max(1, s.hover.box.h))) : 1;
        const asleep = s.idle > 4 && !s.down;
        // keep running ~1.5 s after falling asleep so the tube can fade out
        let busy = s.idle < 5.5 || s.down;

        // Signals: velocity drives the frequencies, at rest a slow 3:2.
        if (s.speed > 40) {
          fa += (1 + Math.min(7, Math.abs(s.vx) / 260) - fa) * Math.min(1, s.dt * 6);
          fb += (1 + Math.min(7, Math.abs(s.vy) / 260) - fb) * Math.min(1, s.dt * 6);
        } else {
          fa += (3 - fa) * Math.min(1, s.dt * 2);
          fb += (2 - fb) * Math.min(1, s.dt * 2);
        }
        phase += s.dt * 0.6;
        spring(amp, s.down ? 0 : asleep ? 0 : Math.min(1, 0.72 + s.speed / 3000), s.dt, s.released ? 120 : 220, s.down ? 1 : 0.35);

        // Phosphor: decay, then add the beam.
        pctx.globalCompositeOperation = "source-over";
        pctx.fillStyle = `rgba(20,8,4,${(1 - Math.exp(-s.dt * (asleep ? 2.5 : 7))).toFixed(3)})`;
        pctx.fillRect(0, 0, SW, SH);
        if (!asleep) {
          pctx.globalCompositeOperation = "lighter";
          const steps = reduced ? 240 : 48;
          const span = reduced ? Math.PI * 2 : s.dt * (mode === "box" ? 30 : 15);
          const u0 = reduced ? 0 : tau;
          if (!reduced) tau += span;
          pctx.lineCap = "round";
          for (let i = 0; i < steps; i++) {
            const p = at(u0 + (span * i) / steps, mode, ar);
            const x = SW / 2 + p.x * amp.x * (SW / 2 - 6), y = SH / 2 + p.y * amp.x * (SH / 2 - 6);
            if (beam && Math.hypot(x - beam.x, y - beam.y) < 30) {
              pctx.strokeStyle = "rgba(255,79,0,0.55)";
              pctx.lineWidth = 3;
              pctx.beginPath();
              pctx.moveTo(beam.x, beam.y);
              pctx.lineTo(x, y);
              pctx.stroke();
              pctx.strokeStyle = "rgba(255,210,180,0.5)";
              pctx.lineWidth = 1;
              pctx.stroke();
            }
            beam = { x, y };
          }
          if (s.down) {
            // burning dot
            pctx.fillStyle = `rgba(255,230,210,${Math.min(0.9, 0.3 + s.held)})`;
            pctx.beginPath();
            pctx.arc(SW / 2, SH / 2, 1.5 + Math.min(2.5, s.held * 3), 0, Math.PI * 2);
            pctx.fill();
          }
        }

        // Place the scope down-right of the point (flip at the edges).
        const fx = s.x + 18 + SW + 8 > s.w ? s.x - 18 - SW : s.x + 18;
        const fy = s.y + 16 + SH + 8 > s.h ? s.y - 16 - SH : s.y + 16;
        // probe lead
        ctx.strokeStyle = WHITE;
        ctx.lineWidth = 4;
        ctx.beginPath();
        const ex = fx < s.x ? fx + SW : fx, ey = fy + SH / 2;
        ctx.moveTo(s.x, s.y);
        ctx.bezierCurveTo(s.x, s.y + 18, ex + (fx < s.x ? 14 : -14), ey, ex, ey);
        ctx.stroke();
        ctx.strokeStyle = CHAR;
        ctx.lineWidth = 2;
        ctx.stroke();
        // bezel + screen
        ctx.fillStyle = WHITE;
        ctx.beginPath();
        ctx.roundRect(fx - 2, fy - 2, SW + 4, SH + 4, 9);
        ctx.fill();
        ctx.fillStyle = CHAR;
        ctx.beginPath();
        ctx.roundRect(fx, fy, SW, SH, 7);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(fx + 3, fy + 3, SW - 6, SH - 6, 5);
        ctx.clip();
        ctx.drawImage(ph, 0, 0, ph.width, ph.height, fx, fy, SW, SH);
        // graticule
        ctx.strokeStyle = "rgba(255,79,0,0.22)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 1; i < 4; i++) {
          ctx.moveTo(fx + (SW * i) / 4 + 0.5, fy);
          ctx.lineTo(fx + (SW * i) / 4 + 0.5, fy + SH);
        }
        for (let i = 1; i < 3; i++) {
          ctx.moveTo(fx, fy + (SH * i) / 3 + 0.5);
          ctx.lineTo(fx + SW, fy + (SH * i) / 3 + 0.5);
        }
        ctx.stroke();
        ctx.restore();
        // readout
        ctx.font = "12px VT323, monospace";
        ctx.fillStyle = "rgba(255,180,137,0.85)";
        ctx.textBaseline = "top";
        ctx.fillText(mode === "box" ? `${Math.round(s.hover.box!.w)}:${Math.round(s.hover.box!.h)}` : `${fa.toFixed(1)}:${fb.toFixed(1)}`, fx + 6, fy + 5);
        hotspot(ctx, s.x, s.y, 3);
        if (reduced) busy = false;
        return busy || Math.abs(amp.v) > 1e-3;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
