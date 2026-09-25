/** Small numeric helpers shared across the scroll choreography + scenes. */

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Hermite smoothstep: 0 below edge0, 1 above edge1, eased in between. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
