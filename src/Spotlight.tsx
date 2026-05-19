import { useEffect, useRef } from "react";

/**
 * Soft warm "spotlight" that follows the cursor with damping. A
 * fixed-position div whose `background` is a radial-gradient anchored
 * to CSS variables; a RAF loop lerps those variables toward the live
 * pointer so the spot reads as heavy/intentional rather than locked
 * to the cursor 1:1.
 *
 * Multiply blend: warm amber over the off-white wrapper pulls the
 * underlying pixels toward warmer amber where the spotlight lands,
 * leaving the rest of the page untouched. Reads as "daylight follows
 * you" instead of a drawn halo.
 *
 * Above the R3F canvas (z-index 1) but with `pointer-events: none`,
 * so 3D interactions and HUD clicks pass through cleanly.
 */
const RESPONSE_LERP = 0.12; // per frame at 60fps → ~ 5-frame settle
const RADIUS_PX = 340; // gradient outer radius

export function Spotlight() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Live (target) and smoothed (current) pointer in CSS pixels.
    let tx = window.innerWidth / 2;
    let ty = window.innerHeight / 2;
    let x = tx;
    let y = ty;

    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    const tick = () => {
      x += (tx - x) * RESPONSE_LERP;
      y += (ty - y) * RESPONSE_LERP;
      // setProperty avoids React re-renders. Runs every frame.
      el.style.setProperty("--mx", `${x.toFixed(1)}px`);
      el.style.setProperty("--my", `${y.toFixed(1)}px`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1,
        pointerEvents: "none",
        // Radial gradient anchored to the CSS vars the RAF loop drives.
        // Warm amber at low alpha at the centre, fading to fully
        // transparent by 60% radius — the transparent stop ensures the
        // multiply blend leaves untouched pixels unchanged.
        background: `radial-gradient(circle ${RADIUS_PX}px at var(--mx, 50%) var(--my, 50%), rgba(255, 165, 95, 0.28), rgba(255, 165, 95, 0) 60%)`,
        mixBlendMode: "multiply",
        // CSS variable fallback for the first paint before RAF lerps.
        ["--mx" as never]: "50vw",
        ["--my" as never]: "50vh",
      }}
    />
  );
}
