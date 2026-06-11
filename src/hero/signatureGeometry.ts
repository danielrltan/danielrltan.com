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

interface SignatureBounds {
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
  /** Raw normalized 2D points (0..1, Y-down), used by the 2D drawer. */
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
