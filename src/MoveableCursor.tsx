import { useEffect, useRef } from "react";
import { reducedMotion } from "./motion";
import { ARROW, SPARKS, VOXEL, drawPixelRing, drawVoxels, type Pose } from "./voxelArt";

interface Props {
  /** True while the keypad reports the pointer is over an interactive cap/dial. */
  hot: boolean;
}

/**
 * Custom site pointer: the VOXEL ARROW (owner's pick from the 2026-10-04 cursor
 * lab). The site's own dart (the old Cursor.svg path, rasterised to voxels in
 * voxelArt.ts) extruded into a little 3D block: charcoal face, hue-shifted
 * orange walls, a white keyline round the whole volume and a soft shadow, so it
 * reads on the white page, solid orange UI and the dotted hero alike. The OS
 * cursor is hidden site-wide (`cursor: none` in index.css) once this takes over.
 *
 * STATES (all drawn here; PanCursor draws the middle-button ones):
 *  - Rest: a slight three-quarter pose that shows the extrusion.
 *  - Moving: it hangs from its tip like a card with inertia; acceleration
 *    swings it on underdamped springs and it wobbles back.
 *  - Over anything CLICKABLE (lock-on, the gimbal reticle idea in the site's
 *    pixel language): the arrow pops, the hover art's three sparks rise out
 *    as voxels, a pixel-staircase ring (the hero iris's vocabulary) blooms
 *    round the tip, and dotted pixel hairlines run out to the element's REAL
 *    edges with ticks where they land. Canvas hot-spots (keypad / Mac /
 *    Hobbies, which set body cursor to `pointer`) get the pop + sparks + ring
 *    but no hairlines (no DOM box to measure).
 *  - Press and HOLD: the block squashes flat like a key going down and stays
 *    down until release.
 *  - Release: springs back up, and the ring irises outward, its pixels
 *    growing as it opens (the hero → About iris, in miniature).
 *  - Reduced motion: no swing, no pulse; states switch without springs.
 *
 * Hotspot = the arrow's TIP, at the 0×0 root, which sits exactly on the
 * pointer (translate written on every move, never smoothed). The canvas around
 * it only redraws while something is animating; the loop PARKS when idle (a
 * loop running forever, hit-testing every frame, was a real perf bug here).
 */

// Elements that count as clickable. `closest()` walks ancestors, so a span
// inside a button still counts.
const CLICKABLE_SEL =
  'a[href], button, [role="button"], [role="link"], [role="menuitem"], summary, label[for], select, [data-clickable]';

/** Canvas around the tip (CSS px). Big enough for the release iris. */
const CANVAS = 128;
const HALF = CANVAS / 2;
const REST: Pose = { rx: 0.42, ry: -0.6, depth: 1, scale: 1 };
const RING_R = 15;

interface Spring {
  x: number;
  v: number;
}
/** Damped spring step; returns true while still moving. */
function step(s: Spring, target: number, dt: number, k: number, zeta: number, snap: boolean) {
  if (snap) {
    s.x = target;
    s.v = 0;
    return false;
  }
  s.v += (k * (target - s.x) - 2 * zeta * Math.sqrt(k) * s.v) * dt;
  s.x += s.v * dt;
  return Math.abs(target - s.x) > 1e-3 || Math.abs(s.v) > 1e-3;
}

export function MoveableCursor({ hot }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lockRef = useRef<HTMLDivElement>(null);
  // The keypad's hot signal, read by the loop (no re-subscribe on change).
  const hotRef = useRef(hot);
  const wakeRef = useRef<() => void>(() => {});
  useEffect(() => {
    hotRef.current = hot;
    wakeRef.current(); // re-evaluate hover now
  }, [hot]);

  useEffect(() => {
    const rootEl = root.current;
    const canvas = canvasRef.current;
    const lockEl = lockRef.current;
    if (!rootEl || !canvas || !lockEl) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const lines = Array.from(lockEl.children) as HTMLElement[]; // 4 hairlines + 4 ticks

    let dpr = 1;
    const fitCanvas = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = CANVAS * dpr;
      canvas.height = CANVAS * dpr;
    };
    fitCanvas();

    let px = 0;
    let py = 0; // live pointer
    let revealed = false;
    let frame = 0;
    let running = false;
    // `dirty` marks a pending hover hit-test (set on move + scroll + hot change).
    let dirty = true;
    let lastT = 0;
    // last tick's pointer + smoothed velocity / acceleration, for the swing
    let lx = 0, ly = 0, vx = 0, vy = 0, ax = 0, ay = 0, pvx = 0, pvy = 0;

    // Hover target: the clickable element (for its box) or a canvas hot-spot.
    let hoverEl: Element | null = null;
    let hovering = false;
    let down = false;

    const rx: Spring = { x: REST.rx, v: 0 };
    const ry: Spring = { x: REST.ry, v: 0 };
    const depth: Spring = { x: 1, v: 0 };
    const scale: Spring = { x: 1, v: 0 };
    const spark: Spring = { x: 0, v: 0 };
    const ring: Spring = { x: 0, v: 0 };
    const lock: Spring = { x: 0, v: 0 };
    const pulses: { t: number }[] = [];

    // Hidden until the first real pointer position so it doesn't ghost at the
    // viewport origin on load.
    rootEl.style.opacity = "0";

    const place = () => {
      rootEl.style.transform = `translate3d(${px}px,${py}px,0)`;
    };

    // MOUSE ONLY. On a hybrid (touchscreen laptop, iPad + trackpad) a finger or
    // pen also fires pointer events; following them would teleport the arrow
    // to every tap and leave it parked where the finger lifted. Synthetic
    // replays (App's hover-while-scrolling) are typed "mouse", so they pass.
    const isMouse = (e: PointerEvent) => !e.pointerType || e.pointerType === "mouse";

    const onMove = (e: PointerEvent) => {
      if (!isMouse(e)) return;
      px = e.clientX;
      py = e.clientY;
      place(); // follow IMMEDIATELY: never wait on the (parkable) tick
      if (!revealed) {
        revealed = true;
        lx = px;
        ly = py;
        rootEl.style.opacity = "1";
        // Only now hide the OS cursor (index.css keys off this class), so the
        // page never shows NO pointer before the first move.
        document.documentElement.classList.add("custom-cursor");
      }
      dirty = true;
      schedule();
    };

    /** Hairlines from the ring out to the element's real edges, + edge ticks. */
    const layoutLock = (reach: number) => {
      const show = reach > 0.01 && hoverEl;
      lockEl.style.opacity = show ? String(Math.min(1, reach * 1.4)) : "0";
      if (!show || !hoverEl) return;
      const b = hoverEl.getBoundingClientRect();
      const r = RING_R - 3; // start inside the ring's cardinal gaps
      // One hairline: from (x0, y0) along `dir` to the edge coordinate `to`.
      const seg = (el: HTMLElement, x0: number, y0: number, dir: "l" | "r" | "u" | "d", to: number) => {
        const full = dir === "l" ? x0 - to : dir === "r" ? to - x0 : dir === "u" ? y0 - to : to - y0;
        const len = Math.max(0, full) * reach;
        const sx = dir === "l" ? x0 - len : x0;
        const sy = dir === "u" ? y0 - len : y0;
        el.style.transform = `translate3d(${Math.round(sx)}px,${Math.round(sy)}px,0)`;
        if (dir === "l" || dir === "r") el.style.width = `${Math.round(len)}px`;
        else el.style.height = `${Math.round(len)}px`;
      };
      const yC = Math.round(py) - 2, xC = Math.round(px) - 2;
      seg(lines[0], px - r, yC, "l", b.left);
      seg(lines[1], px + r, yC, "r", b.right);
      seg(lines[2], xC, py - r, "u", b.top);
      seg(lines[3], xC, py + r, "d", b.bottom);
      // ticks where the hairlines land (only once they've arrived)
      const tickA = reach > 0.92 ? "1" : "0";
      const tick = (el: HTMLElement, x: number, y: number) => {
        el.style.opacity = tickA;
        el.style.transform = `translate3d(${Math.round(x)}px,${Math.round(y)}px,0)`;
      };
      tick(lines[4], b.left - 2, py - 5);
      tick(lines[5], b.right - 2, py - 5);
      tick(lines[6], px - 5, b.top - 2);
      tick(lines[7], px - 5, b.bottom - 2);
    };

    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
      lastT = now;
      const reduced = reducedMotion.value;

      // Re-derive what's under the pointer only when `dirty` (a move, scroll
      // or hot change happened), never every frame. elementFromPoint, NOT
      // pointerover/out: those only fire on pointer MOVEMENT, so the hover got
      // "stuck" while the page scrolled under a still mouse. Canvases (Mac /
      // Hobbies / keypad) signal via body cursor:pointer or the hot prop.
      if (dirty) {
        dirty = false;
        let el: Element | null = null;
        if (revealed) {
          const hit = document.elementFromPoint(px, py);
          el = hit && hit.closest ? hit.closest(CLICKABLE_SEL) : null;
        }
        const next = !!el || hotRef.current || document.body.style.cursor === "pointer";
        if (next && !hovering && !reduced) {
          scale.v += 5; // the pop
        }
        hovering = next;
        hoverEl = el;
      }

      // Velocity / acceleration of the tip, smoothed, for the swing.
      const rvx = (px - lx) / dt, rvy = (py - ly) / dt;
      lx = px;
      ly = py;
      const kv = 1 - Math.exp(-20 * dt), ka = 1 - Math.exp(-12 * dt);
      vx += (rvx - vx) * kv;
      vy += (rvy - vy) * kv;
      ax += ((vx - pvx) / dt - ax) * ka;
      ay += ((vy - pvy) / dt - ay) * ka;
      pvx = vx;
      pvy = vy;
      const moving = Math.hypot(vx, vy) > 4 || Math.hypot(ax, ay) > 30;

      // Swing: hangs from the tip, so it trails the motion.
      const cl = (v: number) => Math.max(-0.85, Math.min(0.85, v));
      const tx = reduced ? REST.rx : REST.rx + cl(-ay / 7000 - vy / 4200);
      const ty = reduced ? REST.ry : REST.ry + cl(ax / 7000 + vx / 4200);
      let busy = false;
      busy = step(rx, tx, dt, 110, 0.32, reduced) || busy;
      busy = step(ry, ty, dt, 110, 0.32, reduced) || busy;
      busy = step(depth, down ? 0.18 : 1, dt, 520, down ? 0.9 : 0.3, reduced) || busy;
      busy = step(scale, down ? 0.88 : 1, dt, 380, down ? 0.9 : 0.4, reduced) || busy;
      busy = step(spark, hovering ? 1 : 0, dt, 300, 0.45, reduced) || busy;
      busy = step(ring, hovering ? 1 : 0, dt, 260, 0.55, reduced) || busy;
      busy = step(lock, hovering && hoverEl ? 1 : 0, dt, 220, 0.85, reduced) || busy;

      // Draw.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, CANVAS, CANVAS);
      if (ring.x > 0.02) {
        // the ring sits in the same pixel grid as the voxels
        drawPixelRing(ctx, HALF, HALF, RING_R * Math.min(1.15, ring.x), 2, Math.min(1, ring.x * 1.5), true);
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.t += dt / 0.42;
        if (p.t >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        // iris: radius and cell size grow together ("pixels growing")
        const r = RING_R + (HALF - 6 - RING_R) * (1 - Math.pow(1 - p.t, 2));
        drawPixelRing(ctx, HALF, HALF, r, Math.max(2, r / 7), 1 - p.t);
        busy = true;
      }
      const pose: Pose = { rx: rx.x, ry: ry.x, depth: Math.max(0.05, depth.x), scale: scale.x };
      if (spark.x > 0.02) {
        // sparks rise toward the viewer as their own little voxel bars
        drawVoxels(ctx, SPARKS, HALF, HALF, { ...pose, depth: pose.depth * 0.5 }, dpr, {
          lift: spark.x * VOXEL * 4,
          shadow: false,
        });
      }
      drawVoxels(ctx, ARROW, HALF, HALF, pose, dpr);
      layoutLock(lock.x);

      // Keep ticking while animating, moving, or a hit-test is pending; else PARK.
      if (busy || moving || dirty || pulses.length) frame = requestAnimationFrame(tick);
      else running = false;
    };
    const schedule = () => {
      if (!running) {
        running = true;
        lastT = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };
    wakeRef.current = () => {
      dirty = true;
      schedule();
    };

    // Press AND HOLD: squash on pointerdown and STAY down until the button is
    // released (or the gesture is cancelled / the window blurs).
    const onDown = (e: PointerEvent) => {
      // Only the LEFT button (0) is a real click. Right-click (2) is disabled
      // site-wide (App.tsx suppresses the context menu) and middle-click (1)
      // drives the pan cursor, so neither plays the press.
      if (e.button !== 0 || !isMouse(e)) return;
      down = true;
      schedule();
    };
    const onUp = () => {
      if (!down) return;
      down = false;
      if (!reducedMotion.value) pulses.push({ t: 0 });
      schedule();
    };
    // Page scrolled under a (possibly still) cursor: re-check what's under it,
    // and keep the hairlines on the element as it moves.
    const onScroll = () => {
      dirty = true;
      schedule();
    };
    const onResize = () => {
      fitCanvas();
      schedule();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("blur", onUp);
    schedule();
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onResize);
      window.removeEventListener("blur", onUp);
      cancelAnimationFrame(frame);
      wakeRef.current = () => {};
      document.documentElement.classList.remove("custom-cursor");
    };
  }, []);

  return (
    <>
      {/* Lock-on hairlines + edge ticks: a fixed full-viewport layer under the
          arrow, laid out from JS only while hovering a clickable. */}
      <div ref={lockRef} className="moveable-cursor-lock" aria-hidden>
        <i className="mcl-h" />
        <i className="mcl-h" />
        <i className="mcl-v" />
        <i className="mcl-v" />
        <i className="mcl-tick mcl-tick--v" />
        <i className="mcl-tick mcl-tick--v" />
        <i className="mcl-tick mcl-tick--h" />
        <i className="mcl-tick mcl-tick--h" />
      </div>
      <div ref={root} className="moveable-cursor" aria-hidden>
        <canvas
          ref={canvasRef}
          className="moveable-cursor__canvas"
          style={{ left: -HALF, top: -HALF, width: CANVAS, height: CANVAS }}
        />
      </div>
    </>
  );
}
