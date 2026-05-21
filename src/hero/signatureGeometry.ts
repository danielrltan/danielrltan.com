import * as THREE from "three";

/**
 * Turn the captured signature events (down/move/up sequence in
 * normalized 0..1 viewport coordinates) into a set of 3D tubes
 * suitable for hero rendering.
 *
 * Each pen-down → pen-up window becomes one TubeGeometry traced along
 * the polyline of points. Pen lifts (up events) break the stroke into
 * separate tubes so the signature reads as multiple discrete glyphs
 * instead of one connected scrawl.
 */

interface SignatureEvent {
  type: "down" | "move" | "up";
  t: number;
  nx: number;
  ny: number;
}

export interface SignatureBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SignatureData {
  events: SignatureEvent[];
  bounds?: SignatureBounds;
  totalDuration: number;
}

export interface StrokePolyline {
  /** Raw normalized 2D points (0..1, Y-down) — used by the 2D drawer. */
  points: { x: number; y: number; t: number }[];
}

/**
 * Group the flat event stream into discrete strokes (one per
 * pen-down → pen-up window). Returned points are in normalized
 * canvas-space (0..1, Y-down).
 */
export function eventsToStrokes(events: SignatureEvent[]): StrokePolyline[] {
  const out: StrokePolyline[] = [];
  let current: StrokePolyline | null = null;
  for (const ev of events) {
    if (ev.type === "down") {
      current = { points: [{ x: ev.nx, y: ev.ny, t: ev.t }] };
    } else if (ev.type === "move" && current) {
      current.points.push({ x: ev.nx, y: ev.ny, t: ev.t });
    } else if (ev.type === "up" && current) {
      if (current.points.length > 1) out.push(current);
      current = null;
    }
  }
  if (current && current.points.length > 1) out.push(current);
  return out;
}

/**
 * Build a TubeGeometry per stroke. The signature's native aspect ratio
 * is preserved by mapping x to [-width/2, +width/2] and y to a
 * proportionally-scaled range. Returned coordinates are world units
 * — the consumer scales the whole rig to fit the camera frame.
 *
 * Stroke radius scales with stroke width (proportional to per-segment
 * velocity is overkill for the static 3D version — we use a single
 * radius for now). The 3D rig is purely structural; visual weight
 * variations are left for a future pass.
 */
export function buildSignatureTubes(
  strokes: StrokePolyline[],
  bounds: SignatureBounds | undefined,
  options: { width: number; tubeRadius: number; tubularSegments?: number },
): THREE.TubeGeometry[] {
  const { width, tubeRadius, tubularSegments } = options;
  // Aspect of the original signature gesture's bounding box. Without
  // this the signature would render with the unit-square aspect of
  // the normalized 0..1 events, which squashes it horizontally.
  const captureW = bounds ? bounds.maxX - bounds.minX : 1;
  const captureH = bounds ? bounds.maxY - bounds.minY : 0.3;
  const aspect = captureW / Math.max(1, captureH);
  const height = width / aspect;

  return strokes
    .map((stroke) => {
      // Map normalized (0..1, Y-down) to world space (centered, Y-up).
      const pts = stroke.points.map(
        (p) =>
          new THREE.Vector3(
            (p.x - 0.5) * width,
            -(p.y - 0.5) * height,
            0,
          ),
      );
      if (pts.length < 2) return null;
      // CatmullRomCurve3 smooths between control points. Tubular
      // segments scale with polyline length — bumped 4x → 10x per
      // point so long strokes get more geometry along their length
      // and don't look faceted under the cursor-tracking highlight.
      const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
      const segs = tubularSegments ?? Math.max(16, Math.min(512, pts.length * 10));
      // Radial segments bumped 8 → 20: at 8, the tube's silhouette
      // showed octagonal facets that read as sharp polygon edges
      // along the outer profile of each stroke. 20 segments is a
      // smooth round tube even close-up; cost is negligible since
      // there are only ~5-10 strokes total in the signature.
      return new THREE.TubeGeometry(curve, segs, tubeRadius, 20, false);
    })
    .filter((g): g is THREE.TubeGeometry => g !== null);
}
