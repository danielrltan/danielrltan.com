import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lockScroll, unlockScroll } from "../scroll";
import { MQ, SEAM, matches, reducedMotion } from "../motion";
import { bayer4, cellMask, seg } from "../seams";
import { RECENTS_TAGS } from "./recentsTags";

/**
 * RECENTS PHOTO PLANE: every Recents photo on an endless plane you pan
 * through. Owner pick (r04 "infinite canvas") from the 10-option recents
 * lab, 2026-10-05; it replaces the three scroll-scrubbed photo trains.
 *
 * One 2D canvas. The plane is a loose masonry of COLS columns; each repeat
 * of that tile is offset vertically so the pattern never visibly tiles, and
 * neighbouring columns pan at slightly different rates (a constant parallax).
 *
 * GESTURES on a scrolling page (the part the lab draft didn't have to solve):
 *   - Vertical wheel / touch scroll belong to the PAGE. The section's scroll
 *     progress (Photos.tsx, already Lenis-smoothed: no second damp here) pans
 *     the plane vertically, so scrolling still moves you through the photos.
 *   - A mouse drag pans both axes with inertia; a horizontal trackpad swipe
 *     pans x; a touch drag pans x only (touch-action: pan-y hands vertical
 *     swipes to the page). A pointercancel never opens a photo.
 *   - Click / tap a photo, or Enter on the crosshair, opens the focus view
 *     (scroll locked while open; Esc, arrows, prev / next).
 *
 * THE IRIS (seam 6, Honours -> Recents; spec §5.6, 2026-10-06). As the
 * section rises, a 1-bit pixel porthole opens from the orange crosshair,
 * drawn into this canvas over the photos: photos inside, a 2-cell white
 * Bayer-dithered rim on the edge, page tone outside. It is the hero's pixel
 * iris echoed, and it replaces the old time-based "frames pop in from the
 * centre" entrance, which mostly played before the plane was on screen. It
 * is a pure function of the entrance progress (irisRef): cells sit on the
 * canvas grid (never the panning plane), and each cell goes cover -> white
 * -> photo exactly once per direction, so it never boils, reverses exactly
 * on scroll-up and lands right after a jump. No layer, clip-path or overlap.
 *
 * PERF: the loop runs only while the plane is on screen and the tab is
 * visible. Under reduced motion there is no drift, warp, tilt or iris,
 * and it draws only when something changes. The iris is one ~90x57 ImageData
 * plus one scaled drawImage per frame, and only while it is not fully open. Each image is decode()d before
 * its first draw, so no frame pays a synchronous decode mid-scroll. The
 * vignette and header plate are CSS layers, not per-frame gradient fills.
 */

interface Photo {
  src: string;
  w: number;
  h: number;
  tag: string;
}

interface Props {
  /** Section scroll progress 0..1 (Photos.tsx writes it per trigger update). */
  progressRef: React.MutableRefObject<number>;
  /**
   * Vertical plane travel (px) over the whole progress span: Photos.tsx
   * measures it as PAN_RATE (0.4) x the span on refresh, so a px of page
   * scroll pans the plane ~0.4px whatever the hold length. 0 = not measured.
   */
  panPxRef: React.MutableRefObject<number>;
  /** Honours -> Recents pixel iris, 0..1 (Photos.tsx entrance progress). */
  irisRef: React.MutableRefObject<number>;
  /** Filled with a "progress changed" callback that Photos.tsx calls. */
  wakeRef: React.MutableRefObject<(() => void) | null>;
}

const COLS = 6;
const SEED = 7;
/**
 * Scroll pan fallback before Photos.tsx has measured its span: 0.4 x the
 * 2.3vh span (1vh entrance + the 0.8vh hold + the 0.5vh tail), in viewports.
 */
const SCROLL_TRAVEL_VH = 0.92;
/** Ambient drift once idle (px/ms), eased in after IDLE_MS. */
const IDLE_V = { x: -0.018, y: -0.011 };
const IDLE_MS = 2400;
/** Pointer travel (px) before a press becomes a drag instead of a click. */
const DRAG_SLOP = 6;
/** Fling speed cap (px/ms). */
const MAX_FLING = 4.5;

interface Item {
  i: number;
  y: number;
  h: number;
}
interface Col {
  items: Item[];
  period: number;
  off: number;
  drift: number;
}
interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  i: number;
  key: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function makeRng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

type RGB = [number, number, number];
const BG_FALLBACK: RGB = [238, 240, 243]; // --bg-page #eef0f3

/** Any CSS colour -> RGB, through a 1x1 canvas's fillStyle normaliser. */
function toRGB(css: string, fallback: RGB): RGB {
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return fallback;
  c.fillStyle = "#000";
  c.fillStyle = css;
  const v = String(c.fillStyle);
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  return m ? [+m[1], +m[2], +m[3]] : fallback;
}

/** Debug mirror for the acceptance probes / smoke (every build, like window.__seams). */
interface RecentsDebug {
  iris: number;
  coveredCells: number;
  whiteCells: number;
  totalCells: number;
  cell: number;
  seedX: number;
  seedY: number;
  camY: number;
}
declare global {
  interface Window {
    __recents?: RecentsDebug;
  }
}

export const RecentsCanvas = memo(function RecentsCanvas({ progressRef, panPxRef, irisRef, wakeRef }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The orange crosshair: the iris opens from its centre.
  const crossRef = useRef<HTMLDivElement>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  // Focus view: index of the open photo (null = closed) + where it opened from.
  const [open, setOpen] = useState<number | null>(null);
  const openRef = useRef<number | null>(null);
  openRef.current = open;
  const fromRectRef = useRef<Hit | null>(null);
  // Hit-test of the most recent frame; the focus view's Enter path reads it.
  const rectsRef = useRef<Hit[]>([]);
  // Starts the (sleeping) loop. Set by the main effect.
  const wakeLoopRef = useRef<() => void>(() => {});

  // Photos stream from the same manifest `npm run photos` writes.
  useEffect(() => {
    let cancelled = false;
    fetch("/photos/manifest.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !Array.isArray(d)) return;
        setPhotos(
          d
            .filter((p: Partial<Photo>) => p && p.src && p.w && p.h)
            .map((p: Photo) => ({
              src: p.src,
              w: p.w,
              h: p.h,
              tag: RECENTS_TAGS[p.src.split("/").pop() ?? ""] ?? "",
            })),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const openFocus = useCallback((i: number, from: Hit | null) => {
    fromRectRef.current = from;
    setOpen(i);
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const cv = canvasRef.current;
    const ctx = cv?.getContext("2d");
    const N = photos.length;
    if (!wrap || !cv || !ctx || N === 0) return;
    const reduced = reducedMotion.value;

    // ---------- images: decode before first draw ----------
    const ready: boolean[] = new Array(N).fill(false);
    const imgs = photos.map((p, i) => {
      const im = new Image();
      im.decoding = "async";
      im.src = p.src;
      im.decode()
        .then(() => {
          ready[i] = true;
          dirty = true;
          wake();
        })
        .catch(() => {});
      return im;
    });

    // Seeded order + layout so the plane is the same on every visit.
    const rnd0 = makeRng(SEED);
    const order = photos.map((_, i) => i).sort(() => rnd0() - 0.5);

    let W = 0;
    let H = 0;
    let dpr = 1;
    let colW = 200;
    let gap = 28;
    let cols: Col[] = [];
    let bg = "#eef0f3";
    let ghost = "#d8dade";
    let accent = "#ff4f00";
    let chipFont = '600 11px "Geist", system-ui, sans-serif';
    // Iris geometry, cached at layout: cell size (SEAM.irisCell, 12px on
    // phones), the canvas cell grid, the seed (crosshair centre, canvas px),
    // the cover colour (the page tone as RGB) and the reach that clears the
    // farthest cell.
    let cell: number = SEAM.irisCell;
    let gridCols = 0;
    let gridRows = 0;
    let seedX = 0;
    let seedY = 0;
    let bgRGB: RGB = BG_FALLBACK;
    let rFar = 0;

    function layout() {
      const r = wrap!.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      cv!.width = Math.round(W * dpr);
      cv!.height = Math.round(H * dpr);
      const phone = W < 600;
      colW = phone ? 124 : Math.round(Math.min(230, Math.max(170, W / 7.2)));
      gap = phone ? 14 : 28;
      const cs = getComputedStyle(wrap!);
      bg = cs.getPropertyValue("--bg-page").trim() || bg;
      ghost = cs.getPropertyValue("--bg-deep").trim() || ghost;
      accent = cs.getPropertyValue("--accent").trim() || accent;
      chipFont = `600 11px ${cs.getPropertyValue("--font-mono").trim() || "system-ui, sans-serif"}`;
      bgRGB = toRGB(bg, BG_FALLBACK);
      cell = matches(MQ.compact) ? SEAM.irisCellPhone : SEAM.irisCell;
      gridCols = Math.ceil(W / cell);
      gridRows = Math.ceil(H / cell);
      // Seed: the crosshair's centre relative to the canvas. Both sit in the
      // same stage, so softHold's translate moves them together.
      const xr = crossRef.current?.getBoundingClientRect();
      seedX = xr && xr.width ? xr.left + xr.width / 2 - r.left : W / 2;
      seedY = xr && xr.height ? xr.top + xr.height / 2 - r.top : H / 2;
      // Farthest corner of the CELL GRID (its last row / column overhang the
      // canvas), so the last cell centre is past the rim at iris 1.
      rFar = Math.max(
        Math.hypot(seedX, seedY),
        Math.hypot(gridCols * cell - seedX, seedY),
        Math.hypot(seedX, gridRows * cell - seedY),
        Math.hypot(gridCols * cell - seedX, gridRows * cell - seedY),
      );
      const rnd = makeRng(SEED);
      cols = Array.from({ length: COLS }, (_, c) => {
        const items: Item[] = [];
        let y = 0;
        // Round-robin the shuffled order into the columns (works for any N).
        for (let k = c; k < N; k += COLS) {
          const i = order[k];
          const p = photos[i];
          const h = Math.round((colW * p.h) / p.w);
          items.push({ i, y, h });
          y += h + gap + Math.round(rnd() * gap * 1.5);
        }
        const period = Math.max(y, 1);
        return { items, period, off: Math.round(rnd() * period), drift: 1 + (rnd() - 0.5) * 0.14 };
      });
      dirty = true;
    }

    // ---------- camera ----------
    let px = 0;
    let py = 0;
    let vx = 0;
    let vy = 0;
    // Starts at rest (1): the old 0.94 -> 1 settle was part of the time-based
    // entrance the iris replaces.
    let zoom = 1;
    let zoomT = 1;
    let warp = 0;
    let warpT = 0;
    let tilt = 0;
    let lastWarpVar = -1;
    let dragging = false;
    let idleSince = performance.now();
    let hoverKey = "";
    let ownsCursor = false;
    let dirty = true;
    let lastProgress = progressRef.current;
    let lastIris = -1;

    // ---------- iris ----------
    // Reduced motion: no iris (always open). Otherwise q = seg(iris, 0.5, 1):
    // R stays 0 until the stage top reaches mid-viewport, i.e. until the
    // crosshair is on screen, then grows (q^1.3: slow out of the crosshair,
    // faster to the corners) to clear the farthest cell exactly as the stage
    // sticks (iris 1 = section top at the viewport top).
    const irisOpen = () => reduced || irisRef.current >= 1;
    let irisR = 0;
    const rim = () => SEAM.irisRimCells * cell;
    function setIris() {
      const q = seg(irisRef.current, 0.5, 1);
      irisR = (rFar + rim()) * Math.pow(q, 1.3);
    }
    /** Cell state: 0 = photo, 1 = page-tone cover, 2 = white rim (ordered dither). */
    function irisState(i: number, j: number): 0 | 1 | 2 {
      const rw = rim();
      const t = (irisR - Math.hypot((i + 0.5) * cell - seedX, (j + 0.5) * cell - seedY)) / rw;
      if (t >= 1) return 0;
      if (t <= 0) return 1;
      return bayer4(i & 3, j & 3) / 16 < t ? 2 : 1;
    }
    /** Is canvas point (x, y) under the iris cover? (No hover / click through it.) */
    function coveredAt(x: number, y: number) {
      if (irisOpen()) return false;
      setIris();
      return irisState(Math.floor(x / cell), Math.floor(y / cell)) !== 0;
    }
    const debug: RecentsDebug = {
      iris: 1,
      coveredCells: 0,
      whiteCells: 0,
      totalCells: 0,
      cell,
      seedX: 0,
      seedY: 0,
      camY: 0,
    };
    window.__recents = debug;

    // ---------- drawing ----------
    function draw() {
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.globalAlpha = 1;
      ctx!.fillStyle = bg;
      ctx!.fillRect(0, 0, W, H);
      const cx = W / 2;
      const cy = H / 2;
      const R2 = cx * cx + cy * cy;
      const rects: Hit[] = [];
      const draws: Array<Hit & { mx: number; my: number; rot: number; r2: number }> = [];
      const pitch = colW + gap;
      // Scroll pan: centred at mid-span, travel measured from the span.
      const travel = panPxRef.current > 0 ? panPxRef.current : H * SCROLL_TRAVEL_VH;
      const camY = (progressRef.current - 0.5) * travel;
      const yCam = py - camY;
      const c0 = Math.floor((-px - colW * 2) / pitch);
      const c1 = Math.ceil((W - px + colW * 2) / pitch);
      for (let cg = c0; cg <= c1; cg++) {
        const c = ((cg % COLS) + COLS) % COLS;
        const col = cols[c];
        if (!col || col.items.length === 0) continue;
        const tile = Math.floor(cg / COLS);
        const yoff = col.off + tile * col.period * 0.37 + yCam * col.drift;
        const x0 = cg * pitch + px;
        const k0 = Math.floor((-yoff - col.period) / col.period);
        const k1 = Math.ceil((H - yoff + col.period) / col.period);
        for (let k = k0; k <= k1; k++) {
          for (const it of col.items) {
            const y0 = yoff + k * col.period + it.y;
            if (y0 > H + 200 || y0 + it.h < -200) continue;
            // Lens: pull toward the centre and shrink with distance (barrel).
            const dx = x0 + colW / 2 - cx;
            const dy = y0 + it.h / 2 - cy;
            const r2 = (dx * dx + dy * dy) / R2;
            const f = 1 - warp * 0.3 * r2;
            // (The time-based "frames pop in from the centre" entrance lived
            // here; the scroll-driven pixel iris below replaces it.)
            const s = zoom * (1 - warp * 0.34 * r2);
            const mx = cx + dx * f * zoom;
            const my = cy + dy * f * zoom;
            const w = colW * s;
            const h = it.h * s;
            const x = mx - w / 2;
            const y = my - h / 2;
            if (x > W || x + w < 0 || y > H || y + h < 0) continue;
            const key = `${cg}:${k}:${it.i}`;
            // Frames lean into a fling, a little more toward the edges.
            const rot = tilt * (0.6 + 0.8 * Math.min(1, r2 * 2)) * (dx < 0 ? 1 : 0.85);
            draws.push({ x, y, w, h, i: it.i, key, mx, my, rot, r2 });
          }
        }
      }
      // Paint FAR to NEAR: the lens pulls outer frames in toward the centre,
      // so they can overlap the centre ones; painted in column order (left to
      // right) the right side landed ON TOP of the frames at the front of the
      // ball (owner bug). Sorting by distance from the centre, farthest first,
      // keeps the front frames on top everywhere. Hit-testing walks `rects`
      // last-to-first, so it follows the same stacking.
      draws.sort((p, q) => q.r2 - p.r2);
      for (const d of draws) {
        rects.push({ x: d.x, y: d.y, w: d.w, h: d.h, i: d.i, key: d.key });
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx!.translate(d.mx, d.my);
        if (d.rot) ctx!.rotate(d.rot);
        if (ready[d.i]) ctx!.drawImage(imgs[d.i], -d.w / 2, -d.h / 2, d.w, d.h);
        else {
          ctx!.fillStyle = ghost;
          ctx!.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
        }
      }
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.globalAlpha = 1;
      rectsRef.current = rects;
      // Hover: orange keyline + a tag chip under the frame.
      const hr = hoverKey && !dragging ? rects.find((r) => r.key === hoverKey) : undefined;
      if (hr) {
        ctx!.strokeStyle = accent;
        ctx!.lineWidth = 2;
        ctx!.strokeRect(hr.x - 1, hr.y - 1, hr.w + 2, hr.h + 2);
        const tag = photos[hr.i].tag;
        const label = `${pad2(hr.i + 1)}${tag ? ` · ${tag}` : ""}`;
        ctx!.font = chipFont;
        const tw = ctx!.measureText(label).width + 16;
        ctx!.fillStyle = accent;
        ctx!.fillRect(hr.x - 1, hr.y + hr.h + 1, tw, 22);
        ctx!.fillStyle = "#fff";
        ctx!.textBaseline = "middle";
        ctx!.fillText(label, hr.x + 7, hr.y + hr.h + 12.5);
        (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
      }
      // The iris, last, so nothing (keyline, chip) shows through its cover.
      let covered = 0;
      let white = 0;
      const irisDone = irisOpen();
      if (!irisDone) {
        setIris();
        cellMask(ctx!, {
          w: gridCols * cell,
          h: gridRows * cell,
          cell,
          color: bgRGB,
          state: (i, j) => {
            const st = irisState(i, j);
            if (st) {
              covered++;
              if (st === 2) white++;
            }
            return st;
          },
        });
      }
      debug.iris = irisDone ? 1 : irisRef.current;
      debug.coveredCells = covered;
      debug.whiteCells = white;
      debug.totalCells = gridCols * gridRows;
      debug.cell = cell;
      debug.seedX = seedX;
      debug.seedY = seedY;
      debug.camY = camY;
      const wv = Math.round(warp * 100) / 100;
      if (wv !== lastWarpVar) {
        lastWarpVar = wv;
        wrap!.parentElement?.style.setProperty("--rv-warp", String(wv));
      }
    }

    // ---------- loop (parks off screen / hidden tab / idle under RM) ----------
    let visible = false;
    let running = false;
    let raf = 0;
    let last = performance.now();
    let samples: Array<{ t: number; x: number; y: number }> = [];

    function settledRM() {
      return !dragging && Math.abs(vx) < 1e-3 && Math.abs(vy) < 1e-3;
    }
    function tick(now: number) {
      const dt = Math.min(48, now - last);
      last = now;
      if (!dragging && !reduced) {
        const decay = Math.exp(-dt / 340);
        vx *= decay;
        vy *= decay;
        if (now - idleSince > IDLE_MS && openRef.current === null) {
          vx += (IDLE_V.x - vx) * (1 - Math.exp(-dt / 900));
          vy += (IDLE_V.y - vy) * (1 - Math.exp(-dt / 900));
        }
        px += vx * dt;
        py += vy * dt;
      }
      if (!reduced) {
        const speed = Math.hypot(vx, vy);
        warpT = dragging ? Math.min(1, 0.45 + speed * 0.35) : Math.min(1, speed * 0.5);
        zoomT = dragging ? 0.9 : 1;
        warp += (warpT - warp) * (1 - Math.exp(-dt / 140));
        const vxNow =
          dragging && samples.length > 1
            ? (samples[samples.length - 1].x - samples[0].x) /
              Math.max(16, samples[samples.length - 1].t - samples[0].t)
            : vx;
        const tiltT = Math.max(-0.07, Math.min(0.07, vxNow * 0.025));
        tilt += (tiltT - tilt) * (1 - Math.exp(-dt / 120));
        zoom += (zoomT - zoom) * (1 - Math.exp(-dt / (dragging ? 160 : 320)));
      }
      if (progressRef.current !== lastProgress) {
        lastProgress = progressRef.current;
        dirty = true;
      }
      if (irisRef.current !== lastIris) {
        lastIris = irisRef.current;
        dirty = true;
      }
      if (!reduced || dirty) {
        draw();
        dirty = false;
      }
      const keepGoing = visible && !document.hidden && (!reduced || !settledRM() || dirty);
      if (keepGoing) raf = requestAnimationFrame(tick);
      else running = false;
    }
    function wake() {
      if (running || !visible || document.hidden) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    }
    wakeLoopRef.current = wake;
    wakeRef.current = wake;

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          visible = e.isIntersecting;
          dirty = true;
          wake();
        }
      },
      { rootMargin: "0px" },
    );
    io.observe(wrap);
    const ro = new ResizeObserver(() => {
      layout();
      wake();
    });
    ro.observe(wrap);
    const onVis = () => wake();
    document.addEventListener("visibilitychange", onVis);
    layout();
    if (document.fonts?.ready) document.fonts.ready.then(() => { dirty = true; wake(); });

    // ---------- input ----------
    let down: { x: number; y: number; px: number; py: number; moved: number; touch: boolean } | null = null;

    function hitAt(x: number, y: number): Hit | null {
      // Photos under the iris cover are not there yet: no hover, no open.
      if (coveredAt(x, y)) return null;
      const rects = rectsRef.current;
      for (let k = rects.length - 1; k >= 0; k--) {
        const r = rects[k];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return r;
      }
      return null;
    }
    function local(e: PointerEvent) {
      const r = wrap!.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function setHover(key: string) {
      if (key === hoverKey) return;
      hoverKey = key;
      dirty = true;
      // The voxel cursor reads body.style.cursor === "pointer" as a hover target
      // (the convention the 3D scenes use). Only ever clear what we set.
      if (key) {
        document.body.style.cursor = "pointer";
        ownsCursor = true;
      } else if (ownsCursor) {
        document.body.style.cursor = "";
        ownsCursor = false;
      }
      wake();
    }

    const onDown = (e: PointerEvent) => {
      // Left button / touch / pen only: the middle button is PanCursor's.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const p = local(e);
      down = { x: p.x, y: p.y, px, py, moved: 0, touch: e.pointerType !== "mouse" };
      samples = [{ t: performance.now(), x: p.x, y: p.y }];
      vx = vy = 0;
      dragging = false;
      idleSince = performance.now();
      wake();
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (!down) {
        if (e.pointerType === "mouse") {
          const r = hitAt(p.x, p.y);
          setHover(r ? r.key : "");
        }
        return;
      }
      const dx = p.x - down.x;
      const dy = p.y - down.y;
      down.moved = Math.max(down.moved, Math.hypot(dx, dy));
      if (!dragging && down.moved > DRAG_SLOP) {
        dragging = true;
        // Capture only once it's a drag, so a plain click stays a click.
        try {
          wrap!.setPointerCapture(e.pointerId);
        } catch {
          /* pointer already gone */
        }
        setHover("");
      }
      if (dragging) {
        px = down.px + dx;
        // Touch: vertical belongs to the page (touch-action: pan-y).
        if (!down.touch) py = down.py + dy;
        dirty = true;
      }
      const t = performance.now();
      samples.push({ t, x: p.x, y: p.y });
      while (samples.length > 2 && t - samples[0].t > 90) samples.shift();
      idleSince = t;
      wake();
    };
    const release = (canOpen: boolean) => {
      if (!down) return;
      const wasDrag = dragging;
      const wasTouch = down.touch;
      if (wasDrag && samples.length > 1 && !reduced) {
        const a = samples[0];
        const b = samples[samples.length - 1];
        const dt = Math.max(16, b.t - a.t);
        vx = (b.x - a.x) / dt;
        vy = wasTouch ? 0 : (b.y - a.y) / dt;
        const sp = Math.hypot(vx, vy);
        if (sp > MAX_FLING) {
          vx *= MAX_FLING / sp;
          vy *= MAX_FLING / sp;
        }
      }
      dragging = false;
      down = null;
      idleSince = performance.now();
      dirty = true;
      // A press that never became a drag is a click: the photo opens on the
      // `click` that follows (onClick). Opening on pointerup instead let the
      // touch-synthesised click land on the just-opened focus backdrop and
      // close it again in the same tap.
      clickOk = canOpen && !wasDrag;
      wake();
    };
    let clickOk = false;
    const onUp = () => release(true);
    const onCancel = () => release(false);
    const onClick = (e: MouseEvent) => {
      if (!clickOk) return;
      clickOk = false;
      const box = wrap!.getBoundingClientRect();
      const r = hitAt(e.clientX - box.left, e.clientY - box.top);
      if (!r) return;
      setHover("");
      openFocus(r.i, { ...r, x: r.x + box.left, y: r.y + box.top });
    };
    const onLeave = () => {
      if (!down) setHover("");
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || openRef.current !== null) return;
      // Vertical wheel is the page's (Lenis); only a horizontal-dominant swipe pans.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      px -= e.deltaX;
      vx = reduced ? 0 : -e.deltaX / 40;
      idleSince = performance.now();
      dirty = true;
      wake();
    };
    const onKey = (e: KeyboardEvent) => {
      if (openRef.current !== null) return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const d = e.key === "ArrowLeft" ? 1 : -1;
        if (reduced) px += d * 160;
        else vx = d * 1.6;
        idleSince = performance.now();
        dirty = true;
        wake();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        let best: Hit | null = null;
        let bestD = Infinity;
        for (const r of rectsRef.current) {
          const d = Math.hypot(r.x + r.w / 2 - W / 2, r.y + r.h / 2 - H / 2);
          if (d < bestD) {
            bestD = d;
            best = r;
          }
        }
        if (best) {
          const box = wrap!.getBoundingClientRect();
          openFocus(best.i, { ...best, x: best.x + box.left, y: best.y + box.top });
        }
      }
    };

    wrap.addEventListener("pointerdown", onDown);
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerup", onUp);
    wrap.addEventListener("pointercancel", onCancel);
    wrap.addEventListener("click", onClick);
    wrap.addEventListener("pointerleave", onLeave);
    wrap.addEventListener("wheel", onWheel, { passive: false });
    wrap.addEventListener("keydown", onKey);

    return () => {
      cancelAnimationFrame(raf);
      running = false;
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      wrap.removeEventListener("pointerdown", onDown);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerup", onUp);
      wrap.removeEventListener("pointercancel", onCancel);
      wrap.removeEventListener("click", onClick);
      wrap.removeEventListener("pointerleave", onLeave);
      wrap.removeEventListener("wheel", onWheel);
      wrap.removeEventListener("keydown", onKey);
      if (ownsCursor) document.body.style.cursor = "";
      if (wakeRef.current === wake) wakeRef.current = null;
      wakeLoopRef.current = () => {};
      if (window.__recents === debug) delete window.__recents;
    };
  }, [photos, progressRef, panPxRef, irisRef, wakeRef, openFocus]);

  // ---------- focus view ----------
  const N = photos.length;
  const shown = open !== null && N ? photos[((open % N) + N) % N] : null;
  const shownIdx = open !== null && N ? ((open % N) + N) % N : 0;
  const frameRef = useRef<HTMLDivElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);
  const isOpen = open !== null;

  const close = useCallback(() => {
    setOpen(null);
    wrapRef.current?.focus({ preventScroll: true });
    wakeLoopRef.current();
  }, []);

  // Scroll lock for the life of the focus view (released on every path).
  useEffect(() => {
    if (!isOpen) return;
    lockScroll("recents-focus");
    nextBtnRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") setOpen((i) => (i === null ? i : i - 1));
      else if (e.key === "ArrowRight") setOpen((i) => (i === null ? i : i + 1));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      unlockScroll("recents-focus");
    };
  }, [isOpen, close]);

  // FLIP: the print grows out of the frame it was opened from.
  useLayoutEffect(() => {
    const from = fromRectRef.current;
    fromRectRef.current = null;
    const el = frameRef.current;
    if (!isOpen || !from || !el || reducedMotion.value || typeof el.animate !== "function") return;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) return;
    el.animate(
      [
        {
          transform: `translate(${from.x + from.w / 2 - (b.left + b.width / 2)}px, ${
            from.y + from.h / 2 - (b.top + b.height / 2)
          }px) scale(${from.w / b.width}, ${from.h / b.height})`,
        },
        { transform: "translate(0, 0) scale(1)" },
      ],
      { duration: 520, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  }, [isOpen, open]);

  return (
    <>
      <div className="recents-head-plate" aria-hidden />
      <div
        ref={wrapRef}
        className="recents-plane"
        tabIndex={0}
        role="group"
        aria-roledescription="photo plane"
        aria-label={`Recents: ${N || ""} photos on an endless plane. Drag or use the left and right arrow keys to pan; Enter opens the photo under the crosshair.`}
      >
        <canvas ref={canvasRef} aria-hidden />
      </div>
      <div className="recents-vignette" aria-hidden />
      <div ref={crossRef} className="recents-cross" aria-hidden />
      {typeof document !== "undefined" &&
        createPortal(
          <div
            className={`recents-focus${isOpen ? " is-open" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="Recents photo"
            aria-hidden={!isOpen}
            onClick={(e) => {
              if (e.target === e.currentTarget) close();
            }}
          >
            <figure>
              <div ref={frameRef} className="recents-focus-frame" onClick={close}>
                {shown && (
                  <img
                    src={shown.src}
                    width={shown.w}
                    height={shown.h}
                    alt={`Recents photo ${shownIdx + 1} of ${N}${shown.tag ? `: ${shown.tag}` : ""}`}
                  />
                )}
              </div>
              <figcaption>
                <button
                  type="button"
                  className="recents-focus-btn"
                  aria-label="Previous photo"
                  tabIndex={isOpen ? 0 : -1}
                  onClick={() => setOpen((i) => (i === null ? i : i - 1))}
                >
                  <span className="recents-chev" />
                </button>
                <span>
                  <b>{pad2(shownIdx + 1)}</b> / {pad2(N)}
                  {shown?.tag ? (
                    <>
                      {" "}&middot; <span className="recents-focus-tag">{shown.tag}</span>
                    </>
                  ) : null}
                </span>
                <button
                  ref={nextBtnRef}
                  type="button"
                  className="recents-focus-btn"
                  aria-label="Next photo"
                  tabIndex={isOpen ? 0 : -1}
                  onClick={() => setOpen((i) => (i === null ? i : i + 1))}
                >
                  <span className="recents-chev recents-chev--r" />
                </button>
              </figcaption>
            </figure>
          </div>,
          document.body,
        )}
    </>
  );
});
