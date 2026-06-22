import { useEffect, useRef, useState } from "react";

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

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

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

    const onMove = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      applyTransform();
      if (!revealed) {
        revealed = true;
        rootEl.style.opacity = "1";
      }
    };

    const tick = () => {
      // Ease the press scale toward its target: snappy DOWN, softer UP.
      const rate = pressTarget < pressCur ? 0.5 : 0.26;
      pressCur += (pressTarget - pressCur) * rate;
      if (Math.abs(pressTarget - pressCur) < 0.001) pressCur = pressTarget;
      applyTransform();

      // Re-derive the clickable (spark) state EVERY FRAME from whatever is under
      // the pointer right now — via elementFromPoint, NOT pointerover/pointerout.
      // Those only fire on real pointer MOVEMENT, so while the page scrolled
      // under a stationary mouse the spark got "stuck" (it wouldn't light up over
      // links/buttons you scrolled onto until you wiggled the mouse). A per-frame
      // hit-test tracks whatever scrolls beneath the cursor.
      // Canvases (Mac / Hobbies tiles) also signal via body cursor:pointer (an
      // inline string read directly; the global `cursor:none !important` only
      // changes the COMPUTED value).
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
      frame = requestAnimationFrame(tick);
    };

    // Press AND HOLD: dip on pointerdown and STAY dipped until the button is
    // released (or the gesture is cancelled / the window blurs), so holding the
    // mouse down keeps the cursor pressed instead of bouncing straight back.
    const onDown = () => {
      if (!reduced) pressTarget = PRESS_SCALE;
    };
    const onUp = () => {
      pressTarget = 1;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    window.addEventListener("blur", onUp);
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("blur", onUp);
      cancelAnimationFrame(frame);
    };
  }, []);

  const showHover = hot || clickable;
  const src = showHover ? "/Cursor-Hover.svg" : "/Cursor.svg";
  const w = showHover ? HOVER_W : ART_W;
  const tipX = showHover ? HOVER_TIP_X : TIP_X;
  const tipY = showHover ? HOVER_TIP_Y : TIP_Y;

  return (
    <div
      ref={root}
      className={`moveable-cursor${showHover ? " moveable-cursor--clickable" : ""}`}
      aria-hidden
    >
      <img
        className="moveable-cursor__arrow"
        src={src}
        width={w}
        alt=""
        draggable={false}
        style={{ left: -tipX, top: -tipY, transformOrigin: `${tipX}px ${tipY}px` }}
      />
    </div>
  );
}
