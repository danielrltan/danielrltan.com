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
 *   - the iris is SEEDED on the centre of About's room render (owner request:
 *     it opens straight onto the room), and its radius accelerates (p^k, k
 *     fitted per layout to keep the hole off "DANIEL TAN" for as long as the
 *     geometry allows), so the room is revealed first.
 *   - a sparse half-cell white rim dithers the edge (the wordmark's white) and
 *     fades out over the last quarter so the late, big arc never reads as a
 *     loading spinner.
 *   - the hero composition pushes in (scale 1 -> HERO_PUSH) and About pulls
 *     back (ABOUT_PULL -> 1), both about the seed: two planes, one camera move
 *     into the porthole.
 *   - About is PARKED under the hero for the whole first viewport (translated
 *     so it sits still at the viewport top, a porthole onto a still room, not
 *     a page sliding past) and hands off to its sticky .about-hold at 1.0vh
 *     with a zero offset (desk; src/seams/stack.css), where it simply stays
 *     still while the Projects sheet rises over it. The parking is a CSS scroll-driven animation (about.css,
 *     @supports animation-timeline) that also holds at rest, so About's first
 *     paint happens under the opaque hero; engines without scroll timelines
 *     get the same parking from a paused WAAPI animation scrubbed here.
 *
 * Everything is clip-path / scale / translate. On engines with ScrollTimeline
 * (Chromium, Safari 26) the iris animations are scroll-driven WAAPI
 * animations: they run in lock-step with the scroll with no per-frame JS.
 * Elsewhere (Firefox, older Safari, or ?nost=1 to test it) the SAME animations
 * are paused and scrubbed from Lenis's scroll callback (the shared Lenis rAF),
 * reading window.scrollY, which is exactly what ScrollTrigger sees.
 *
 * The hero-side animations only EXIST while 0 < scrollY < 1.1vh: at the very
 * top the hero is pristine (no mask, no promoted layers, resting raster
 * untouched) and past the hero nothing is left composited. The hero hides
 * (visibility) once the orange left on screen falls below HIDE_REMAIN of the
 * viewport (measured on the real cell staircase, per layout; ~0.84vh at
 * 1440x900), never later than IRIS_END_VH. The corner farthest from the seed
 * clears last, and its final few percent are only a thin
 * edge strip over a fully readable About that, at rest, read as a rendering
 * glitch rather than the end of the iris. The climax (the hole sweeping the
 * name and the room) is long over by then.
 *
 * OWNER REVIEW (spec §5 O1, flick cap): on ScrollTimeline engines the iris is
 * bound 1:1 to the (Lenis-smoothed) scroll on the compositor, so it has no
 * rate cap: a ~3000 px/s wheel flick runs the whole dive in ~280 ms, under
 * O1's 350 ms floor (1 / HERO.diveMinSec). Waived for the compositor iris,
 * not implemented: a rate-capped iris lags the scroll, so it would still be
 * open when About's hold engages at 1.0vh and the position-keyed hide would then cut
 * it (the one invariant the iris exists to keep), and switching to the
 * manual path mid-flick means cancelling and rebuilding every animation on
 * the busiest frames of the gesture. Main lost the climax entirely at that
 * speed; the iris always plays through.
 *
 * Roomless layouts (MQ.roomless: <=600 wide, or a phone on its side at any
 * width; About's facts-first column, where there is no room render to open
 * onto) and prefers-reduced-motion get no iris. Tablets (601-900, iPad mini
 * portrait included) do: their stacked, unheld About shows the room as its
 * first cell, and the park translate leaves About exactly at its flow
 * position at 1.0vh, so the porthole works there too (no pull-back: that is
 * tuned for the one-viewport bento, NOT MQ.narrow). Without the iris About is not
 * parked, and the hero clears at spec §5 O2/O3 timing
 * (hide at HERO.handoffVh 0.78, return below HERO.showVh 0.74). Narrow fades
 * over DUR.handoff; reduced motion snaps in the same scroll callback (F3,
 * <=1 frame). No zoom, no pixels.
 *
 * COMPACT (MQ.compact: phones, a phone on its side) + motion OK: a SCRUBBED
 * fade instead. The timed fade kept the fixed hero fully opaque until
 * 0.78vh, so the first ~650px of a phone swipe changed nothing on screen and
 * read as the page refusing to scroll. Here the hero layer follows the
 * finger from the first pixel: it drifts up at SCRUB_SHIFT of the scroll
 * speed (a parallax, never faster than the finger) and fades from
 * SCRUB_FROM_VH to SCRUB_TO_VH, both written straight from the scroll
 * position (transform + opacity only: compositor work, no layout), so a
 * half swipe rests half faded and reversing the swipe reverses it exactly.
 * Reduced motion keeps the instant F3 snap above.
 *
 * Hit-testing: while the iris is built the hero LAYER itself takes pointer
 * events (clip-path clips hit-testing, so About is reachable only through the
 * hole), otherwise the parked About under the opaque field (its Reach links)
 * would take invisible clicks. The composition below it stays
 * pointer-events:none, so the layer box is the only target; wheel/touch
 * bubble to window/Lenis as before.
 *
 * Room bob: html[data-hero-covering] is set while the hero layer is visible
 * (iris not yet cleared / fade not done); about.css pauses the room's ambient
 * bob under it, so the parked room is still behind the hero and through the
 * porthole, and starts floating once the hero clears.
 */
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { DUR, HERO, MQ, ease, reducedMotion } from "../motion";
import { getLenis, onScrollJump } from "../scroll";
import { heroHandoff, heroState } from "./heroState";

// ---------------------------------------------------------------------------
// Tuning (named so the owner can tune by feel).
// ---------------------------------------------------------------------------

/** Scroll (viewports) where the iris starts opening = the spec's dive start. */
const IRIS_START_VH = HERO.diveStartVh;
/** Scroll (viewports) where the iris has cleared the farthest corner (the
 *  last orange cell leaves here). The hero hides a little earlier, at the
 *  per-layout HIDE_REMAIN point, never later. Must be <= HERO.clearByVh
 *  (0.98). */
export const IRIS_END_VH = 0.9;
/** Hide the hero once the orange still on screen is below this fraction of
 *  the viewport (the iris's last sliver, see header). Owner tunable: 0 =
 *  hide at exact cover (IRIS_END_VH). */
const HIDE_REMAIN = 0.03;
/** Cells per radius of the pixel circle. */
const IRIS_CELLS = 15;
/** The iris is seeded on the centre of About's room render, measured where the
 *  parked About sits under the hero, so the hole opens straight onto the room
 *  at every size. Seed y is kept within [SEED_Y_MIN, SEED_Y_MAX] of the
 *  viewport (a room centred below the fold on a short landscape tablet still
 *  opens on screen). With no room on screen the seed is the viewport centre. */
const SEED_Y_MIN = 0.2;
const SEED_Y_MAX = 0.8;
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
/** About's pull-back start scale (one-viewport bento, >900px only). */
const ABOUT_PULL = 1.06;
const PUSH_EASE = "cubic-bezier(0.5, 0, 0.8, 0.9)";
const PULL_EASE = "cubic-bezier(0.2, 0.6, 0.35, 1)";

/** Fade path (narrow / reduced motion): hide at/above, show again below
 *  (spec §5 F1/F3 = O2/O3 timing; the tokens live in motion.ts HERO). */
const FADE_AT_VH = HERO.handoffVh;
const FADE_SHOW_VH = HERO.showVh;

/** Scrubbed fade (compact, motion OK; see header): opacity 1 -> 0 between
 *  these scroll positions (viewports). Ends well before About's top reaches
 *  the HUD reveal line (1.0vh) and the HUD top strip. */
const SCRUB_FROM_VH = 0.05;
const SCRUB_TO_VH = 0.6;
/** The hero layer's upward drift, as a fraction of the scroll distance. */
const SCRUB_SHIFT = 0.45;
/** Scrub progress at which About's ABOUT decode cue fires: About's title is
 *  on screen by then and the hero is translucent over it. */
const SCRUB_CUE_P = 0.35;

/** Hero-side animations exist only in (BUILD_MIN_PX, TEARDOWN_VH * vh). Torn
 *  down a beat after About's hold engages (1.1vh, not 1.0) so the teardown
 *  never lands in the same frame as the hold engage + HUD mount. */
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

/** Fraction of the w x h viewport still covered by the hero when the pixel
 *  hole (centred on sx, sy) has cell size `cell`: the hole is a union of
 *  disjoint columns, column i spanning sx +- [i, i+1] cells horizontally and
 *  sy +- HEIGHTS[i] cells vertically (the circle is symmetric). */
function remainingFraction(sx: number, sy: number, cell: number, w: number, h: number): number {
  if (cell <= 0) return 1;
  let hole = 0;
  for (let i = 0; i < IRIS_CELLS; i++) {
    const half = HEIGHTS[i]! * cell;
    const ch = Math.max(0, Math.min(h, sy + half) - Math.max(0, sy - half));
    if (ch <= 0) continue;
    const a = i * cell;
    const b = (i + 1) * cell;
    const right = Math.max(0, Math.min(w, sx + b) - Math.max(0, sx + a));
    const left = Math.max(0, Math.min(w, sx - a) - Math.max(0, sx - b));
    hole += (right + left) * ch;
  }
  return Math.max(0, 1 - hole / (w * h));
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
  /** The About stage's top edge where it sits parked (viewport px). */
  stageTop: number;
  holeFrom: string;
  holeTo: string;
  rimFrom: string;
  rimTo: string;
  cellEasing: string;
  cueP: number;
  /** Scroll (viewports) at which the hero hides (HIDE_REMAIN; <= IRIS_END_VH). */
  hideVh: number;
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

/** The y component (px) of an element's computed individual `translate`
 *  (includes a running park animation, CSS or WAAPI). */
function translateY(el: Element): number {
  const t = getComputedStyle(el).translate;
  if (!t || t === "none") return 0;
  const parts = t.split(/\s+/);
  return parts.length > 1 ? parseFloat(parts[1]!) || 0 : 0;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

type Driven = { anim: Animation; start: number; end: number };

export function installHeroWipe(): void {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  // Iris wherever About shows the room render (NOT MQ.roomless: the held
  // bento above 900, the stacked tablet column at 601-900). about.css's park
  // @media and its room-render rules are the complement ((width > 600px) and
  // (height > 500px): a sideways phone is roomless and never parked); keep
  // them in sync. The pull-back is one-viewport-bento only (NOT MQ.narrow).
  const roomlessQ = window.matchMedia(MQ.roomless);
  const narrowQ = window.matchMedia(MQ.narrow);
  // Scrubbed-fade layouts (a subset of the fade path; see header).
  const compactQ = window.matchMedia(MQ.compact);
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
  const driven: Driven[] = [];
  const parkDriven: Driven[] = [];
  let built = false;
  let irisHidden = false;
  let parked: string | null = null;
  let lastPointer = "";
  let lastLayerPointer = "";
  let covering: boolean | null = null;
  let lastDiving = false;
  let lastY = -1;

  const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);
  const heroLayer = () => q<HTMLElement>(".scroll-layer--hero");
  const irisMode = () => !roomlessQ.matches && !reducedMotion.value;
  const scrubMode = () => !irisMode() && compactQ.matches && !reducedMotion.value;

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
    // Everything is measured where it sits PARKED (the hold's top at the
    // viewport top, the stage's park translate at 0), which is exactly where
    // the iris opens onto it. That holds from any scroll position (a reload
    // mid-page, a resize while scrolled), not just at rest: an element inside
    // the stage maps to its parked spot by `parkDy`.
    // Relative to the .about-hold, NOT the section: on the desk layout the
    // hold is sticky (src/seams/stack.css), so past 1.0vh it is stuck at the
    // viewport top, then scrolled away under the Projects sheet, while the
    // section's own rect keeps moving. Everything measured here lives inside
    // the hold and moves rigidly with it (visibility: hidden under the sheet
    // keeps its boxes), so `el - hold` is the parked offset at any scrollY.
    // Off the desk layout the hold is static and coincides with the section.
    const stage = q<HTMLElement>(".portfolio-about .about-stage");
    const hold =
      q<HTMLElement>(".portfolio-about .about-hold") ?? q<HTMLElement>(".portfolio-about");
    const st = stage?.getBoundingClientRect();
    const box = hold?.getBoundingClientRect();
    // parked top = untranslated offset within the hold (st.top - parkTy -
    // box.top), so parked - current = -parkTy - box.top.
    const parkTy = stage ? translateY(stage) : 0;
    const parkDy = st && box ? -parkTy - box.top : 0;
    const stageLeft = st ? st.left : 0;
    const stageTop = st ? st.top + parkDy : 0;
    // Seed on the room render's centre. Its card can still be mid reveal
    // (about.css .card rises from translateY(--reveal-lift)), so its current
    // reveal offset comes back out to land on the room's resting spot.
    const roomEl = q<HTMLElement>(".portfolio-about .about-room");
    const room = roomEl?.getBoundingClientRect();
    const card = roomEl?.closest<HTMLElement>(".card");
    const cardT = card ? getComputedStyle(card).transform : "none";
    const lift = cardT && cardT !== "none" ? new DOMMatrixReadOnly(cardT).m42 : 0;
    const roomTop = room ? room.top - lift + parkDy : 0;
    const roomBottom = room ? roomTop + room.height : 0;
    const roomOk = !!room && room.width > 0 && room.height > 0 && roomBottom > 0 && roomTop < vh;
    // Aim at the room's centre; if that is off screen when parked (a short
    // landscape viewport where the room starts low), at the middle of the
    // slice of it that is on screen. No room on screen at all: the middle of
    // the viewport.
    const roomMid = (roomTop + roomBottom) / 2;
    const roomAim =
      roomMid > 0 && roomMid < vh ? roomMid : (Math.max(0, roomTop) + Math.min(vh, roomBottom)) / 2;
    const sx = roomOk ? room.left + room.width / 2 : w / 2;
    const sy = roomOk ? Math.min(vh * SEED_Y_MAX, Math.max(vh * SEED_Y_MIN, roomAim)) : vh / 2;
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
    // Decode cue: the iris progress at which the hole first touches the
    // parked "ABOUT" title.
    let cueP = CUE_P;
    const title = q<HTMLElement>(".portfolio-about .about-banner-title");
    if (title) {
      // The <p> is full-width; measure the glyphs (a Range over its text).
      const range = document.createRange();
      range.selectNodeContents(title);
      const t = range.getBoundingClientRect();
      const tTop = t.top + parkDy;
      const tBottom = t.bottom + parkDy;
      if (t.width > 0 && tBottom > 0 && tTop < vh) {
        const tx = Math.max(t.left, Math.min(sx, t.right));
        const ty = Math.max(tTop, Math.min(sy, tBottom));
        const d = Math.hypot(sx - tx, sy - ty);
        cueP = Math.min(CUE_P_MAX, Math.max(CUE_P_MIN, Math.pow(Math.min(1, d / rEnd), 1 / k)));
      }
    }
    // Hide point: the iris progress at which the staircase leaves less than
    // HIDE_REMAIN of the viewport orange (cell = cellEnd * p^k, the same
    // curve the clip animation runs). Coverage only falls as p grows.
    let lo = 0;
    let hi = 1;
    if (HIDE_REMAIN > 0) {
      for (let it = 0; it < 30; it++) {
        const mid = (lo + hi) / 2;
        if (remainingFraction(sx, sy, cellEnd * Math.pow(mid, k), w, vh) <= HIDE_REMAIN) hi = mid;
        else lo = mid;
      }
    }
    const hideVh = IRIS_START_VH + (IRIS_END_VH - IRIS_START_VH) * hi;
    const g0 = { sx, sy };
    return {
      w,
      vh,
      sx,
      sy,
      cellEnd,
      k,
      stageLeft,
      stageTop,
      cueP,
      hideVh,
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

  /** The hero LAYER's own hit-testing (inline, overriding App's
   *  pointerEvents:none). "auto" only while the iris is up (see header). */
  const setLayerPointer = (v: "auto" | "none") => {
    if (v === lastLayerPointer) return;
    const el = heroLayer();
    if (!el) return;
    lastLayerPointer = v;
    el.style.pointerEvents = v;
  };

  /** heroState.culled + html[data-hero-covering] (pauses About's room bob). */
  const setCulled = (culled: boolean) => {
    heroState.culled = culled;
    if (covering === !culled) return;
    covering = !culled;
    if (covering) root.setAttribute("data-hero-covering", "");
    else root.removeAttribute("data-hero-covering");
  };

  const setIrisHidden = (hide: boolean) => {
    if (hide === irisHidden) return;
    const el = heroLayer();
    if (!el) return;
    irisHidden = hide;
    el.style.visibility = hide ? "hidden" : "";
    setCulled(hide);
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
    // Pull-back only on the held, one-viewport bento (NOT MQ.narrow): the
    // stacked tablet column runs the iris without it.
    if (ok && stage && !narrowQ.matches) {
      stage.style.transformOrigin = `${f1(g.sx - g.stageLeft)}px ${f1(g.sy - g.stageTop)}px`;
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
  // until About's sticky hold takes over at 1.0vh. The pool is the HOLD's
  // ::after (about.css), so it stays put with the stage past 1.0vh.
  const buildPark = () => {
    const stage = q<HTMLElement>(".portfolio-about .about-stage");
    const hold = q<HTMLElement>(".portfolio-about .about-hold");
    if (!stage || !hold) return;
    const kf = [{ translate: `0 ${-vh}px` }, { translate: "0 0" }];
    make(parkDriven, stage, kf, 0, vh, false);
    make(parkDriven, hold, kf, 0, vh, false, "::after");
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

  // ── Fade path (narrow / reduced motion) ───────────────────────────────────
  let fadeShown = window.scrollY / vh < FADE_AT_VH;
  let fadeOpacity = fadeShown ? 1 : 0;
  let fadeFrom = fadeOpacity;
  let fadeTo = fadeOpacity;
  let fadeT0 = 0;
  let fadeDur = 0;
  let fadeRaf = 0;
  // Scrub path's upward drift (px, <= 0); 0 everywhere else.
  let scrubShift = 0;
  let lastShift = "";
  const writeFade = () => {
    const el = heroLayer();
    if (el) {
      const shift = scrubShift ? `translate3d(0, ${scrubShift.toFixed(1)}px, 0)` : "";
      if (shift !== lastShift) {
        lastShift = shift;
        el.style.transform = shift;
      }
      el.style.opacity = fadeOpacity >= 1 ? "" : fadeOpacity.toFixed(3);
      // Fully faded = not hit-testable and not painted.
      el.style.visibility = fadeOpacity <= 0 ? "hidden" : "";
    }
    setCulled(fadeOpacity <= 0);
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
    scrubShift = 0;
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
    // The hero wordmark's hover field stops taking pointer events the moment
    // you leave the resting hero (the layer itself takes over below, in iris
    // mode, so the parked About can't be clicked through the opaque field).
    setPointer(diving ? "none" : "auto");

    if (irisMode()) {
      if (fadeRaf || fadeOpacity !== 1 || scrubShift) {
        // Leaving the fade path (resize past 900 / reduced-motion toggle).
        fadeShown = true;
        snapFade();
        irisHidden = false; // snapFade cleared the layer's visibility
      }
      // About parked (and allowed to paint above its section box) until its
      // hold takes over at 1.0vh. The translate is 0 from 1.0vh on; the flag
      // (overflow) and the fallback animations are released with the iris at
      // TEARDOWN_VH, so none of it lands in the hold-engage + HUD-mount frame.
      const parkRange = ratio < TEARDOWN_VH;
      setPark(parkRange ? (cssPark ? "" : "manual") : null);
      if (!cssPark) {
        if (parkRange && parkDriven.length === 0) buildPark();
        else if (!parkRange && parkDriven.length) cancelAll(parkDriven);
        scrub(parkDriven, y);
      }

      const inRange = y > BUILD_MIN_PX && y < vh * TEARDOWN_VH;
      if (inRange && !built) build();
      else if (!inRange && built) teardown();
      if (built) {
        verifyRanges();
        if (!hasScrollTimeline) scrub(driven, y);
      }
      const hide = ratio >= (geo?.hideVh ?? IRIS_END_VH);
      heroState.wiping = built && !hide;
      // The cue can never trail the hide (it is <= CUE_P_MAX of the iris, but
      // a layout's hide point is measured independently).
      if (hide || ratio >= IRIS_START_VH + (IRIS_END_VH - IRIS_START_VH) * (geo?.cueP ?? CUE_P)) heroHandoff.set("cue");
      setIrisHidden(hide);
      setCulled(irisHidden);
      // Opaque field = hit target; the hole (clip-path) lets About through.
      setLayerPointer(irisHidden ? "none" : "auto");
    } else {
      const fromIris = built || irisHidden;
      if (built) teardown();
      if (parkDriven.length) cancelAll(parkDriven);
      setPark(null);
      setIrisHidden(false);
      // Fade path: the layer stays a pass-through (App's default). About is
      // not parked here, and on touch a full-viewport hit box is unwanted.
      setLayerPointer("none");
      heroState.wiping = false;
      if (fromIris) writeFade();
      if (scrubMode()) {
        // Scrubbed fade: opacity + drift written from the scroll position
        // itself (no timed tween to chase). See header.
        if (fadeRaf) cancelAnimationFrame(fadeRaf);
        fadeRaf = 0;
        const p = clamp01((ratio - SCRUB_FROM_VH) / (SCRUB_TO_VH - SCRUB_FROM_VH));
        fadeOpacity = fadeFrom = fadeTo = 1 - ease.inOutSine(p);
        if (p >= 1) fadeOpacity = fadeFrom = fadeTo = 0;
        // Kept in step so a switch to the timed path (rotation to a wider
        // narrow layout) starts from the right side of its hysteresis.
        fadeShown = p < 1;
        scrubShift = -SCRUB_SHIFT * Math.min(y, SCRUB_TO_VH * vh);
        writeFade();
        if (p >= SCRUB_CUE_P) heroHandoff.set("cue");
        return;
      }
      if (scrubShift) {
        // Left the scrub path (rotation / reduced-motion toggle): drop the
        // drift; the timed fade below takes it from the current opacity.
        scrubShift = 0;
        writeFade();
      }
      if (fadeShown && ratio >= FADE_AT_VH) fadeShown = false;
      else if (!fadeShown && ratio < FADE_SHOW_VH) fadeShown = true;
      if (!fadeShown) heroHandoff.set("cue");
      if (reducedMotion.value) {
        // F3: reduced motion clears / returns in the same callback (<=1 frame).
        if (fadeRaf || fadeOpacity !== (fadeShown ? 1 : 0)) snapFade();
      } else {
        startFade(fadeShown ? 1 : 0);
      }
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
        if (fadeRaf || (fadeOpacity > 0 && fadeOpacity < 1)) return "clearing";
        return fadeOpacity <= 0 ? "cleared" : "rest";
      }
      const r = this.r;
      if (r < IRIS_START_VH) return "rest";
      if (r < IRIS_END_VH && !irisHidden) return "dive";
      return "cleared";
    },
    get seed() {
      return geo
        ? { x: geo.sx, y: geo.sy, k: geo.k, cellEnd: geo.cellEnd, cueP: geo.cueP, hideVh: geo.hideVh }
        : null;
    },
  };
  Object.defineProperty(window, "__heroMotion", { configurable: true, value: mirror });

  // ── Wiring ────────────────────────────────────────────────────────────────
  // Seed: a refresh-at-offset past the hero starts hidden (no flash). The
  // covering flag is seeded synchronously so the room bob is paused from the
  // first paint (the hero layer is visible at install).
  if (!irisMode()) writeFade();
  else setCulled(false);
  if (window.scrollY > 0) heroHandoff.set("armed");

  // Manual scrubs ride Lenis's scroll callback (the shared Lenis rAF, same
  // frame ScrollTrigger updates its triggers). Lenis is created after this installs
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

  // Re-measure once layout has really settled: ScrollTrigger's refresh runs
  // after a resize / rotation has re-laid out the page (the 120ms resize
  // measure can still see the old layout), and after late content shifts
  // About. Only rebuilds when the seed actually moved.
  const remeasure = () => {
    const next = measure();
    if (!next) return;
    const g = geo;
    if (g && g.w === next.w && g.vh === next.vh && Math.abs(g.sx - next.sx) < 1.5 && Math.abs(g.sy - next.sy) < 1.5) return;
    if (built) teardown();
    geo = next;
    update(true);
  };
  ScrollTrigger.addEventListener("refresh", remeasure);
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  roomlessQ.addEventListener("change", onModeChange);
  // Crossing 900 (bento <-> stacked tablet) changes the pull-back: rebuild.
  narrowQ.addEventListener("change", onModeChange);
  compactQ.addEventListener("change", onModeChange);
  reducedMotion.subscribe(onModeChange);
  // A programmatic CUT (menu / footer / jump-to-top) snaps every state in the
  // same frame: jump-to-top from Contact shows the hero at rest, not a
  // replaying fade.
  onScrollJump((ev) => {
    if (ev.phase !== "end" || ev.mode !== "cut") return;
    update(true);
    // The scrub path already wrote the landing's exact state in update().
    if (!irisMode() && !scrubMode()) snapFade();
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
      // A late layout pass once the room image decodes can still move its
      // cell: measure again on load (About is mounted by now).
      const roomImg = q<HTMLImageElement>(".portfolio-about .about-room");
      if (roomImg && !roomImg.complete) roomImg.addEventListener("load", remeasure, { once: true });
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
