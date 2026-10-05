/**
 * Cursor lab kit: one input engine every experimental cursor shares, so each
 * design only has to draw. (The live site cursor is still MoveableCursor.tsx;
 * these mount via ?cursor=N on the site or in cursor-lab.html.)
 *
 * RULES every cursor follows:
 *  - The hotspot has ZERO lag. `s.x, s.y` is the raw pointer; draw an exact,
 *    visible click point there. Trails, springs, physics and swarms are
 *    decoration around it, never the thing you click with.
 *  - React to the four things that matter: speed, hover (with the hovered
 *    element's REAL box and kind), press / hold, and going idle.
 *  - Stay legible on all three surfaces: the white page, solid orange UI and
 *    the orange dotted hero. `s.surface` says which one is under the pointer;
 *    charcoal (#1B1B1F) reads on all three, white only on orange.
 *  - frame() returns true while it still has something to animate. When it
 *    returns false and the pointer is still, the engine PARKS the rAF loop (a
 *    loop running forever, hit-testing every frame, was a real perf bug in the
 *    site cursor). Hit-testing happens on move / scroll only.
 *  - Respect s.reduced: no flourish physics, keep the hotspot.
 */

export const CHAR = "#1b1b1f";
export const ORANGE = "#ff4f00";
export const WHITE = "#ffffff";
export const DEEP = "#c23d00";
export const PEACH = "#ffb489";

/** Same set as MoveableCursor's CLICKABLE_SEL. */
export const CLICKABLE_SEL =
  'a[href], button, [role="button"], [role="link"], [role="menuitem"], summary, label[for], select, [data-clickable]';
const INPUT_SEL = 'input, textarea, [contenteditable="true"]';
const TEXT_SEL = "p, h1, h2, h3, h4, h5, h6, li, blockquote, figcaption, td, th, dd, dt";

export type HoverKind = "click" | "text" | "input" | null;
export type Surface = "white" | "orange" | "dark";

/** A box in LAYER coordinates. r = border radius (px). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export interface CursorState {
  /** Exact pointer, layer coords. Never smoothed. */
  x: number;
  y: number;
  /** Smoothed velocity (px/s) and its magnitude. */
  vx: number;
  vy: number;
  speed: number;
  /** Smoothed acceleration (px/s²): what a physical object on the pointer feels. */
  ax: number;
  ay: number;
  /** Primary button held; seconds held so far (0 when up). */
  down: boolean;
  held: number;
  /** True only on the frame the press / release happened. */
  pressed: boolean;
  released: boolean;
  /** What's under the pointer. box is null for canvas hot-spots (keypad). */
  hover: { kind: HoverKind; box: Box | null; el: Element | null };
  /** True on the frame hover.el changed. */
  hoverChanged: boolean;
  /** Background under the pointer, for ink choice. */
  surface: Surface;
  /** Pointer is over this layer's area (lab tiles; always true on the site). */
  inside: boolean;
  /** Seconds since the pointer last moved. */
  idle: number;
  /** Seconds since mount; frame delta (clamped). */
  t: number;
  dt: number;
  /** Layer size. */
  w: number;
  h: number;
  reduced: boolean;
}

export interface Cursor {
  /** Draw a frame. Return true while still animating (keeps the loop awake). */
  frame(s: CursorState): boolean;
  destroy(): void;
}

export interface Env {
  /** Where the page content lives (query clickables / castables in here). */
  scope: HTMLElement;
  /** The layer the cursor draws into (pointer-events: none, covers scope). */
  layer: HTMLElement;
  /** Layer-space boxes of every clickable in scope (fresh each call). */
  targets(): Box[];
  /** Layer-space box of an element. */
  boxOf(el: Element): Box;
}

export interface CursorInfo {
  id: number;
  name: string;
  /** One line: what it does and what it reacts to. */
  blurb: string;
  family: "3D" | "physics" | "pixel" | "field";
  create(env: Env, reduced: boolean): Cursor;
}

// ---------------------------------------------------------------- helpers

/** Full-layer 2D canvas, DPR capped at 2, refit on resize. */
export function layerCanvas(layer: HTMLElement) {
  const c = document.createElement("canvas");
  c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";
  layer.appendChild(c);
  const ctx = c.getContext("2d")!;
  const box = { w: 1, h: 1, dpr: 1 };
  const fit = () => {
    const r = layer.getBoundingClientRect();
    box.dpr = Math.min(2, window.devicePixelRatio || 1);
    box.w = Math.max(1, r.width);
    box.h = Math.max(1, r.height);
    c.width = Math.round(box.w * box.dpr);
    c.height = Math.round(box.h * box.dpr);
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
  };
  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(layer);
  return {
    ctx,
    box,
    canvas: c,
    clear() {
      ctx.clearRect(0, 0, box.w, box.h);
    },
    destroy() {
      ro.disconnect();
      c.remove();
    },
  };
}

/** Damped spring step. zeta < 1 overshoots. */
export function spring(st: { x: number; v: number }, target: number, dt: number, k = 170, zeta = 0.6) {
  st.v += (k * (target - st.x) - 2 * zeta * Math.sqrt(k) * st.v) * dt;
  st.x += st.v * dt;
  return Math.abs(target - st.x) > 1e-3 || Math.abs(st.v) > 1e-3;
}
/** Frame-rate independent exponential approach. */
export const damp = (a: number, b: number, rate: number, dt: number) => b + (a - b) * Math.exp(-rate * dt);
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const clamp01 = (x: number) => clamp(x, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The exact click point: a crisp 2 px charcoal square with a 1 px white
 *  keyline, legible on white, orange and the dotted hero. */
export function hotspot(ctx: CanvasRenderingContext2D, x: number, y: number, size = 4) {
  const h = size / 2;
  ctx.fillStyle = WHITE;
  ctx.fillRect(Math.round(x - h - 1), Math.round(y - h - 1), size + 2, size + 2);
  ctx.fillStyle = CHAR;
  ctx.fillRect(Math.round(x - h), Math.round(y - h), size, size);
}

/** Rounded-rect path. */
export function rrect(ctx: CanvasRenderingContext2D, b: Box, pad = 0) {
  const r = Math.min(b.r + pad, (b.h + pad * 2) / 2, (b.w + pad * 2) / 2);
  ctx.beginPath();
  ctx.roundRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2, Math.max(0, r));
}

// ---------------------------------------------------------------- engine

function surfaceOf(el: Element | null): Surface {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const tag = n.getAttribute("data-surface");
    if (tag === "orange" || tag === "white" || tag === "dark") return tag;
    const bg = getComputedStyle(n).backgroundColor;
    const m = bg.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
    if (!m) continue;
    const a = m[4] === undefined ? 1 : Number(m[4]);
    if (a < 0.5) continue;
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (r > 200 && g < 150 && b < 90) return "orange";
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? "white" : "dark";
  }
  return "white";
}

export interface EngineOpts {
  /** Lab tiles: where the cursor rests (layer coords) while the pointer is
   *  outside, so the tile shows a still preview. */
  restAt?: () => { x: number; y: number };
  reduced?: boolean;
}

/**
 * Wires one cursor to real input. `layer` must be positioned over `scope`
 * (fixed full-viewport on the site, absolute over a tile in the lab).
 */
export function mountCursor(info: CursorInfo, scope: HTMLElement, layer: HTMLElement, opts: EngineOpts = {}) {
  const reduced = opts.reduced ?? matchMedia("(prefers-reduced-motion: reduce)").matches;
  const boxOf = (el: Element): Box => {
    const L = layer.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const br = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    return { x: r.left - L.left, y: r.top - L.top, w: r.width, h: r.height, r: br };
  };
  const env: Env = {
    scope,
    layer,
    boxOf,
    targets: () => Array.from(scope.querySelectorAll(CLICKABLE_SEL)).map(boxOf),
  };
  const cur = info.create(env, reduced);

  const s: CursorState = {
    x: 0, y: 0, vx: 0, vy: 0, speed: 0, ax: 0, ay: 0,
    down: false, held: 0, pressed: false, released: false,
    hover: { kind: null, box: null, el: null }, hoverChanged: false,
    surface: "white", inside: false, idle: 99, t: 0, dt: 1 / 60,
    w: 1, h: 1, reduced,
  };
  let clientX = -1, clientY = -1;
  let px = 0, py = 0; // last frame's position (for velocity)
  let pvx = 0, pvy = 0;
  let lastMove = performance.now();
  let pressEdge = false, releaseEdge = false;
  let dirty = true;
  let hot = false; // keypad / canvas hot signal from the host
  let running = false;
  let raf = 0;
  let last = 0;
  // Teleports (enter / leave / rest) must not read as a flick.
  let snap = true;
  const t0 = performance.now();

  const rest = () => {
    const L = layer.getBoundingClientRect();
    const r = opts.restAt?.() ?? { x: L.width / 2, y: L.height / 2 };
    s.x = r.x;
    s.y = r.y;
    snap = true;
  };
  rest();
  px = s.x;
  py = s.y;

  const hitTest = () => {
    if (!s.inside || clientX < 0) {
      if (s.hover.el) s.hoverChanged = true;
      s.hover = { kind: null, box: null, el: null };
      return;
    }
    const el = document.elementFromPoint(clientX, clientY);
    const inScope = !!el && scope.contains(el);
    let kind: HoverKind = null;
    let target: Element | null = null;
    if (inScope && el) {
      const click = el.closest(CLICKABLE_SEL);
      const input = el.closest(INPUT_SEL);
      const text = el.closest(TEXT_SEL);
      if (input) { kind = "input"; target = input; }
      else if (click) { kind = "click"; target = click; }
      else if (text) { kind = "text"; target = text; }
    }
    if (!kind && (hot || document.body.style.cursor === "pointer")) kind = "click";
    if (target !== s.hover.el) s.hoverChanged = true;
    s.hover = { kind, box: target ? boxOf(target) : null, el: target };
    s.surface = surfaceOf(el);
  };

  const tick = (now: number) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    const L = layer.getBoundingClientRect();
    s.w = L.width;
    s.h = L.height;
    if (s.inside && clientX >= 0) {
      s.x = clientX - L.left;
      s.y = clientY - L.top;
    }
    if (dirty) {
      dirty = false;
      hitTest();
    } else if (s.hover.el && s.inside) {
      // keep the box fresh (the lab scrolls; elements animate)
      s.hover.box = boxOf(s.hover.el);
    }
    if (snap) {
      snap = false;
      px = s.x;
      py = s.y;
      s.vx = s.vy = s.ax = s.ay = pvx = pvy = 0;
    }
    // velocity / acceleration, smoothed (τ ≈ 50 ms / 80 ms)
    const rvx = (s.x - px) / dt, rvy = (s.y - py) / dt;
    px = s.x;
    py = s.y;
    s.vx = damp(s.vx, rvx, 20, dt);
    s.vy = damp(s.vy, rvy, 20, dt);
    s.speed = Math.hypot(s.vx, s.vy);
    s.ax = damp(s.ax, (s.vx - pvx) / dt, 12, dt);
    s.ay = damp(s.ay, (s.vy - pvy) / dt, 12, dt);
    pvx = s.vx;
    pvy = s.vy;
    s.idle = (now - lastMove) / 1000;
    s.held = s.down ? s.held + dt : 0;
    s.pressed = pressEdge;
    s.released = releaseEdge;
    pressEdge = releaseEdge = false;
    s.t = (now - t0) / 1000;
    s.dt = dt;
    const busy = cur.frame(s);
    s.hoverChanged = false;
    const moving = s.speed > 2 || Math.hypot(s.ax, s.ay) > 20 || s.idle < 0.15;
    if (busy || moving || dirty) raf = requestAnimationFrame(tick);
    else running = false;
  };
  const wake = () => {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const isMouse = (e: PointerEvent) => !e.pointerType || e.pointerType === "mouse";
  const within = (x: number, y: number) => {
    const L = layer.getBoundingClientRect();
    return x >= L.left && x <= L.right && y >= L.top && y <= L.bottom;
  };
  const onMove = (e: PointerEvent) => {
    if (!isMouse(e)) return;
    clientX = e.clientX;
    clientY = e.clientY;
    const was = s.inside;
    s.inside = within(clientX, clientY);
    if (!s.inside && !was) return; // not ours: stay parked
    if (!s.inside && was) rest();
    if (s.inside && !was) snap = true;
    if (s.inside) lastMove = performance.now();
    dirty = true;
    wake();
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !isMouse(e) || !s.inside) return;
    s.down = true;
    pressEdge = true;
    wake();
  };
  const onUp = () => {
    if (!s.down) return;
    s.down = false;
    releaseEdge = true;
    wake();
  };
  const onScroll = () => {
    if (clientX >= 0) s.inside = within(clientX, clientY);
    dirty = true;
    wake();
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  window.addEventListener("pointercancel", onUp, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("blur", onUp);
  wake();

  return {
    /** Keypad / canvas hot signal from the host page. */
    setHot(v: boolean) {
      hot = v;
      dirty = true;
      wake();
    },
    /** Force a few frames (e.g. after the lab re-lays out). */
    wake,
    destroy() {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("blur", onUp);
      cur.destroy();
    },
  };
}
