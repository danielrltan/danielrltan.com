/*
 * HERO -> ABOUT: compositor-only PIXEL IRIS.
 *
 * Replaces the old pixel-zoom dive (CSS scale 1 -> 3.4 of a rasterized bitmap +
 * a coarsening shader grid + a ~1.9s double-smoothed ease + a time-based fade
 * that fired on RAW scroll). One gesture now, bound 1:1 to the Lenis-smoothed
 * document scroll (Lenis is the ONLY smoother):
 *
 *   - a pixel-art circle (a true cell-staircase, N cells per radius) punches a
 *     hole in the orange hero field from the viewport centre and opens until it
 *     clears the corners. Its cells grow with the radius, so the edge reads as
 *     "pixels growing" (the owner-loved signature) while the motion itself is
 *     continuous, never stepped in time.
 *   - a one-cell white pixel rim rides the edge (the wordmark's white).
 *   - the hero composition pushes in gently (scale 1 -> HERO_PUSH), About pulls
 *     back (ABOUT_PULL -> 1): two planes, one camera move.
 *   - About is counter-translated for the whole first viewport so it sits
 *     STATIONARY under the hole (a porthole onto a still room, not a page
 *     sliding past), and hands off seamlessly to its GSAP pin at 1.0vh.
 *
 * Everything is clip-path / scale / translate. On engines with ScrollTimeline
 * (Chromium, Safari 26) the animations are scroll-driven WAAPI animations, so
 * the transforms run on the compositor, in lock-step with the scroll, with no
 * per-frame JS. Elsewhere (Firefox, older Safari, or ?nost=1 to test it) the
 * SAME animations are paused and scrubbed from a rAF that reads the
 * Lenis-smoothed scrollY — still one smoothing stage, no extra ease.
 *
 * The animations only EXIST while 0 < scrollY < 1vh: at the very top the hero is
 * pristine (no mask, no promoted layers, resting raster untouched) and past the
 * hero nothing is left composited. The hero hides (visibility) the moment the
 * iris has fully cleared the viewport, so the hide can never cut the climax.
 *
 * Mobile (<=768) and prefers-reduced-motion keep the calm cross-fade: the hero
 * holds, then a ~330ms time-based dissolve at About's arrival (hysteresis
 * 1.0 / 0.96vh), no zoom, no pixels.
 */
import { heroState } from "./heroState";

/** Scroll (in viewports) where the iris starts opening. */
export const WIPE_START_VH = 0.05;
/** Scroll (in viewports) where the iris has cleared the corners. */
export const WIPE_END_VH = 0.9;
/** Cells per radius of the pixel circle. */
const IRIS_CELLS = 12;
/** Dithered rim outside the hole: one entry per ring of cells, the fraction of
 *  that ring painted white by a fixed 4x4 Bayer matrix (so the edge dissolves
 *  through ordered-dither levels, and a given cell never reshuffles). */
const RIM_LEVELS = [10 / 16, 4 / 16, 1 / 16];
/** Hero composition push-in at the end of the wipe. */
const HERO_PUSH = 1.12;
/** About's pull-back start scale. */
const ABOUT_PULL = 1.06;
/** Iris radius curve (effect easing). Near-linear in radius (area grows ~r²,
 *  so the reveal already accelerates on its own); the coverage math below
 *  makes the last orange cell leave exactly at the end, so there is no crawl
 *  and no dead tail. */
const IRIS_EASE = "linear";
const PUSH_EASE = "cubic-bezier(0.5, 0, 0.8, 0.9)";
const PULL_EASE = "cubic-bezier(0.2, 0.6, 0.35, 1)";

// Fade (mobile / reduced-motion) path: unchanged from the original handoff.
const FADE_HIDE_VH = 1.0;
const FADE_SHOW_VH = 0.96;
const FADE_RATE = 9; // exp rate -> ~330ms

// ---------------------------------------------------------------------------
// Pixel-circle geometry (cell units, origin at the centre, y down).
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
const bayer = (i: number, j: number) => BAYER4[(((j % 4) + 4) % 4) * 4 + (((i % 4) + 4) % 4)]! / 16;

/** The dithered rim as a list of unit squares (top-left corners), ring by ring
 *  outside the hole. */
function rimCells(n: number): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  RIM_LEVELS.forEach((level, k) => {
    const r0 = n + k;
    const r1 = n + k + 1;
    const m = Math.ceil(r1) + 1;
    for (let j = -m; j < m; j++) {
      for (let i = -m; i < m; i++) {
        if (inside(i, j, r1) && !inside(i, j, r0) && bayer(i, j) < level) cells.push([i, j]);
      }
    }
  });
  return cells;
}

/** Smallest cell size (px) at which the hole covers a w x h viewport. The
 *  pixel circle is orthogonally convex and symmetric, so it covers the frame iff
 *  the column under the corner is at least as tall as the corner is high. */
function coverCell(w: number, h: number, n: number): number {
  const heights = columnHeights(n);
  const covers = (c: number) => {
    const X = w / 2 / c;
    const Y = h / 2 / c;
    const col = Math.ceil(X) - 1;
    return col < n && heights[Math.max(0, col)]! >= Y;
  };
  let lo = 1;
  let hi = Math.hypot(w, h);
  for (let it = 0; it < 40; it++) {
    const mid = (lo + hi) / 2;
    if (covers(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

const HOLE = pixelCircle(IRIS_CELLS);
const RIM = rimCells(IRIS_CELLS);

const px = (v: number) => `calc(50% + ${v.toFixed(2)}px)`;
const pt = (x: number, y: number, cell: number) => `${px(x * cell)} ${px(y * cell)}`;

/** Hero-layer clip: the full frame with the pixel hole cut out (evenodd). The
 *  frame is traced first, then a zero-width bridge to the hole and back. */
function holeClip(cell: number): string {
  const hole = HOLE.map(([x, y]) => pt(x, y, cell)).join(", ");
  return `polygon(evenodd, -1% -1%, 101% -1%, 101% 101%, -1% 101%, -1% -1%, ${hole}, ${pt(HOLE[0]![0], HOLE[0]![1], cell)}, -1% -1%)`;
}
/** Rim clip: every rim square in ONE polygon, each reached by a zero-width
 *  bridge from the centre (bridges cancel under either fill rule, and they lie
 *  inside the hole, which the hero layer clips away anyway). */
function rimClip(cell: number): string {
  const parts: string[] = [pt(0, 0, cell)];
  for (const [i, j] of RIM) {
    parts.push(
      pt(i, j, cell),
      pt(i + 1, j, cell),
      pt(i + 1, j + 1, cell),
      pt(i, j + 1, cell),
      pt(i, j, cell),
      pt(0, 0, cell),
    );
  }
  return `polygon(${parts.join(", ")})`;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

type Driven = { anim: Animation; start: number; end: number };

export function installHeroWipe(): void {
  if (typeof window === "undefined") return;
  const root = document.documentElement;
  const mobileQ = window.matchMedia("(max-width: 768px)");
  const reduceQ = window.matchMedia("(prefers-reduced-motion: reduce)");
  const forceManual = new URLSearchParams(window.location.search).has("nost");
  // `let`: demoted to the manual path if the engine creates scroll-driven
  // animations but ignores the px ranges (see verifyRanges).
  let hasScrollTimeline =
    !forceManual && typeof (window as unknown as { ScrollTimeline?: unknown }).ScrollTimeline === "function";

  let vh = window.innerHeight || 1;
  let driven: Driven[] = [];
  let built = false;
  let irisHidden = false;
  let lastPointer = "";
  let lastDiving = false;
  let arrived = false;

  const q = <T extends Element>(sel: string) => document.querySelector<T>(sel);

  const heroLayer = () => q<HTMLElement>(".scroll-layer--hero");

  const setPointer = (v: string) => {
    if (v === lastPointer) return;
    const el = heroLayer();
    if (!el) return;
    lastPointer = v;
    // Scoped to the hero layer (the wordmark reads it via inheritance), NOT
    // :root — a root var write restyles ~770 elements.
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

  const teardown = () => {
    for (const d of driven) d.anim.cancel();
    driven = [];
    built = false;
    root.removeAttribute("data-hero-wipe");
  };

  const build = () => {
    const layer = heroLayer();
    const comp = q<HTMLElement>(".hero-composition");
    const rim = q<HTMLElement>(".hero-iris-rim");
    const stage = q<HTMLElement>(".portfolio-about .about-stage");
    const section = q<HTMLElement>(".portfolio-about");
    if (!layer || !comp) return;
    root.setAttribute("data-hero-wipe", hasScrollTimeline ? "" : "manual");

    const w = window.innerWidth || 1;
    // Cell size at full open: the smallest at which the hole covers the whole
    // frame (+1%), so the last orange cell leaves exactly as the wipe ends and
    // the visibility hide at p=1 is invisible.
    const cellEnd = coverCell(w, vh, IRIS_CELLS) * 1.01;
    const s = WIPE_START_VH * vh;
    const e = WIPE_END_VH * vh;

    const make = (
      el: Element,
      keyframes: Keyframe[],
      start: number,
      end: number,
      easing: string,
      pseudoElement?: string,
    ) => {
      const opts: KeyframeAnimationOptions & { rangeStart?: string; rangeEnd?: string } = {
        fill: "both",
        easing,
      };
      if (pseudoElement) opts.pseudoElement = pseudoElement;
      let anim: Animation;
      try {
        if (hasScrollTimeline) {
          const ST = (window as unknown as {
            ScrollTimeline: new (o: { source: Element; axis: string }) => AnimationTimeline;
          }).ScrollTimeline;
          anim = el.animate(keyframes, {
            ...opts,
            timeline: new ST({ source: document.scrollingElement || root, axis: "block" }),
            rangeStart: `${start}px`,
            rangeEnd: `${end}px`,
          } as KeyframeAnimationOptions);
        } else {
          anim = el.animate(keyframes, { ...opts, duration: 1000 });
          anim.pause();
        }
      } catch {
        return;
      }
      driven.push({ anim, start, end });
    };

    make(layer, [{ clipPath: holeClip(0) }, { clipPath: holeClip(cellEnd) }], s, e, IRIS_EASE);
    if (rim) make(rim, [{ clipPath: rimClip(0) }, { clipPath: rimClip(cellEnd) }], s, e, IRIS_EASE);
    make(comp, [{ scale: "1" }, { scale: String(HERO_PUSH) }], s, e, PUSH_EASE);
    if (stage) {
      // Counter-translate: About's flow-top is exactly 1vh (Hero.tsx is a bare
      // 100vh spacer), so translate(y - vh) holds it at the viewport top until
      // its pin takes over at y = vh with a zero offset.
      make(stage, [{ translate: `0 ${-vh}px` }, { translate: "0 0" }], 0, vh, "linear");
      // Pull-back only on the pinned, one-viewport bento (>900px). In the
      // 769-900 band About is a tall stacked column, and scaling it about its
      // centre would drift the visible top.
      if (w > 900) make(stage, [{ scale: String(ABOUT_PULL) }, { scale: "1" }], s, e, PULL_EASE);
    }
    if (section) {
      // The section's warm pool (::after) rides along so it stays centred.
      make(section, [{ translate: `0 ${-vh}px` }, { translate: "0 0" }], 0, vh, "linear", "::after");
    }
    built = true;
  };

  // Engines that ship ScrollTimeline but not px animation ranges would map the
  // iris across the WHOLE document (a tiny hole when the hide fires = a hard
  // cut). Once per session, when the scroll is far enough in to tell the two
  // mappings apart, compare the linear counter-translate's live progress with
  // scrollY; on a mismatch, rebuild on the manual (rAF scrub) path.
  let rangesVerified = false;
  const verifyRanges = (y: number) => {
    if (rangesVerified || !built || !hasScrollTimeline || y < vh * 0.25) return;
    const d = driven.find((x) => x.start === 0 && x.end === vh);
    if (!d || d.anim.pending) return;
    rangesVerified = true;
    const expected = Math.min(1, Math.max(0, y / vh));
    const actual = d.anim.effect?.getComputedTiming().progress;
    if (actual == null || Math.abs(actual - expected) > 0.15) {
      hasScrollTimeline = false;
      teardown();
      build();
    }
  };

  const scrub = (y: number) => {
    if (hasScrollTimeline) return;
    for (const d of driven) {
      const p = Math.min(1, Math.max(0, (y - d.start) / Math.max(1, d.end - d.start)));
      d.anim.currentTime = p * 1000;
    }
  };

  // Fade path state
  let fadeShown = window.scrollY / vh < FADE_HIDE_VH;
  let fadeOpacity = fadeShown ? 1 : 0;
  let fadeRaf = 0;
  let fadeLast = 0;
  const writeFade = () => {
    const el = heroLayer();
    if (el) el.style.opacity = fadeOpacity >= 1 ? "" : fadeOpacity.toFixed(3);
    heroState.culled = fadeOpacity <= 0;
  };
  const fadeLoop = (ts: number) => {
    const dt = Math.min(0.05, (ts - fadeLast) / 1000);
    fadeLast = ts;
    const target = fadeShown ? 1 : 0;
    fadeOpacity += (target - fadeOpacity) * (1 - Math.exp(-dt * FADE_RATE));
    if (target === 0 && fadeOpacity < 0.01) fadeOpacity = 0;
    if (target === 1 && fadeOpacity > 0.99) fadeOpacity = 1;
    writeFade();
    fadeRaf = fadeOpacity === target ? 0 : requestAnimationFrame(fadeLoop);
  };

  const irisMode = () => !mobileQ.matches && !reduceQ.matches;

  const update = () => {
    const y = window.scrollY;
    const ratio = y / vh;

    // Latching "left the resting hero" signal (see App.tsx latch notes).
    const diving = ratio > WIPE_START_VH * 0.5;
    if (diving !== lastDiving) {
      lastDiving = diving;
      if (diving) root.setAttribute("data-hero-diving", "");
      else root.removeAttribute("data-hero-diving");
    }
    // About's arrival cue: fires once the iris is ~a third open, so About's
    // "ABOUT" header decode plays THROUGH the opening hole rather than unseen
    // under the opaque field (and has finished by the time the iris lands).
    if (!arrived && ratio > WIPE_START_VH + (WIPE_END_VH - WIPE_START_VH) * 0.3) {
      arrived = true;
      window.dispatchEvent(new Event("hero-wipe-reveal"));
    }
    setPointer(diving ? "none" : "auto");

    if (irisMode()) {
      if (fadeRaf) {
        cancelAnimationFrame(fadeRaf);
        fadeRaf = 0;
      }
      if (fadeOpacity !== 1) {
        fadeOpacity = 1;
        writeFade();
      }
      // Torn down a beat after About pins (1.1vh, not 1.0) so the teardown
      // never lands in the same frame as the pin engage + HUD mount.
      const inRange = y > 0.5 && y < vh * 1.1;
      if (inRange && !built) build();
      else if (!inRange && built) teardown();
      if (built) {
        verifyRanges(y);
        scrub(y);
      }
      setIrisHidden(ratio >= WIPE_END_VH);
    } else {
      if (built) teardown();
      setIrisHidden(false);
      if (fadeShown && ratio >= FADE_HIDE_VH) fadeShown = false;
      else if (!fadeShown && ratio < FADE_SHOW_VH) fadeShown = true;
      const target = fadeShown ? 1 : 0;
      if (fadeOpacity !== target && !fadeRaf) {
        fadeLast = performance.now();
        fadeRaf = requestAnimationFrame(fadeLoop);
      }
    }
  };

  // Seed: a refresh-at-offset past the hero starts hidden (no flash).
  if (!irisMode()) writeFade();

  let queued = false;
  const onScroll = () => {
    if (hasScrollTimeline) {
      // Scroll-driven: only state edges happen here; no per-frame work.
      update();
      return;
    }
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      update();
    });
  };
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  const onResize = () => {
    vh = window.innerHeight || 1;
    if (resizeTimer !== undefined) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (built) teardown();
      update();
    }, 120);
  };
  const onModeChange = () => {
    if (built) teardown();
    update();
  };

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  mobileQ.addEventListener("change", onModeChange);
  reduceQ.addEventListener("change", onModeChange);
  // The hero DOM mounts after this installs (App shell renders first); run the
  // first update once the layout exists.
  requestAnimationFrame(() => update());
}
