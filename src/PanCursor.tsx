import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { panScrollTo } from "./scroll";
import { PAN_DOWN, PAN_NEUTRAL, PAN_UP, drawVoxels } from "./voxelArt";
import "./pan-cursor.css";

/**
 * Middle-button PAN cursor (browser-style autoscroll, custom art).
 *
 * Press the mouse-wheel button to start panning: the click point becomes the
 * scroll REFERENCE (anchorRef) and the page scrolls in whichever direction you
 * move away from it, faster the further you go. The pan icon itself FOLLOWS the
 * pointer freely (it is NOT locked to the click point): within the deadzone it
 * shows the neutral art (up + down darts around a central gap), and while
 * scrolling the direction art (one big dart + motion feathers) pointing up or
 * down. Both are VOXEL art (voxelArt.ts, rasterised from Pan-Neutral.svg and
 * Pan-Direction.svg paths) matching the voxel arrow. Press the wheel again, click any other button, or hit Escape to
 * stop.
 *
 * HOTSPOT: each art's ANCHOR point (the gap centre of Neutral; the notch above
 * Direction's arrow) is the canvas centre, which sits at the LIVE pointer, so
 * the neutral->direction swap never jumps.
 *
 * POSITION is a ref written to the root's `transform: translate3d()` from the
 * pan rAF loop: no React render per pointermove, and a compositor translate
 * instead of left/top layout. React only re-renders on enter/exit and on a
 * direction flip.
 *
 * Desktop only (no middle button on touch). The OS cursor is hidden site-wide;
 * the regular arrow cursor is suppressed while panning (html.pan-scrolling).
 */

// Voxel art (voxelArt.ts, rasterised from the old Pan-Neutral / Pan-Direction SVGs
// at the arrow's exact scale, so the pan cursor matches the voxel arrow). The
// canvas is centred on the anchor; the art fits in ±PAN_W/2 × ±PAN_H/2.
const PAN_W = 72;
const PAN_H = 112;
const PAN_POSE = { rx: 0.42, ry: -0.6, depth: 1, scale: 1 };

const DEADZONE = 16; // px around the anchor with no scroll (stays neutral)
// Time-based (px/SECOND) so the rate is identical at 60Hz / 120Hz / headless.
const MAX_SPEED = 3400; // px/s cap
const SPEED_GAIN = 32; // px/s per px of pointer offset past the deadzone

function placeRoot(el: HTMLDivElement | null, p: { x: number; y: number }) {
  if (el) el.style.transform = `translate3d(${p.x}px,${p.y}px,0)`;
}

export function PanCursor() {
  const [active, setActive] = useState(false);
  const [dir, setDir] = useState(0); // -1 = up, 0 = neutral, 1 = down
  // The icon FOLLOWS the live pointer (free movement). The click point lives in
  // anchorRef only as the scroll reference; the cursor is not locked to it.
  const posRef = useRef({ x: 0, y: 0 });
  const rootRef = useRef<HTMLDivElement>(null);

  // Live mirrors read by the rAF loop / listeners without re-subscribing.
  const activeRef = useRef(false);
  const anchorRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef(0);
  const dirRef = useRef(0);
  // Our OWN running scroll target (accumulated frame to frame) so the autoscroll
  // rate is deterministic and never compounds.
  const targetRef = useRef(0);

  // Draw the voxel art for the current state (neutral / up / down) once per
  // state change; the throb is CSS.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!active || !c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = PAN_W * dpr;
    c.height = PAN_H * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, PAN_W, PAN_H);
    const cells = dir === 0 ? PAN_NEUTRAL : dir > 0 ? PAN_DOWN : PAN_UP;
    drawVoxels(ctx, cells, PAN_W / 2, PAN_H / 2, PAN_POSE, dpr);
  }, [active, dir]);

  // Place the root at the pointer before the first paint of a pan (the rAF
  // loop keeps it there afterwards).
  useLayoutEffect(() => {
    if (active) placeRoot(rootRef.current, posRef.current);
  }, [active]);

  useEffect(() => {
    const html = document.documentElement;

    const enter = (x: number, y: number) => {
      activeRef.current = true;
      anchorRef.current = { x, y };
      offsetRef.current = 0;
      dirRef.current = 0;
      targetRef.current = window.scrollY;
      posRef.current = { x, y };
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
      // Cursor follows the pointer freely; the rAF loop draws it.
      posRef.current = { x: e.clientX, y: e.clientY };
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
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); // clamp stalls
      last = now;
      placeRoot(rootRef.current, posRef.current);
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

  return (
    <div className="pan-cursor" aria-hidden ref={rootRef}>
      {/* Pop layer: the drop-in pop animates `transform` here, so it never
          fights the root's positioning transform. The throb lives on the
          canvas inside, toward the arrow (down or up). */}
      <div className="pan-cursor__pop">
        <canvas
          ref={canvasRef}
          className={`pan-cursor__art${dir > 0 ? " is-down" : dir < 0 ? " is-up" : ""}`}
          style={{ left: -PAN_W / 2, top: -PAN_H / 2, width: PAN_W, height: PAN_H }}
        />
      </div>
    </div>
  );
}
