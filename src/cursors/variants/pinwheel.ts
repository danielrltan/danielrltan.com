import { CHAR, DEEP, ORANGE, WHITE, damp, hotspot, layerCanvas, spring, type CursorInfo } from "../kit";

/**
 * 7 · Pinwheel. A four-vane paper pinwheel on a stick, its pin on the exact
 * point. Real 3D folds (each vane's tip curls toward you; painter-sorted,
 * perspective) on a slight three-quarter tilt. Your speed is the wind: it
 * spins up quickly when pushed and coasts down slowly on friction, so a flick
 * keeps it whirring after you stop (motion-blur disc at speed). Over a button
 * it swings square to face it and blushes orange; over text it turns
 * edge-on; holding the button brakes it; releasing flicks it hard.
 */
export const pinwheel: CursorInfo = {
  id: 7,
  name: "Pinwheel",
  family: "3D",
  blurb:
    "A four-vane paper pinwheel pinned on the point, spun by your speed with real inertia (it coasts down long after a flick); it turns square to a button, edge-on over text, brakes while held and whirls on release.",
  create(env, reduced) {
    const cv = layerCanvas(env.layer);
    let phi = 0.3;
    let w = 0;
    const rx = { x: 0.38, v: 0 };
    const ry = { x: -0.5, v: 0 };
    const blush = { x: 0, v: 0 };

    return {
      frame(s) {
        const { ctx } = cv;
        cv.clear();
        const dt = s.dt;
        let busy = false;
        const kind = s.hover.kind;
        if (!reduced) {
          const push = s.speed / 38;
          if (s.down) w = damp(w, 0, 9, dt);
          else if (push > w) w = damp(w, push, 5, dt);
          else w = damp(w, 0, 0.55, dt);
          if (s.released) w += 32;
          phi += w * dt;
          if (w > 0.05) busy = true;
          else w = 0;
        }
        busy = spring(rx, kind === "click" ? 0 : 0.38, dt, 150, 0.55) || busy;
        busy = spring(ry, kind === "click" ? 0 : kind === "text" || kind === "input" ? 1.42 : -0.5, dt, 150, 0.55) || busy;
        busy = spring(blush, kind === "click" ? 1 : 0, dt, 200, 0.8) || busy;

        const R = 17;
        const cxr = Math.cos(rx.x), sxr = Math.sin(rx.x), cyr = Math.cos(ry.x), syr = Math.sin(ry.x);
        const F = 220;
        const P = (x: number, y: number, z: number): [number, number, number] => {
          const x1 = x * cyr + z * syr, z1 = -x * syr + z * cyr;
          const y2 = y * cxr - z1 * sxr, z2 = y * sxr + z1 * cxr;
          const k = F / (F - z2);
          return [s.x + x1 * k, s.y + y2 * k, z2];
        };
        // stick, behind everything
        const st = P(0, 0, -2), sb = P(10, 30, -2);
        ctx.lineCap = "round";
        ctx.strokeStyle = WHITE;
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.moveTo(st[0], st[1]);
        ctx.lineTo(sb[0], sb[1]);
        ctx.stroke();
        ctx.strokeStyle = CHAR;
        ctx.lineWidth = 2.2;
        ctx.stroke();

        // blur disc at speed
        if (w > 8) {
          ctx.globalAlpha = Math.min(0.3, (w - 8) / 60);
          ctx.fillStyle = s.surface === "orange" ? WHITE : ORANGE;
          ctx.beginPath();
          const c = P(0, 0, 0), e1 = P(R, 0, 0), e2 = P(0, R, 0);
          ctx.ellipse(c[0], c[1], Math.hypot(e1[0] - c[0], e1[1] - c[1]), Math.hypot(e2[0] - c[0], e2[1] - c[1]), 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        type Tri = { p: [number, number, number][]; fill: string };
        const tris: Tri[] = [];
        for (let i = 0; i < 4; i++) {
          const a = phi + (i * Math.PI) / 2;
          const ca = Math.cos(a), sa = Math.sin(a);
          const rot = (x: number, y: number, z: number) => P(x * ca - y * sa, x * sa + y * ca, z);
          const O = rot(0, 0, 1.5);
          const C1 = rot(R, 0, 0);
          const C2 = rot(R * 0.4, R * 0.42, 7); // curled tip, toward you
          const C3 = rot(R * 0.05, R * 0.72, 0);
          const sail = i % 2 ? (blush.x > 0.5 ? ORANGE : WHITE) : blush.x > 0.5 ? WHITE : ORANGE;
          const fold = i % 2 ? "#ffd2b4" : DEEP;
          tris.push({ p: [O, C2, C3], fill: fold });
          tris.push({ p: [O, C1, C2], fill: sail });
        }
        tris.sort((a, b) => (a.p[0][2] + a.p[1][2] + a.p[2][2]) - (b.p[0][2] + b.p[1][2] + b.p[2][2]));
        ctx.lineJoin = "round";
        for (const t of tris) {
          ctx.beginPath();
          ctx.moveTo(t.p[0][0], t.p[0][1]);
          ctx.lineTo(t.p[1][0], t.p[1][1]);
          ctx.lineTo(t.p[2][0], t.p[2][1]);
          ctx.closePath();
          ctx.fillStyle = t.fill;
          ctx.fill();
          ctx.strokeStyle = CHAR;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        hotspot(ctx, s.x, s.y, 3);
        return busy;
      },
      destroy() {
        cv.destroy();
      },
    };
  },
};
