import { useEffect, useRef } from "react";
import { reducedMotion } from "./motion";
import { ARROW, SPARKS, VOXEL, drawVoxels, sparkBurst, type Pose } from "./voxelArt";

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
 *  - Over anything CLICKABLE: the arrow pops and the hover art's three
 *    sparks (the "exclamations") rise out as voxels. That's all: the owner
 *    found a reticle ring and lock-on hairlines on top of the sparks too much.
 *    Canvas hot-spots (keypad / Mac / Hobbies, which set body cursor to
 *    `pointer`) get the same.
 *  - Press and HOLD: the block squashes flat like a key going down and stays
 *    down until release; the sparks retract into the tip (charging).
 *  - Release (the click): springs back up and the sparks GO OFF: seven spark
 *    bars burst out over the open 240° round the tip (never through the
 *    arrow's body), shrinking and fading as they fly. The hover sparks stay
 *    retracted until the burst has cleared, then grow back only if the pointer
 *    is STILL over a live clickable (re-checked every frame for SETTLE_MS
 *    after the click, since clicks remove / hide / move their targets under a
 *    still mouse; owner bug: sparks came back over nothing and flickered).
 *  - Reduced motion: no swing, no burst; states switch without springs.
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
/** After a click, hit-test every frame this long (targets vanish / move). */
const SETTLE_MS = 900;
/** Hover must hold this long before the sparks come out (anti-flicker). */
const HOVER_ON_MS = 70;
/** Minimum gap between hover pops. */
const POP_COOLDOWN_MS = 300;

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
    if (!rootEl || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

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

    // Hovering a clickable element or a canvas hot-spot. `hoverEl` is the
    // DOM element (null for canvas hot-spots), kept to validate it per frame.
    let hovering = false;
    let hoverEl: Element | null = null;
    let down = false;
    // A click often removes, hides or moves what was under the pointer (a menu
    // closes, a section jumps) while the mouse sits still, so no move event
    // re-checks it. For SETTLE_MS after a release, hit-test every frame.
    let settleUntil = 0;
    // Hover ON is debounced (must hold for HOVER_ON_MS) so a target that
    // flickers in and out under a still pointer can't pulse the sparks; OFF is
    // immediate. The pop has its own cooldown.
    let pendingOnSince = -1;
    let lastPop = -1e9;

    const rx: Spring = { x: REST.rx, v: 0 };
    const ry: Spring = { x: REST.ry, v: 0 };
    const depth: Spring = { x: 1, v: 0 };
    const scale: Spring = { x: 1, v: 0 };
    const spark: Spring = { x: 0, v: 0 };
    const bursts: { t: number }[] = [];

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
      if (now < settleUntil) dirty = true;
      // Still hovering a DOM target? It must still be in the page, visible and
      // under the pointer; if not, re-check now rather than on the next move.
      if (!dirty && hovering && hoverEl) {
        const r = hoverEl.getBoundingClientRect();
        const gone =
          !hoverEl.isConnected ||
          px < r.left || px > r.right || py < r.top || py > r.bottom ||
          (typeof hoverEl.checkVisibility === "function" &&
            !hoverEl.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
        if (gone) dirty = true;
      }
      let pending = false;
      if (dirty) {
        dirty = false;
        let el: Element | null = null;
        if (revealed) {
          const hit = document.elementFromPoint(px, py);
          el = hit && hit.closest ? hit.closest(CLICKABLE_SEL) : null;
          if (
            el &&
            typeof el.checkVisibility === "function" &&
            !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
          )
            el = null;
        }
        const next = !!el || hotRef.current || document.body.style.cursor === "pointer";
        if (!next) {
          hovering = false; // OFF: immediate
          hoverEl = null;
          pendingOnSince = -1;
        } else if (hovering) {
          hoverEl = el; // moved between clickables
        } else {
          // ON: only once it has held for HOVER_ON_MS (re-tested each frame)
          if (pendingOnSince < 0) pendingOnSince = now;
          if (now - pendingOnSince >= HOVER_ON_MS) {
            hovering = true;
            hoverEl = el;
            pendingOnSince = -1;
            if (!reduced && now - lastPop > POP_COOLDOWN_MS) {
              scale.v += 5; // the pop
              lastPop = now;
            }
          } else {
            pending = true;
            dirty = true;
          }
        }
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
      // Sparks: out while hovering, in while pressed or bursting.
      busy = step(spark, hovering && !down && !bursts.length ? 1 : 0, dt, down ? 600 : 300, down ? 0.9 : 0.45, reduced) || busy;

      // Draw.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, CANVAS, CANVAS);
      const pose: Pose = { rx: rx.x, ry: ry.x, depth: Math.max(0.05, depth.x), scale: scale.x };
      // Click: the ring of exclamations, under the arrow.
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.t += dt / 0.4;
        if (b.t >= 1) {
          bursts.splice(i, 1);
          continue;
        }
        const e = 1 - Math.pow(1 - b.t, 3); // fast out, easing to a stop
        ctx.globalAlpha = b.t < 0.55 ? 1 : 1 - (b.t - 0.55) / 0.45;
        drawVoxels(ctx, sparkBurst(13 + 22 * e, 4.5 - 3 * b.t), HALF, HALF, { ...pose, depth: 0.5 }, dpr, { shadow: false });
        ctx.globalAlpha = 1;
        busy = true;
      }
      if (spark.x > 0.02) {
        // sparks rise toward the viewer as their own little voxel bars
        drawVoxels(ctx, SPARKS, HALF, HALF, { ...pose, depth: pose.depth * 0.5 }, dpr, {
          lift: spark.x * VOXEL * 4,
          shadow: false,
        });
      }
      drawVoxels(ctx, ARROW, HALF, HALF, pose, dpr);

      // Keep ticking while animating, moving, or a hit-test is pending; else PARK.
      if (busy || moving || dirty || pending || bursts.length || now < settleUntil) frame = requestAnimationFrame(tick);
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
      if (!reducedMotion.value) bursts.push({ t: 0 });
      settleUntil = performance.now() + SETTLE_MS;
      dirty = true;
      schedule();
    };
    // Page scrolled under a (possibly still) cursor: re-check what's under it.
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
    <div ref={root} className="moveable-cursor" aria-hidden>
      <canvas
        ref={canvasRef}
        className="moveable-cursor__canvas"
        style={{ left: -HALF, top: -HALF, width: CANVAS, height: CANVAS }}
      />
    </div>
  );
}
