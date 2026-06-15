import * as THREE from "three";

/**
 * Low-poly thematic icons for the spill (jump) menu — one per section. Each is
 * a FLAT extruded silhouette (a bold icon facing the camera) so it reads
 * clearly under the orange ASCII dither, rather than a tumbling glob of
 * primitives. The spill objects rest facing forward (see NavSpillMenu), so the
 * silhouette is what you see. Normalised to a ~1-unit radius for consistent
 * ring sizing; extruded with real depth so each is still a chunky 3D object.
 *
 *   00 Hero     → house          03 Work    → briefcase
 *   01 About    → question mark   04 Play    → play triangle (▶)
 *   02 Projects → Macintosh       05 Honors  → trophy
 *   06 Contact  → paper airplane
 */

const DEPTH = 0.42;

// Extrude one or more shapes into a flat, centred, radius-normalised icon.
function icon(shapes: THREE.Shape | THREE.Shape[]): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(
    Array.isArray(shapes) ? shapes : [shapes],
    { depth: DEPTH, bevelEnabled: false, steps: 1, curveSegments: 10 },
  );
  g.center();
  g.computeBoundingSphere();
  const r = g.boundingSphere?.radius || 1;
  g.scale(1 / r, 1 / r, 1 / r);
  return g;
}

// A sharp-cornered rectangle path (x,y = bottom-left).
function rect(x: number, y: number, w: number, h: number): THREE.Path {
  const p = new THREE.Path();
  p.moveTo(x, y);
  p.lineTo(x + w, y);
  p.lineTo(x + w, y + h);
  p.lineTo(x, y + h);
  p.closePath();
  return p;
}
function rectShape(x: number, y: number, w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(x, y);
  s.lineTo(x + w, y);
  s.lineTo(x + w, y + h);
  s.lineTo(x, y + h);
  s.closePath();
  return s;
}

export function houseGeom(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.5, -0.45);
  s.lineTo(-0.5, 0.12);
  s.lineTo(0, 0.58); // roof peak
  s.lineTo(0.5, 0.12);
  s.lineTo(0.5, -0.45);
  s.closePath();
  s.holes.push(rect(-0.13, -0.45, 0.26, 0.4)); // door
  return icon(s);
}

export function questionGeom(): THREE.BufferGeometry {
  // A bold "?" : a thick top hook whose tail drops to a centred stem, + a dot.
  const cx = 0;
  const cy = 0.3;
  const ro = 0.4;
  const ri = 0.17;
  const hook = new THREE.Shape();
  // Outer edge: lower-left, up over the top, down the right side to ~bottom.
  hook.absarc(cx, cy, ro, Math.PI * 1.2, -Math.PI * 0.5, true);
  // Tail down to the stem, then back up the inner edge.
  hook.lineTo(ri, -0.06);
  hook.absarc(cx, cy, ri, -Math.PI * 0.5, Math.PI * 1.2, false);
  hook.closePath();
  const dot = rectShape(-0.13, -0.52, 0.26, 0.26);
  return icon([hook, dot]);
}

export function macGeom(): THREE.BufferGeometry {
  // Monitor-on-a-stand silhouette (reads as a computer from the outline alone;
  // internal holes wash out under the dither at ring size).
  const screen = rectShape(-0.5, -0.08, 1.0, 0.72); // monitor
  const neck = rectShape(-0.09, -0.32, 0.18, 0.28); // stand neck
  const base = rectShape(-0.32, -0.46, 0.64, 0.16); // base
  return icon([screen, neck, base]);
}

export function briefcaseGeom(): THREE.BufferGeometry {
  const body = rectShape(-0.55, -0.42, 1.1, 0.74); // case
  // Handle: a small bridge with a hole, sitting on the top edge.
  const handle = rectShape(-0.2, 0.32, 0.4, 0.18);
  handle.holes.push(rect(-0.12, 0.32, 0.24, 0.1));
  return icon([body, handle]);
}

export function playGeom(): THREE.BufferGeometry {
  // ▶ triangle pointing right.
  const s = new THREE.Shape();
  s.moveTo(-0.4, 0.5);
  s.lineTo(0.56, 0);
  s.lineTo(-0.4, -0.5);
  s.closePath();
  return icon(s);
}

export function trophyGeom(): THREE.BufferGeometry {
  // Upright trophy: a wide-rimmed CUP (bowl) at top whose walls curve in to
  // a thin neck → short stem → flared plinth BASE at the bottom. Built top
  // (rim, +Y) to bottom (base, −Y) so it always reads cup-up. Two C-handles
  // hug the bowl's upper sides so it can't be mistaken for a glass/funnel.
  const s = new THREE.Shape();
  s.moveTo(-0.32, 0.56); // rim top-left
  s.lineTo(0.32, 0.56); // rim top-right (wide flat opening)
  // Right bowl wall curves INWARD to the neck (clearly a cup, not a cone).
  s.quadraticCurveTo(0.3, 0.14, 0.08, 0.05);
  s.lineTo(0.08, -0.16); // thin stem, right
  s.lineTo(0.26, -0.34); // flare out to the base
  s.lineTo(0.26, -0.5); // base block, right
  s.lineTo(-0.26, -0.5); // base bottom
  s.lineTo(-0.26, -0.34); // base block, left
  s.lineTo(-0.08, -0.16); // thin stem, left
  s.lineTo(-0.08, 0.05); // neck, left
  s.quadraticCurveTo(-0.3, 0.14, -0.32, 0.56); // left bowl wall up to rim
  s.closePath();
  // C-handles on the upper bowl sides (filled crescents opening toward the
  // cup), centred at the rim height so they read as trophy ears.
  const lh = new THREE.Shape();
  lh.absarc(-0.32, 0.36, 0.18, Math.PI * 0.5, Math.PI * 1.5, false);
  lh.absarc(-0.32, 0.36, 0.1, Math.PI * 1.5, Math.PI * 0.5, true);
  lh.closePath();
  const rh = new THREE.Shape();
  rh.absarc(0.32, 0.36, 0.18, Math.PI * 0.5, Math.PI * 1.5, true);
  rh.absarc(0.32, 0.36, 0.1, Math.PI * 1.5, Math.PI * 0.5, false);
  rh.closePath();
  return icon([s, lh, rh]);
}

export function planeGeom(): THREE.BufferGeometry {
  // Paper-airplane / "send" dart pointing right, with the tail notch.
  const s = new THREE.Shape();
  s.moveTo(0.58, 0); // nose
  s.lineTo(-0.52, 0.46); // top-back
  s.lineTo(-0.18, 0); // centre notch (fold)
  s.lineTo(-0.52, -0.46); // bottom-back
  s.closePath();
  return icon(s);
}
