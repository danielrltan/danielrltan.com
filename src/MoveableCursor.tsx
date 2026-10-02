import { useEffect, useRef, useState } from "react";
import { DECAY, damp, reducedMotion } from "./motion";

interface Props {
  /** True while the keypad reports the pointer is over an interactive cap/dial. */
  hot: boolean;
}

/**
 * Custom site pointer: the charcoal (#1B1B1F) arrow from public/Cursor.svg with
 * a white keyline and soft shadow. Charcoal is the one tone NOT in the site's
 * white+orange palette, so the pointer stays legible on the white page, on solid
 * orange UI, and on the orange dotted texture alike. The OS cursor is hidden
 * site-wide (see the global `cursor: none` in index.css) so this is the only
 * pointer shown.
 *
 * Over anything CLICKABLE the arrow swaps to public/Cursor-Hover.svg — the same
 * charcoal arrow with three little charcoal spark lines by the tip — and pops in.
 * "Clickable" = the keypad `hot` signal, OR a DOM element matching the
 * interactive selector below, OR a canvas that set body cursor to `pointer`.
 *
 * Hotspot = the arrow's TIP: the 0×0 root sits exactly at the pointer and each
 * SVG is nudged up-left by ITS OWN tip offset so the tip stays put when the
 * spark variant swaps in.
 */

// Both SVGs draw the identical dart; only the canvas size (hence the tip's
// coordinate) differs. Rendering both at the same SCALE keeps one fixed arrow
// size and a fixed hotspot. Tip points: Cursor.svg (151×165) -> (19.9652,
// 14.4321); Cursor-Hover.svg (189×205) -> (57.6095, 54.9027).
const ART_W = 32; // default canvas width on screen
const SCALE = ART_W / 151;
const TIP_X = 19.9652 * SCALE; // ≈ 4.23px
const TIP_Y = 14.4321 * SCALE; // ≈ 3.06px
const HOVER_W = 189 * SCALE; // wider canvas, same arrow size (≈ 40px)
const HOVER_TIP_X = 57.6095 * SCALE; // ≈ 12.21px
const HOVER_TIP_Y = 54.9027 * SCALE; // ≈ 11.64px

// Elements that should show the spark (clickable) variant. `closest()` against
// this walks ancestors, so a span inside a button still counts.
const CLICKABLE_SEL =
  'a[href], button, [role="button"], [role="link"], [role="menuitem"], summary, label[for], select, [data-clickable]';

export function MoveableCursor({ hot }: Props) {
  const root = useRef<HTMLDivElement>(null);
  // Whether the pointer is over a clickable surface (drives the spark variant).
  const [clickable, setClickable] = useState(false);

  useEffect(() => {
    const rootEl = root.current;
    if (!rootEl) return;

    let px = 0;
    let py = 0; // live pointer
    let revealed = false;
    let frame = 0;
    let lastClick = false; // last value pushed to React (setState only on change)
    // PERF: the loop PARKS when idle instead of re-arming the rAF forever. Every
    // desktop visitor ran this loop continuously — doing an elementFromPoint() +
    // closest() forced hit-test EVERY frame even on a perfectly still page. Now
    // `running` guards re-arm and `dirty` marks a pending clickable hit-test (set
    // on move + scroll). Once the press spring has settled AND no hit-test is
    // pending, tick() stops scheduling, so a stationary cursor costs nothing.
    let running = false;
    let dirty = true;
    // Time of the last tick (performance.now ms). Reset whenever the loop wakes
    // from park, so the first frame's dt is one frame, not the idle gap (which
    // clampDt would cap at 0.1 s and jump the press ~98% in one frame).
    let lastT = 0;

    // PRESS-AND-HOLD dip. pressTarget is 1 (up) or PRESS_SCALE (held down);
    // pressCur eases toward it every frame — fast on the way DOWN (reactive
    // click) and softer on the way UP (a little spring on release). The scale is
    // composed into the ROOT transform (alongside the translate) so it scales
    // around the root origin = the arrow's TIP, and it never fights the inner
    // arrow's hover-pop animation. Holding the button keeps it dipped; the old
    // one-shot keyframe popped back up even while you were still holding.
    const PRESS_SCALE = 0.82;
    let pressTarget = 1;
    let pressCur = 1;

    // Hidden until the first real pointer position so it doesn't ghost at the
    // viewport origin on load.
    rootEl.style.opacity = "0";

    const applyTransform = () => {
      rootEl.style.transform = `translate3d(${px}px,${py}px,0) scale(${pressCur})`;
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
      applyTransform(); // follow IMMEDIATELY — never wait on the (parkable) tick
      if (!revealed) {
        revealed = true;
        rootEl.style.opacity = "1";
        // Only now hide the OS cursor (index.css keys off this class), so the
        // page never shows NO pointer before the first move.
        document.documentElement.classList.add("custom-cursor");
      }
      dirty = true; // pointer moved → re-check what's underneath
      schedule();
    };

    const tick = () => {
      // Ease the press scale toward its target: snappy DOWN (DECAY.press, τ
      // 25 ms), softer UP (DECAY.fast, τ 55 ms). dt-based, so the press feels
      // the same at 60 and 120 Hz (the old 0.5 / 0.26 per-frame lerp ran twice
      // as fast at 120 Hz; these rates match it at 60 Hz).
      const now = performance.now();
      const dt = (now - lastT) / 1000;
      lastT = now;
      const rate = pressTarget < pressCur ? DECAY.press : DECAY.fast;
      pressCur = damp(pressCur, pressTarget, rate, dt);
      let springActive = true;
      if (Math.abs(pressTarget - pressCur) < 0.001) {
        pressCur = pressTarget;
        springActive = false;
      }
      applyTransform();

      // Re-derive the clickable (spark) state from whatever is under the pointer
      // — via elementFromPoint, NOT pointerover/pointerout (those only fire on
      // pointer MOVEMENT, so the spark got "stuck" while the page SCROLLED under a
      // stationary mouse). Run it only when `dirty` (a move or scroll happened),
      // not every frame — same coverage, none of the idle hit-test storm.
      // Canvases (Mac / Hobbies tiles) signal via body cursor:pointer (an inline
      // string; the global `cursor:none !important` only changes the COMPUTED
      // value), set during their own pointer events, which also mark us dirty.
      if (dirty) {
        dirty = false;
        let domClick = false;
        if (revealed) {
          const el = document.elementFromPoint(px, py);
          domClick = !!(el && el.closest && el.closest(CLICKABLE_SEL));
        }
        const next = domClick || document.body.style.cursor === "pointer";
        if (next !== lastClick) {
          lastClick = next;
          setClickable(next);
        }
      }

      // Keep ticking while the spring is animating OR a hit-test is pending; once
      // both are idle, PARK (stop re-arming) until the next move/scroll/press.
      if (springActive || dirty) {
        frame = requestAnimationFrame(tick);
      } else {
        running = false;
      }
    };
    const schedule = () => {
      if (!running) {
        running = true;
        lastT = performance.now();
        frame = requestAnimationFrame(tick);
      }
    };

    // Press AND HOLD: dip on pointerdown and STAY dipped until the button is
    // released (or the gesture is cancelled / the window blurs), so holding the
    // mouse down keeps the cursor pressed instead of bouncing straight back.
    const onDown = (e: PointerEvent) => {
      // Only the LEFT button (0) is a real click. Right-click (2) is disabled
      // site-wide (App.tsx suppresses the context menu) and middle-click (1)
      // drives the pan cursor — so don't play the press dip for either, or the
      // cursor would animate an action that can't happen.
      if (e.button !== 0 || !isMouse(e)) return;
      if (!reducedMotion.value) pressTarget = PRESS_SCALE;
      schedule(); // wake the loop to animate the press dip
    };
    const onUp = () => {
      pressTarget = 1;
      schedule(); // wake the loop to animate the release spring
    };
    // Page scrolled under a (possibly stationary) cursor → the content beneath it
    // changed, so re-check the clickable state. This is the stuck-spark fix that
    // the old per-frame hit-test covered for free; now it's an explicit wake.
    const onScroll = () => {
      dirty = true;
      schedule();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("blur", onUp);
    schedule();
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("blur", onUp);
      cancelAnimationFrame(frame);
      document.documentElement.classList.remove("custom-cursor");
    };
  }, []);

  const showHover = hot || clickable;

  // BOTH arts are always rendered and the inactive one is transparent, so the
  // spark variant is fetched + decoded at mount. Swapping `src` on first hover
  // left a blank cursor for a frame or more on a cold cache.
  return (
    <div
      ref={root}
      className={`moveable-cursor${showHover ? " moveable-cursor--clickable" : ""}`}
      aria-hidden
    >
      <img
        className="moveable-cursor__arrow"
        src="/Cursor.svg"
        width={ART_W}
        alt=""
        draggable={false}
        style={{
          left: -TIP_X,
          top: -TIP_Y,
          transformOrigin: `${TIP_X}px ${TIP_Y}px`,
          opacity: showHover ? 0 : 1,
        }}
      />
      <img
        className="moveable-cursor__arrow"
        src="/Cursor-Hover.svg"
        width={HOVER_W}
        alt=""
        draggable={false}
        style={{
          left: -HOVER_TIP_X,
          top: -HOVER_TIP_Y,
          transformOrigin: `${HOVER_TIP_X}px ${HOVER_TIP_Y}px`,
          opacity: showHover ? 1 : 0,
        }}
      />
    </div>
  );
}
