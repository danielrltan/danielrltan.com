/**
 * softHold's offset curve, pure and import-free (so the acceptance math check
 * runs it straight under `node --experimental-strip-types`).
 *
 * Owner, 2026-10-05: "make releases from pins lighter and more smooth; right
 * now it feels like it snaps off from scroll". A sticky stage goes from 1:1
 * scroll speed to dead still in one frame at engage, and back in one frame at
 * release: a velocity step. softHold adds a small `translate` around each
 * sticky edge so the stage's ON-SCREEN velocity ramps linearly over L instead.
 *
 * The offset is a symmetric quadratic bump centred on each edge. Engage, with
 * u = s - (s0 - L/2), u in [0, L]:
 *   o = u²/2L              for u <= L/2  (peaks at +L/8 on s0: the stage lags down)
 *   o = L/2 - u + u²/2L    for u >  L/2
 * Release is the mirror with a negative sign around s1 (peaks at -L/8: the
 * stage leads up). Zero everywhere else.
 *
 * The bump itself is C1 at its four zone edges (slope 0, value 0, so nothing
 * is left over after a zone: no page-tone strip, unlike the old softRelease's
 * permanent -L/2). Its slope flips +1/2 -> -1/2 at s0 (and -1/2 -> +1/2 at
 * s1) BY DESIGN: that kink exactly cancels the sticky's own 1 -> 0 velocity
 * step, so stage top = sticky(s) + o(s) is C1 everywhere. Do not "fix" it.
 */
export function holdOffset(
  s: number,
  s0: number,
  s1: number,
  L: number,
  engage: boolean,
  release: boolean,
): number {
  if (!(L > 0)) return 0;
  const h = L / 2;
  let o = 0;
  if (engage) {
    const u = s - (s0 - h);
    if (u > 0 && u < L) o += u <= h ? (u * u) / (2 * L) : h - u + (u * u) / (2 * L);
  }
  if (release) {
    const u = s - (s1 - h);
    if (u > 0 && u < L) o -= u <= h ? (u * u) / (2 * L) : h - u + (u * u) / (2 * L);
  }
  return o;
}

/**
 * Where the sticky stage's top sits on screen at scroll s, softHold offset
 * included: a stage that sticks at top 0 from s0 to s1 (it starts flush with
 * its section's top, the §3 layout contract), plus holdOffset. Pure.
 */
export function stageTop(
  s: number,
  s0: number,
  s1: number,
  L: number,
  engage: boolean,
  release: boolean,
): number {
  const stuck = s < s0 ? s0 - s : s > s1 ? s1 - s : 0;
  return stuck + holdOffset(s, s0, s1, L, engage, release);
}
