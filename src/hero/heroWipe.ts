/*
 * HERO -> ABOUT: compositor-only PIXEL IRIS.
 *
 * One gesture, bound 1:1 to the Lenis-smoothed document scroll (Lenis is the
 * ONLY smoother; there is no second ease, no settle snap):
 *
 *   - a pixel-art circle (a true cell staircase, IRIS_CELLS cells per radius)
 *     punches a hole in the orange hero field and opens until it clears the
 *     farthest corner. Its cells grow with the radius, so the edge reads as
 *     "pixels growing" (the owner-loved signature) while the motion itself is
 *     continuous, never stepped in time. The iris open progress IS the hero's
 *     "dive" (window.__heroMotion.dive).
 *   - the iris is SEEDED off-centre, right of the left-aligned wordmark over
 *     the room render, and its radius accelerates (p^k, k fitted per layout),
 *     so the hole opens onto About's centrepiece first and only reaches
 *     "DANIEL TAN" in the back half of the gesture: it never bites the name
 *     in the first third.
 *   - a sparse half-cell white rim dithers the edge (the wordmark's white) and
 *     fades out over the last quarter so the late, big arc never reads as a
 *     loading spinner.
 *   - the hero composition pushes in (scale 1 -> HERO_PUSH) and About pulls
 *     back (ABOUT_PULL -> 1), both about the seed: two planes, one camera move
 *     into the porthole.
 *   - About is PARKED under the hero for the whole first viewport (translated
 *     so it sits still at the viewport top, a porthole onto a still room, not
 *     a page sliding past) and hands off to its GSAP pin at 1.0vh with a zero
 *     offset. The parking is a CSS scroll-driven animation (about.css,
 *     @supports animation-timeline) that also holds at rest, so About's first
 *     paint happens under the opaque hero; engines without scroll timelines
 *     get the same parking from a paused WAAPI animation scrubbed here.
 *
 * Everything is clip-path / scale / translate. On engines with ScrollTimeline
 * (Chromium, Safari 26) the iris animations are scroll-driven WAAPI
 * animations: they run in lock-step with the scroll with no per-frame JS.
 * Elsewhere (Firefox, older Safari, or ?nost=1 to test it) the SAME animations
 * are paused and scrubbed from Lenis's scroll callback (the shared Lenis rAF),
 * reading window.scrollY, which is exactly what ScrollTrigger's pin sees.
 *
 * The hero-side animations only EXIST while 0 < scrollY < 1.1vh: at the very
 * top the hero is pristine (no mask, no promoted layers, resting raster
 * untouched) and past the hero nothing is left composited. The hero hides
 * (visibility) the moment the iris has covered the viewport, so the hide can
 * never cut the climax.
 *
 * Mobile (<=768) and prefers-reduced-motion get no iris: About is not parked,
 * and the hero does a short time-based fade (DUR.handoff) at FADE_AT_VH onto
 * the pre-armed About, with hysteresis. No zoom, no pixels.
 */
import { DUR, HERO, ease, reducedMotion } from "../motion";
import { getLenis, onScrollJump } from "../scroll";
import { heroHandoff, heroState } from "./heroState";

// ---------------------------------------------------------------------------
// Tuning (named so the owner can tune by feel).
// ---------------------------------------------------------------------------

/** Scroll (viewports) where the iris starts opening = the spec's dive start. */
const IRIS_START_VH = HERO.diveStartVh;
/** Scroll (viewports) where the iris has cleared the farthest corner. Exact
 *  cover: the last orange cell leaves here, so the hide is invisible. Must be
 *  <= HERO.clearByVh (0.98). */
export const IRIS_END_VH = 0.9;
/** Cells per radius of the pixel circle. */
const IRIS_CELLS = 15;
/** Seed x: this fraction of the way from the wordmark's right edge to the
 *  viewport's right edge (lands over the room render's right half). */
const SEED_X_BIAS = 0.4;
/** Seed y as a fraction of the viewport height. */
const SEED_Y = 0.46;
/** The name must be untouched (hole + rim) up to this iris progress. */
const NAME_GUARD_P = 1 / 3;
/** Radius curve r = rEnd * p^k. k is fitted per layout so the name guard holds,
 *  clamped to this range (near-linear radius on wide screens, never steeper
 *  than K_MAX). */
const K_MIN = 1.15;
const K_MAX = 1.8;
/** Rim: rings of HALF cells hugging the staircase, each painted to this
 *  fraction by a fixed 4x4 Bayer matrix (a given cell never reshuffles).
 *  ~77 squares (~460 clip vertices, prototype parity): denser rims cost
 *  clip-path work every frame. */
const RIM_LEVELS = [4 / 16, 1 / 16];
/** Rim opacity over the iris progress: in quickly, out over the last quarter. */
const RIM_OPACITY: Keyframe[] = [
  { opacity: 0, offset: 0 },
  { opacity: 1, offset: 0.06 },
  { opacity: 1, offset: 0.72 },
  { opacity: 0, offset: 0.95 },
  { opacity: 0, offset: 1 },
];
/** ABOUT decode cue: the header scramble starts as the hole's edge reaches
 *  the "ABOUT" title (measured per layout, so the decode plays where it is
 *  seen: with the off-centre seed the top-left title is uncovered late),
 *  clamped to [CUE_P_MIN, CUE_P_MAX] of the iris. CUE_P_MIN is the ~1/3-open
 *  floor; CUE_P is the fallback before the first measure. */
const CUE_P = 1 / 3;
const CUE_P_MIN = 1 / 3;
const CUE_P_MAX = 0.85;
/** Hero composition push-in at the end of the wipe. */
const HERO_PUSH = 1.12;
/** About's pull-back start scale (pinned bento, >900px only). */
const ABOUT_PULL = 1.06;
const PUSH_EASE = "cubic-bezier(0.5, 0, 0.8, 0.9)";
const PULL_EASE = "cubic-bezier(0.2, 0.6, 0.35, 1)";

/** Fade path (mobile / reduced motion): hide at/above, show again below. */
const FADE_AT_VH = 0.5;
const FADE_SHOW_VH = 0.46;

/** Hero-side animations exist only in (BUILD_MIN_PX, TEARDOWN_VH * vh). Torn
 *  down a beat after About pins (1.1vh, not 1.0) so the teardown never lands in
 *  the same frame as the pin engage + HUD mount. */
const BUILD_MIN_PX = 0.5;
const TEARDOWN_VH = 1.1;

// ---------------------------------------------------------------------------
// Pixel-circle geometry (cell units, origin at the seed, y down).
// A cell [i,i+1]x[j,j+1] is inside a circle of radius n when its CENTRE is.
// ---------------------------------------------------------------------------

const inside = (i: number, j: number, n: number) =>
  (i + 0.5) * (i + 0.5) + (j + 0.5) * (j + 0.5) <= n * n;

/** First-quadrant column heights (cells) of the pixel circle of radius n. */
function columnHeights(n: number): number[] {
  const h: number[] = [];
  for (let i = 0; i < n; i++) {
    let k = 0;
    while (inside(i, k, n)) k++;
    h.push(k);
  }
  return h;
}

/** Closed outline of the pixel circle (clockwise on screen), cell coords. */
function pixelCircle(n: number): Array<[number, number]> {
  const h = columnHeights(n);
  // First-quadrant staircase (x right, y UP) from (0, h0) out to (n, 0).
  const q: Array<[number, number]> = [[0, h[0]!]];
  for (let i = 0; i < n; i++) {
    const hi = h[i]!;
    const next = i + 1 < n ? h[i + 1]! : 0;
    q.push([i + 1, hi]);
    if (next !== hi) q.push([i + 1, next]);
  }
  const pts: Array<[number, number]> = [];
  for (const [x, y] of q) pts.push([x, -y]); // top-right
  for (let i = q.length - 2; i >= 0; i--) pts.push([q[i]![0], q[i]![1]]); // bottom-right
  for (let i = 1; i < q.length; i++) pts.push([-q[i]![0], q[i]![1]]); // bottom-left
  for (let i = q.length - 2; i > 0; i--) pts.push([-q[i]![0], -q[i]![1]]); // top-left
  return pts;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer = (i: number, j: number) =>
  BAYER4[(((j % 4) + 4) % 4) * 4 + (((i % 4) + 4) % 4)]! / 16;

/** The dithered rim as HALF-cell squares (top-left corners, half-cell units):
 *  ring k = the half cells at 8-neighbour distance k+1 from the hole. */
function rimCells(n: number): Array<[number, number]> {
  const m = 2 * n + RIM_LEVELS.length + 2;
  const size = 2 * m;
  const idx = (a: number, b: number) => (b + m) * size + (a + m);
  // -1 = unvisited, 0 = hole, k+1 = rim ring k.
  const dist = new Int8Array(size * size).fill(-1);
  for (let b = -m; b < m; b++) {
    for (let a = -m; a < m; a++) {
      if (inside(Math.floor(a / 2), Math.floor(b / 2), n)) dist[idx(a, b)] = 0;
    }
  }
  const cells: Array<[number, number]> = [];
  RIM_LEVELS.forEach((level, k) => {
    const ring: Array<[number, number]> = [];
    for (let b = -m + 1; b < m - 1; b++) {
      for (let a = -m + 1; a < m - 1; a++) {
        if (dist[idx(a, b)] !== -1) continue;
        let near = false;
        for (let db = -1; db <= 1 && !near; db++) {
          for (let da = -1; da <= 1; da++) {
            if (dist[idx(a + da, b + db)] === k) {
              near = true;
              break;
            }
          }
        }
        if (near) ring.push([a, b]);
      }
    }
    for (const [a, b] of ring) {
      dist[idx(a, b)] = k + 1;
      if (bayer(a, b) < level) cells.push([a, b]);
    }
  });
  return cells;
}

const HOLE = pixelCircle(IRIS_CELLS);
const HEIGHTS = columnHeights(IRIS_CELLS);
const RIM = rimCells(IRIS_CELLS);

/** Smallest cell size (px) at which the hole, centred on (sx, sy), covers the
 *  w x h viewport. The pixel circle is orthogonally convex and symmetric, so
 *  it covers a quadrant's rectangle iff the column under that quadrant's
 *  corner is at least as tall as the corner is far. */
function coverCell(sx: number, sy: number, w: number, h: number): number {
  const corners: Array<[number, number]> = [
    [sx, sy],
    [w - sx, sy],
    [sx, h - sy],
    [w - sx, h - sy],
  ];
  const covers = (c: number) =>
    corners.every(([dx, dy]) => {
      const col = Math.ceil(Math.max(0, dx) / c) - 1;
      return col < IRIS_CELLS && (col < 0 || HEIGHTS[col]! >= Math.max(0, dy) / c);
    });
  let lo = 0.5;
  let hi = Math.hypot(w, h);
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (covers(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Everything the iris needs for one layout, computed off the build frame. */
type Geometry = {
  w: number;
  vh: number;
  sx: number;
  sy: number;
  cellEnd: number;
  k: number;
  stageLeft: number;
  holeFrom: string;
  holeTo: string;
  rimFrom: string;
  rimTo: string;
  cellEasing: string;
  cueP: number;
};

const f1 = (v: number) => (Math.round(v * 10) / 10).toString();
const pt = (g: { sx: number; sy: number }, x: number, y: number, cell: number) =>
  `${f1(g.sx + x * cell)}px ${f1(g.sy + y * cell)}px`;

/** Hero-layer clip: the full frame with the pixel hole cut out (evenodd). The
 *  frame is traced first, then a zero-width bridge to the hole and back. */
function holeClip(g: { sx: number; sy: number }, cell: number): string {
  const hole = HOLE.map(([x, y]) => pt(g, x, y, cell)).join(", ");
  return `polygon(evenodd, -1% -1%, 101% -1%, 101% 101%, -1% 101%, -1% -1%, ${hole}, ${pt(g, HOLE[0]![0], HOLE[0]![1], cell)}, -1% -1%)`;
}
/** Rim clip: every rim square in ONE polygon, each reached by a zero-width
 *  bridge from the seed (bridges cancel under either fill rule, and they lie
 *  inside the hole, which the hero layer clips away anyway). */
function rimClip(g: { sx: number; sy: number }, cell: number): string {
  const c = cell / 2;
  const parts: string[] = [pt(g, 0, 0, c)];
  for (const [a, b] of RIM) {
    parts.push(
      pt(g, a, b, c),
      pt(g, a + 1, b, c),
      pt(g, a + 1, b + 1, c),
      pt(g, a, b + 1, c),
      pt(g, a, b, c),
      pt(g, 0, 0, c),
    );
  }
  return `polygon(${parts.join(", ")})`;
}

/** WAAPI easing for cell size = p^k (CSS linear() where supported). */
function powEasing(k: number): string {
  const supportsLinear =
    typeof CSS !== "undefined" && CSS.supports?.("transition-timing-function", "linear(0, 1)");
  if (!supportsLinear) return "cubic-bezier(0.45, 0.05, 0.75, 0.6)";
  const N = 24;
  const pts: string[] = [];
  for (let i = 0; i <= N; i++) pts.push((Math.pow(i / N, k)).toFixed(4));
  return `linear(${pts.join(", ")})`;
}

/** Fraction of the w x h viewport inside the circle (sx, sy, R). */
function revealedFraction(sx: number, sy: number, R: number, w: number, h: number): number {
  if (R <= 0) return 0;
  const N = 64;
  let area = 0;
  for (let i = 0; i < N; i++) {
    const x = ((i + 0.5) / N) * w;
    const dx = x - sx;
    if (Math.abs(dx) >= R) continue;
    const half = Math.sqrt(R * R - dx * dx);
    area += Math.max(0, Math.min(h, sy + half) - Math.max(0, sy - half));
  }
  return Math.min(1, (area * (w / N)) / (w * h));
}

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

type Driven = { anim: Animation; start: number; end: number };

export function installHeroWipe(): void {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  const mobileQ = window.matchMedia("(max-width: 768px)");
  const params = new URLSearchParams(window.location.search);
  const forceManual = params.has("nost");
  const hasST = typeof (window as unknown as { ScrollTimeline?: unknown }).ScrollTimeline === "function";
  // `let`: demoted to the manual path if the engine throws creating a
  // scroll-driven animation, or ignores the px ranges (see verifyRanges).
  let hasScrollTimeline = !forceManual && hasST;
  // About parking: CSS scroll-driven (about.css) unless unsupported or forced.
  const cssPark =
    !forceManual &&
    typeof CSS !== "undefined" &&
    !!CSS.supports?.("animation-timeline: scroll()") &&
    !!CSS.supports?.("animation-range: 0px 100vh");

  let vh = window.innerHeight || 1;
  let geo: Geometry | null = null;
  let driven: Driven[] = [];
  let parkDriven: Driven[] = [];
  let built = false;
  let irisHidden = false;
  let parked: string | null = null;
  let lastPointer = "";
  let lastDiving = false;
  let lastY = -1;

  const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
  const heroLayer = () => q<HTMLElement>(".scroll-layer--hero");
  const irisMode = () => !mobileQ.matches && !reducedMotion.value;

  // ── Geometry (seed, radius curve, cached keyframe strings) ────────────────
  // Measured at rest (hero-composed, resize) so the build frame does no layout
  // reads and no string building.
  const measure = (): Geometry | null => {
    const w = window.innerWidth || 1;
    const text = q<HTMLElement>(".hero-mega-text");
    const welcome = q<HTMLElement>(".hero-welcome");
    if (!text) return null;
    const a = text.getBoundingClientRect();
    const b = welcome?.getBoundingClientRect();
    const L = Math.min(a.left, b ? b.left : a.left);
    const T = Math.min(a.top, b ? b.top : a.top);
    const R = Math.max(a.right, b ? b.right : a.right);
    const B = Math.max(a.bottom, b ? b.bottom : a.bottom);
    const sx = Math.min(w * 0.88, Math.max(w * 0.5, R + (w - R) * SEED_X_BIAS));
    const sy = vh * SEED_Y;
    const cellEnd = coverCell(sx, sy, w, vh) * 1.01;
    const rEnd = cellEnd * IRIS_CELLS;
    // Nearest point of the name block to the seed; the hole plus its rim (two
    // half cells = one cell) must stay inside it until NAME_GUARD_P.
    const nx = Math.max(L, Math.min(sx, R));
    const ny = Math.max(T, Math.min(sy, B));
    const dist = Math.hypot(sx - nx, sy - ny);
    const allowed = (dist * 0.92) / (1 + 1 / IRIS_CELLS);
    const k =
      allowed <= 0
        ? K_MAX
        : Math.min(K_MAX, Math.max(K_MIN, Math.log(allowed / rEnd) / Math.log(NAME_GUARD_P)));
    const stage = q<HTMLElement>(".portfolio-about .about-stage");
    const stageLeft = stage ? stage.getBoundingClientRect().left : 0;
    // Decode cue: the iris progress at which the hole first touches the
    // parked "ABOUT" title (its rect at rest is its on-screen spot under the
    // hero while parked).
    let cueP = CUE_P;
    const title = q<HTMLElement>(".portfolio-about .about-banner-title");
    if (title) {
      // The <p> is full-width; measure the glyphs (a Range over its text).
      const range = document.createRange();
      range.selectNodeContents(title);
      const t = range.getBoundingClientRect();
      if (t.width > 0 && t.bottom > 0 && t.top < vh) {
        const tx = Math.max(t.left, Math.min(sx, t.right));
        const ty = Math.max(t.top, Math.min(sy, t.bottom));
        const d = Math.hypot(sx - tx, sy - ty);
        cueP = Math.min(CUE_P_MAX, Math.max(CUE_P_MIN, Math.pow(Math.min(1, d / rEnd), 1 / k)));
      }
    }
    const g0 = { sx, sy };
    return {
      w,
      vh,
      sx,
      sy,
      cellEnd,
      k,
      stageLeft,
      cueP,
      holeFrom: holeClip(g0, 0),
      holeTo: holeClip(g0, cellEnd),
      rimFrom: rimClip(g0, 0),
      rimTo: rimClip(g0, cellEnd),
      cellEasing: powEasing(k),
    };
  };
  const ensureGeo = () => {
    const w = window.innerWidth || 1;
    if (!geo || geo.w !== w || geo.vh !== vh) geo = measure();
    return geo;
  };

  // ── Small DOM writers (edges only; never :root per frame) ─────────────────
  const setPointer = (v: string) => {
    if (v === lastPointer) return;
    const el = heroLayer();
    if (!el) return;
    lastPointer = v;
    // Scoped to the hero layer (the wordmark reads it via inheritance).
    el.style.setProperty("--hero-pointer-events", v);
  };

  const setIrisHidden = (hide: boolean) => {
    if (hide === irisHidden) return;
    const el = heroLayer();
    if (!el) return;
    irisHidden = hide;
    el.style.visibility = hide ? "hidden" : "";
    heroState.culled = hide;
  };

  const setPark = (v: string | null) => {
    if (v === parked) return;
    parked = v;
    if (v === null) root.removeAttribute("data-hero-park");
    else root.setAttribute("data-hero-park", v);
  };

  // ── Animation plumbing ────────────────────────────────────────────────────
  const scrollTimeline = () => {
    const ST = (window as unknown as {
      ScrollTimeline: new (o: { source: Element; axis: string }) => AnimationTimeline;
    }).ScrollTimeline;
    return new ST({ source: document.scrollingElement || root, axis: "block" });
  };

  /** Create one driven animation. Easing lives on the KEYFRAMES (effect easing
   *  stays linear), so getComputedTiming().progress is the raw scroll
   *  progress (verifyRanges relies on it). Returns false if the scroll-driven
   *  branch threw, so the caller can rebuild everything on the manual path. */
  const make = (
    list: Driven[],
    el: Element,
    keyframes: Keyframe[],
    start: number,
    end: number,
    scrollDriven: boolean,
    pseudoElement?: string,
  ): boolean => {
    const opts: KeyframeAnimationOptions = { fill: "both" };
    if (pseudoElement) opts.pseudoElement = pseudoElement;
    if (scrollDriven) {
      try {
        const anim = el.animate(keyframes, {
          ...opts,
          timeline: scrollTimeline(),
          rangeStart: `${start}px`,
          rangeEnd: `${end}px`,
        } as KeyframeAnimationOptions);
        list.push({ anim, start, end });
        return true;
      } catch {
        return false;
      }
    }
    try {
      const anim = el.animate(keyframes, { ...opts, duration: 1000 });
      anim.pause();
      list.push({ anim, start, end });
    } catch {
      // A keyframe the engine can't parse: skip that one layer, keep the rest.
    }
    return true;
  };

  const cancelAll = (list: Driven[]) => {
    for (const d of list) d.anim.cancel();
    list.length = 0;
  };

  const teardown = () => {
    cancelAll(driven);
    built = false;
    heroState.wiping = false;
    root.removeAttribute("data-hero-wipe");
    const comp = q<HTMLElement>(".hero-composition");
    const stage = q<HTMLElement>(".portfolio-about .about-stage");
    comp?.style.removeProperty("transform-origin");
    stage?.style.removeProperty("transform-origin");
  };

  const build = () => {
    const layer = heroLayer();
    const comp = q<HTMLElement>(".hero-composition");
    const g = ensureGeo();
    if (!layer || !comp || !g) return;
    const rim = q<HTMLElement>(".hero-iris-rim");
    const stage = q<HTMLElement>(".portfolio-about .about-stage");
    const s = IRIS_START_VH * vh;
    const e = IRIS_END_VH * vh;
    const sd = hasScrollTimeline;

    comp.style.transformOrigin = `${f1(g.sx)}px ${f1(g.sy)}px`;
    let ok =
      make(driven, layer, [{ clipPath: g.holeFrom, easing: g.cellEasing }, { clipPath: g.holeTo }], s, e, sd) &&
      make(driven, comp, [{ scale: "1", easing: PUSH_EASE }, { scale: String(HERO_PUSH) }], s, e, sd);
    if (ok && rim) {
      ok =
        make(driven, rim, [{ clipPath: g.rimFrom, easing: g.cellEasing }, { clipPath: g.rimTo }], s, e, sd) &&
        make(driven, rim, RIM_OPACITY, s, e, sd);
    }
    // Pull-back only on the pinned, one-viewport bento (>900px). In the
    // 769-900 band About is a tall stacked column, and scaling it would drift
    // the visible top.
    if (ok && stage && g.w > 900) {
      stage.style.transformOrigin = `${f1(g.sx - g.stageLeft)}px ${f1(g.sy)}px`;
      ok = make(driven, stage, [{ scale: String(ABOUT_PULL), easing: PULL_EASE }, { scale: "1" }], s, e, sd);
    }
    if (!ok) {
      // The engine has ScrollTimeline but rejected a scroll-driven animation:
      // never leave a half-built iris. Rebuild everything on the manual path.
      cancelAll(driven);
      hasScrollTimeline = false;
      build();
      return;
    }
    root.setAttribute("data-hero-wipe", hasScrollTimeline ? "" : "manual");
    built = true;
  };

  // About parking fallback (no CSS scroll timelines): paused translate
  // animations on the stage and its warm pool, scrubbed like the iris. They
  // exist from rest (so About is parked, painted, under the settled hero)
  // until About's pin takes over at 1.0vh.
  const buildPark = () => {
    const stage = q<HTMLElement>(".portfolio-about .about-stage");
    const section = q<HTMLElement>(".portfolio-about");
    if (!stage || !section) return;
    const kf = [{ translate: `0 ${-vh}px` }, { translate: "0 0" }];
    make(parkDriven, stage, kf, 0, vh, false);
    make(parkDriven, section, kf, 0, vh, false, "::after");
  };

  const scrub = (list: Driven[], y: number) => {
    for (const d of list) {
      const p = clamp01((y - d.start) / Math.max(1, d.end - d.start));
      d.anim.currentTime = p * 1000;
    }
  };

  // Engines that ship ScrollTimeline but not px animation ranges would map the
  // iris across the WHOLE document (a tiny hole when the hide fires = a hard
  // cut). Once per session, when the scroll is far enough in to tell the two
  // mappings apart, compare the hole clip's live (linear, keyframe-eased)
  // progress with scrollY; on a mismatch, rebuild on the manual path.
  // The expected progress is derived from the TIMELINE's own current time
  // (the scroll offset it sampled at the start of this frame), not from
  // window.scrollY: Lenis moves the scroll inside rAF, after the timeline has
  // ticked, so during a fast glide scrollY runs a frame ahead and a naive
  // comparison would demote a working engine. Two consecutive mismatches are
  // required.
  let rangesVerified = false;
  let rangeMisses = 0;
  const verifyRanges = () => {
    if (rangesVerified || !built || !hasScrollTimeline) return;
    const d = driven[0];
    if (!d || d.anim.pending) return;
    const ct = (d.anim.timeline?.currentTime ?? null) as unknown;
    const pct =
      typeof ct === "number"
        ? ct
        : ct && typeof (ct as { value?: unknown }).value === "number"
          ? (ct as { value: number }).value
          : null;
    if (pct == null) return;
    const se = document.scrollingElement || root;
    const offset = (pct / 100) * Math.max(1, se.scrollHeight - se.clientHeight);
    const expected = (offset - d.start) / Math.max(1, d.end - d.start);
    if (expected < 0.2 || expected > 0.9) return;
    const actual = d.anim.effect?.getComputedTiming().progress;
    if (actual != null && Math.abs(actual - expected) <= 0.1) {
      rangesVerified = true;
      return;
    }
    if (++rangeMisses < 2) return;
    rangesVerified = true;
    hasScrollTimeline = false;
    teardown();
    build();
  };

  // ── Fade path (mobile / reduced motion) ───────────────────────────────────
  let fadeShown = window.scrollY / vh < FADE_AT_VH;
  let fadeOpacity = fadeShown ? 1 : 0;
  let fadeFrom = fadeOpacity;
  let fadeTo = fadeOpacity;
  let fadeT0 = 0;
  let fadeDur = 0;
  let fadeRaf = 0;
  const writeFade = () => {
    const el = heroLayer();
    if (el) {
      el.style.opacity = fadeOpacity >= 1 ? "" : fadeOpacity.toFixed(3);
      // Fully faded = not hit-testable and not painted.
      el.style.visibility = fadeOpacity <= 0 ? "hidden" : "";
    }
    heroState.culled = fadeOpacity <= 0;
  };
  const fadeLoop = (now: number) => {
    const t = fadeDur > 0 ? clamp01((now - fadeT0) / fadeDur) : 1;
    fadeOpacity = fadeFrom + (fadeTo - fadeFrom) * ease.out(t);
    if (t >= 1) fadeOpacity = fadeTo;
    writeFade();
    fadeRaf = t < 1 ? requestAnimationFrame(fadeLoop) : 0;
  };
  const startFade = (to: number) => {
    if (fadeTo === to && (fadeRaf || fadeOpacity === to)) return;
    fadeFrom = fadeOpacity;
    fadeTo = to;
    fadeT0 = performance.now();
    // A reversal mid-fade takes the remaining share of the time, not all of it.
    fadeDur = DUR.handoff * 1000 * Math.abs(to - fadeFrom);
    if (!fadeRaf) fadeRaf = requestAnimationFrame(fadeLoop);
  };
  const snapFade = () => {
    if (fadeRaf) cancelAnimationFrame(fadeRaf);
    fadeRaf = 0;
    fadeOpacity = fadeTo = fadeFrom = fadeShown ? 1 : 0;
    writeFade();
  };

  // ── The update (state edges + manual scrub) ───────────────────────────────
  const update = (force = false) => {
    const y = window.scrollY;
    if (!force && y === lastY) return;
    lastY = y;
    const ratio = y / vh;

    if (y > 0) heroHandoff.set("armed");

    // Latching "left the resting hero" signal (the scroll cue reads it).
    const diving = ratio > IRIS_START_VH * 0.5;
    if (diving !== lastDiving) {
      lastDiving = diving;
      if (diving) root.setAttribute("data-hero-diving", "");
      else root.removeAttribute("data-hero-diving");
    }
    // The hero wordmark stops taking pointer events the moment you leave the
    // resting hero, or About's Reach links under it go dead.
    setPointer(diving ? "none" : "auto");

    if (irisMode()) {
      if (fadeRaf || fadeOpacity !== 1) {
        // Leaving the fade path (resize past 768 / reduced-motion toggle).
        fadeShown = true;
        snapFade();
        irisHidden = false; // snapFade cleared the layer's visibility
      }
      // About parked (and allowed to paint above its section box) until its
      // pin takes over at 1.0vh.
      setPark(ratio < 1 ? (cssPark ? "" : "manual") : null);
      if (!cssPark) {
        if (ratio < 1 && parkDriven.length === 0) buildPark();
        else if (ratio >= 1 && parkDriven.length) cancelAll(parkDriven);
        scrub(parkDriven, y);
      }

      const inRange = y > BUILD_MIN_PX && y < vh * TEARDOWN_VH;
      if (inRange && !built) build();
      else if (!inRange && built) teardown();
      if (built) {
        verifyRanges();
        if (!hasScrollTimeline) scrub(driven, y);
      }
      heroState.wiping = built && ratio < IRIS_END_VH;
      if (ratio >= IRIS_START_VH + (IRIS_END_VH - IRIS_START_VH) * (geo?.cueP ?? CUE_P)) heroHandoff.set("cue");
      setIrisHidden(ratio >= IRIS_END_VH);
    } else {
      const fromIris = built || irisHidden;
      if (built) teardown();
      if (parkDriven.length) cancelAll(parkDriven);
      setPark(null);
      setIrisHidden(false);
      heroState.wiping = false;
      if (fromIris) writeFade();
      if (fadeShown && ratio >= FADE_AT_VH) fadeShown = false;
      else if (!fadeShown && ratio < FADE_SHOW_VH) fadeShown = true;
      if (!fadeShown) heroHandoff.set("cue");
      startFade(fadeShown ? 1 : 0);
    }
  };

  // ── Debug mirror for the measurement tools (spec §5 O8) ───────────────────
  // Getters, so every read is the live value for the current scroll position
  // (what the compositor is showing) with zero per-frame cost.
  const mirror = {
    get mode() {
      return irisMode() ? (hasScrollTimeline ? "iris" : "iris-manual") : "fade";
    },
    get r() {
      return window.scrollY / Math.max(1, vh);
    },
    get dive() {
      if (!irisMode()) return 0;
      return clamp01((this.r - IRIS_START_VH) / (IRIS_END_VH - IRIS_START_VH));
    },
    /** Hero visual coverage 0..1 (1 = hero fills the viewport). */
    get opacity() {
      if (!irisMode()) return fadeOpacity;
      const d = this.dive;
      if (d >= 1 || irisHidden) return 0;
      const g = geo;
      if (!g || d <= 0) return 1;
      const R = g.cellEnd * IRIS_CELLS * Math.pow(d, g.k);
      return 1 - revealedFraction(g.sx, g.sy, R, g.w, g.vh);
    },
    get phase() {
      if (!irisMode()) {
        if (fadeRaf) return "clearing";
        return fadeOpacity <= 0 ? "cleared" : "rest";
      }
      const r = this.r;
      if (r < IRIS_START_VH) return "rest";
      if (r < IRIS_END_VH) return "dive";
      return "cleared";
    },
    get seed() {
      return geo ? { x: geo.sx, y: geo.sy, k: geo.k, cellEnd: geo.cellEnd, cueP: geo.cueP } : null;
    },
  };
  Object.defineProperty(window, "__heroMotion", { configurable: true, value: mirror });

  // ── Wiring ────────────────────────────────────────────────────────────────
  // Seed: a refresh-at-offset past the hero starts hidden (no flash).
  if (!irisMode()) writeFade();
  if (window.scrollY > 0) heroHandoff.set("armed");

  // Manual scrubs ride Lenis's scroll callback (the shared Lenis rAF, same
  // frame ScrollTrigger updates the pins). Lenis is created after this installs
  // (Keypad's ensureLenis), so attach lazily; the window scroll listener covers
  // the gap and scroll-driven engines' state edges (update() dedupes per y).
  let lenisAttached = false;
  const attachLenis = () => {
    if (lenisAttached) return;
    const lenis = getLenis();
    if (!lenis) return;
    lenisAttached = true;
    lenis.on("scroll", () => update());
  };
  const onScroll = () => {
    attachLenis();
    update();
  };
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    vh = window.innerHeight || 1;
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (built) teardown();
      if (parkDriven.length) cancelAll(parkDriven);
      geo = measure();
      update(true);
    }, 120);
  };
  const onModeChange = () => {
    if (built) teardown();
    if (parkDriven.length) cancelAll(parkDriven);
    update(true);
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  mobileQ.addEventListener("change", onModeChange);
  reducedMotion.subscribe(onModeChange);
  // A programmatic CUT (menu / footer / jump-to-top) snaps every state in the
  // same frame: jump-to-top from Contact shows the hero at rest, not a
  // replaying fade.
  onScrollJump((ev) => {
    if (ev.phase !== "end" || ev.mode !== "cut") return;
    update(true);
    if (!irisMode()) snapFade();
  });
  // The hero settled (opaque, composed): arm About's arrival trio underneath
  // it and measure the iris geometry off the scroll path.
  window.addEventListener(
    "hero-composed",
    () => {
      heroHandoff.set("armed");
      requestAnimationFrame(() => {
        if (!built) geo = measure();
      });
    },
    { once: true },
  );
  // The hero DOM mounts after this installs (App shell renders first); run the
  // first update once the layout exists.
  requestAnimationFrame(() => {
    attachLenis();
    update(true);
  });
}
