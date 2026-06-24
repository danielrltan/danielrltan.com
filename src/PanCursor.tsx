import { useEffect, useRef, useState } from "react";
import { panScrollTo } from "./portfolio/Keypad";
import "./pan-cursor.css";

/**
 * Middle-button PAN cursor (browser-style autoscroll, custom art).
 *
 * Press the mouse-wheel button to start panning: the click point becomes the
 * scroll REFERENCE (anchorRef) and the page scrolls in whichever direction you
 * move away from it, faster the further you go. The pan icon itself FOLLOWS the
 * pointer freely (it is NOT locked to the click point): it shows Pan-Neutral.svg
 * (up + down chevrons around a central gap) within the deadzone, and
 * Pan-Direction.svg (one big arrow + motion feathers) flipped up/down while
 * scrolling. Press the wheel again, click any other button, or hit Escape to
 * stop.
 *
 * HOTSPOT: each art's ANCHOR point (the gap centre of Neutral; the notch above
 * Direction's arrow) sits at the LIVE pointer, so the neutral->direction swap
 * never jumps and the pointer's location is preserved across both. Both arts
 * draw the chevron at the same coordinates, so a single SCALE keeps the
 * on-screen size + hotspot consistent.
 *
 * Desktop only (no middle button on touch). The OS cursor is hidden site-wide;
 * the regular arrow cursor is suppressed while panning (html.pan-scrolling).
 */

// SVG viewBox dims + the anchor point (where the pointer sits) inside each.
const NEUTRAL = { w: 148, h: 317, ax: 74, ay: 150.8 };
const DIRN = { w: 147, h: 212, ax: 73.5, ay: 46 };
// px per SVG unit. The pan arts are authored at the SAME coordinate scale as the
// normal cursor (Cursor.svg is 151 wide, rendered at ART_W = 32; identical 7.4
// stroke + drop-shadow), so using its exact scale renders the pan cursor at the
// EXACT same size (matching stroke weight + shadow) as the normal arrow.
const SCALE = 32 / 151;

const DEADZONE = 16; // px around the anchor with no scroll (stays neutral)
// Time-based (px/SECOND) so the rate is identical at 60Hz / 120Hz / headless.
const MAX_SPEED = 3400; // px/s cap
const SPEED_GAIN = 32; // px/s per px of pointer offset past the deadzone

export function PanCursor() {
  const [active, setActive] = useState(false);
  const [dir, setDir] = useState(0); // -1 = up, 0 = neutral, 1 = down
  // The icon FOLLOWS the live pointer (free movement). The click point lives in
  // anchorRef only as the scroll reference; the cursor is not locked to it.
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Live mirrors read by the rAF loop / listeners without re-subscribing.
  const activeRef = useRef(false);
  const anchorRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef(0);
  const dirRef = useRef(0);
  // Our OWN running scroll target (accumulated frame to frame) so the autoscroll
  // rate is deterministic and never compounds.
  const targetRef = useRef(0);

  useEffect(() => {
    const html = document.documentElement;

    const enter = (x: number, y: number) => {
      activeRef.current = true;
      anchorRef.current = { x, y };
      offsetRef.current = 0;
      dirRef.current = 0;
      targetRef.current = window.scrollY;
      setPos({ x, y });
      setDir(0);
      setActive(true);
      html.classList.add("pan-scrolling");
      // Start the autoscroll loop ONLY now (a pan began). It used to re-arm every
      // frame for the whole page lifetime doing nothing — pure idle waste.
      last = performance.now();
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const exit = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      setActive(false);
      html.classList.remove("pan-scrolling");
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1) {
        e.preventDefault(); // stop native middle-click autoscroll
        if (activeRef.current) exit();
        else enter(e.clientX, e.clientY);
      } else if (activeRef.current) {
        exit(); // any other button ends pan mode
      }
    };
    // The native autoscroll keys off `mousedown` (button 1); block it there too.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!activeRef.current) return;
      setPos({ x: e.clientX, y: e.clientY }); // cursor follows the pointer freely
      const off = e.clientY - anchorRef.current.y;
      offsetRef.current = off;
      const d = Math.abs(off) < DEADZONE ? 0 : off > 0 ? 1 : -1;
      if (d !== dirRef.current) {
        dirRef.current = d;
        setDir(d);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") exit();
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", exit);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); // clamp stalls
      last = now;
      if (activeRef.current) {
        const off = offsetRef.current;
        const over = Math.abs(off) - DEADZONE;
        if (over > 0) {
          const vps = Math.sign(off) * Math.min(over * SPEED_GAIN, MAX_SPEED); // px/s
          const max = Math.max(
            0,
            document.documentElement.scrollHeight - window.innerHeight,
          );
          targetRef.current = Math.max(
            0,
            Math.min(max, targetRef.current + vps * dt),
          );
          panScrollTo(targetRef.current);
        } else {
          // In the deadzone: hold position, keep the target in sync so resuming
          // doesn't jump.
          targetRef.current = window.scrollY;
        }
      }
      // Keep looping ONLY while a pan is active; otherwise park. enter() restarts
      // it on the next middle-click. (No permanent mount-time start anymore.)
      if (activeRef.current) raf = requestAnimationFrame(tick);
      else raf = 0;
    };

    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", exit);
      cancelAnimationFrame(raf);
      html.classList.remove("pan-scrolling");
    };
  }, []);

  if (!active) return null;

  const isDir = dir !== 0;
  const vb = isDir ? DIRN : NEUTRAL;
  const w = vb.w * SCALE;
  const h = vb.h * SCALE;
  const ax = vb.ax * SCALE;
  const ay = vb.ay * SCALE;
  const src = isDir ? "/Pan-Direction.svg" : "/Pan-Neutral.svg";

  return (
    <div className="pan-cursor" aria-hidden style={{ left: pos.x, top: pos.y }}>
      {/* Flip layer: the down-art is mirrored vertically (around the anchor) for
          the UP direction. Throb lives on the img inside, so the two transforms
          never collide. */}
      <div
        className="pan-cursor__flip"
        style={{ transform: dir === -1 ? "scaleY(-1)" : "none" }}
      >
        <img
          key={isDir ? `d${dir}` : "n"}
          className={`pan-cursor__art${isDir ? " is-dir" : ""}`}
          src={src}
          width={w}
          height={h}
          alt=""
          draggable={false}
          style={{ left: -ax, top: -ay }}
        />
      </div>
    </div>
  );
}
