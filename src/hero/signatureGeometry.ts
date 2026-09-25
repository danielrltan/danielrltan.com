/**
 * The captured signature: a down/move/up event stream in normalized 0..1
 * coordinates (public/signature.json, recorded with the ?sign=1 tool). One
 * cached fetch feeds every renderer (hero 2D canvas, footer canvas, SVG brand
 * mark); `eventsToStrokes` groups the stream into discrete pen strokes.
 */

export interface SignatureEvent {
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

// Module-cached fetch so the hero, footer and brand mark share ONE request.
let cached: SignatureData | null = null;
let inflight: Promise<SignatureData | null> | null = null;

/** Fetch + cache /signature.json. Resolves null on any failure (offline, 404). */
export function loadSignatureData(): Promise<SignatureData | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = (async () => {
      try {
        const r = await fetch("/signature.json");
        if (!r.ok) return null;
        cached = (await r.json()) as SignatureData;
        return cached;
      } catch {
        return null;
      }
    })();
  }
  return inflight;
}
