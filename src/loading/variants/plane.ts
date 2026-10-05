import { fmtSec } from "../loadStats";
import { clamp01, clock, el, hostCanvas, inCubic, inOutCubic, poly, textSlot, type VariantInfo } from "./shared";

/**
 * 11 · Paper plane. A sheet folds itself into a dart, crease by crease, as
 * the load climbs: nose corners fold in, the sheet folds in half along the
 * keel, the wings fold out, and the camera swings round to a three-quarter
 * view. Real geometry: every piece of paper is a polygon carried through its
 * hinge rotations (Rodrigues for the diagonal corner folds), projected and
 * painter-sorted. The exit throws it: it flies off over the revealing hero
 * trailing a pixel dash line while the orange field fades away under it.
 */
type V = [number, number, number]; // (x, h, y): sheet x, height above sheet, sheet length

const CREASE = 0.35;
const NOSE = 3;
// Pieces after the corner fold, LEFT half (x <= 0); the right half mirrors.
const KEEL: [number, number][] = [[0, 0], [-CREASE, 0], [-CREASE, NOSE - CREASE], [0, NOSE]];
const WING: [number, number][] = [[-CREASE, 0], [-1, 0], [-1, 2], [-CREASE, NOSE - CREASE]];
const KEEL_FLAP: [number, number][] = [[0, NOSE], [-CREASE, NOSE - CREASE], [-CREASE, 2], [0, 2]];
const WING_FLAP: [number, number][] = [[-CREASE, NOSE - CREASE], [-1, 2], [-CREASE, 2]];
// Before it: the body and the corner triangle that folds over.
const BODY: [number, number][] = [[-1, 0], [0, 0], [0, NOSE], [-1, 2]];
const CORNER: [number, number][] = [[-1, 2], [0, NOSE], [-1, NOSE]];

const span = (p: number, a: number, b: number) => inOutCubic(clamp01((p - a) / (b - a)));

/** Rotate v about the axis through a with unit direction u by th. */
function rodrigues(v: V, a: V, u: V, th: number): V {
  const d: V = [v[0] - a[0], v[1] - a[1], v[2] - a[2]];
  const c = Math.cos(th), s = Math.sin(th);
  const dot = u[0] * d[0] + u[1] * d[1] + u[2] * d[2];
  const cx: V = [u[1] * d[2] - u[2] * d[1], u[2] * d[0] - u[0] * d[2], u[0] * d[1] - u[1] * d[0]];
  return [
    a[0] + d[0] * c + cx[0] * s + u[0] * dot * (1 - c),
    a[1] + d[1] * c + cx[1] * s + u[1] * dot * (1 - c),
    a[2] + d[2] * c + cx[2] * s + u[2] * dot * (1 - c),
  ];
}

export const plane: VariantInfo = {
  id: 11,
  name: "Paper plane",
  ownsExit: true,
  create(host, reduced) {
    const cv = hostCanvas(host);
    const root = el("div", "ldr-plane", host);
    const pct = textSlot(el("div", "ldr-plane__pct", root));
    const time = textSlot(el("div", "ldr-plane__time", root));
    const tick = clock();
    let t = 0;
    const trail: [number, number][] = [];

    return {
      frame(now, p, n, s, exit) {
        const dt = tick(now);
        t += reduced ? 0 : dt;
        const P = n >= 100 ? 1 : p;
        const cL = span(P, 0.0, 0.2), cR = span(P, 0.12, 0.32);
        const k = span(P, 0.38, 0.64) * 1.42;
        const wg = span(P, 0.68, 0.92) * 1.42;
        const view = span(P, 0.55, 1);
        const e = Math.min(1, exit);

        // Pieces as 3D polygons in (x, h, y), left half then mirrored.
        const pieces: { pts: V[]; flap: boolean }[] = [];
        const fold = (x: number, h: number, isWing: boolean): [number, number] => {
          if (isWing) {
            const dx = x + CREASE;
            const nx = dx * Math.cos(wg) - h * Math.sin(wg);
            const nh = dx * Math.sin(wg) + h * Math.cos(wg);
            x = nx - CREASE;
            h = nh;
          }
          // keel: the half swings up about the centre line
          return [x * Math.cos(-k) - h * Math.sin(-k), x * Math.sin(-k) + h * Math.cos(-k)];
        };
        for (const side of [1, -1]) {
          const cornerT = side === 1 ? cL : cR;
          const mir = (v: V): V => [v[0] * side, v[1], v[2]];
          if (cornerT < 1) {
            pieces.push({ pts: BODY.map(([x, y]) => mir([x, 0, y])), flap: false });
            const a: V = [0, 0, NOSE];
            const u: V = [-Math.SQRT1_2, 0, -Math.SQRT1_2];
            pieces.push({
              pts: CORNER.map(([x, y]) => mir(rodrigues([x, 0, y], a, u, cornerT * Math.PI * 0.995))),
              flap: true,
            });
          } else {
            for (const [shape, isWing, flap] of [[KEEL, false, false], [WING, true, false], [KEEL_FLAP, false, true], [WING_FLAP, true, true]] as const) {
              pieces.push({
                pts: shape.map(([x, y]) => {
                  const [fx, fh] = fold(x, flap ? 0.012 : 0, isWing);
                  return mir([fx, fh, y]);
                }),
                flap,
              });
            }
          }
        }

        const { ctx, box } = cv;
        const { w, h } = box;
        // Camera: top-down on the sheet, swinging to a 3/4 view of the dart.
        const yaw = -0.95 * view + (reduced ? 0 : Math.sin(t * 0.8) * 0.06);
        const pitch = 1.25 - 0.85 * view;
        const roll = Math.sin(t * 1.3) * 0.05 * view;
        const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
        const dist = 9;
        const scale = Math.min(w, h * 1.1) * 0.42 * dist / 3;
        // Flight: forward along the nose, climbing, away from camera.
        const fe = inCubic(e);
        const fly: V = [0, fe * 2.4 + Math.sin(t * 2) * 0.05 * view, fe * 14];
        const cx = w / 2, cy = h * 0.42;
        const project = (v: V): [number, number, number] => {
          // centre the sheet, pitch the nose up a little when flying
          let x = v[0], y = v[1], z = v[2] - NOSE / 2;
          const nu = fe * 0.35;
          const y0 = y * Math.cos(nu) + z * Math.sin(nu);
          z = -y * Math.sin(nu) + z * Math.cos(nu);
          y = y0;
          const xr = x * Math.cos(roll) - y * Math.sin(roll);
          y = x * Math.sin(roll) + y * Math.cos(roll);
          x = xr + fly[0]; y += fly[1]; z += fly[2];
          const x1 = x * cyw - z * syw;
          const z1 = x * syw + z * cyw;
          const y2 = y * cp + z1 * sp;
          const z2 = -y * sp + z1 * cp + dist;
          return [cx + (x1 / z2) * scale, cy - (y2 / z2) * scale, z2];
        };

        ctx.clearRect(0, 0, w, h);
        ctx.globalAlpha = 1 - clamp01(e * 1.6);
        ctx.fillStyle = "#ff4f00";
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;

        // Fold guides on the flat sheet.
        if (k < 0.05) {
          ctx.setLineDash([4, 4]);
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 1;
          const guide = (a: V, b: V) => {
            const pa = project(a), pb = project(b);
            ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
          };
          guide([0, 0.02, 0], [0, 0.02, NOSE]);
          guide([-CREASE, 0.02, 0], [-CREASE, 0.02, NOSE - CREASE]);
          guide([CREASE, 0.02, 0], [CREASE, 0.02, NOSE - CREASE]);
          ctx.setLineDash([]);
        }

        // Trail while flying.
        if (exit > 0) {
          const tail = project([0, -0.05, 0]);
          trail.push([tail[0], tail[1]]);
          ctx.fillStyle = "#ffffff";
          trail.forEach(([x, y], i) => {
            if (i % 2) return;
            const q = 2 + (i / trail.length) * 3;
            ctx.globalAlpha = (i / trail.length) * (1 - e * 0.6);
            ctx.fillRect(Math.round(x - q / 2), Math.round(y - q / 2), q, q);
          });
          ctx.globalAlpha = 1;
        }

        const projected = pieces.map((pc) => {
          const pts = pc.pts.map(project);
          const z = pts.reduce((a, q) => a + q[2], 0) / pts.length - (pc.flap ? 0.02 : 0);
          // shade by the screen-space facing (light from upper left)
          const [a, b, c] = pts;
          const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          const area = Math.abs(cross) / (scale * scale * 0.01);
          return { pts, z, light: Math.min(1, 0.55 + area * 0.9) };
        });
        projected.sort((a, b) => b.z - a.z);
        for (const pc of projected) {
          const l = pc.light;
          ctx.fillStyle = `rgb(255,${Math.round(196 + 59 * l)},${Math.round(160 + 95 * l)})`;
          poly(ctx, pc.pts);
          ctx.fill();
          ctx.strokeStyle = "rgba(168,46,0,0.45)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        pct(String(n));
        time(fmtSec(s.elapsedMs));
        root.style.opacity = String(1 - Math.min(1, exit * 4));
      },
      destroy() {
        cv.destroy();
        root.remove();
      },
    };
  },
};
