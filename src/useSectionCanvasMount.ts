import { useEffect, useState, type RefObject } from "react";
import { isLowTier } from "./capabilityTier";

/**
 * MOBILE NEVER MOUNTS A SECTION CANVAS (≤768px).
 *
 * On a phone, the section 3D scenes (Macintosh orbit, Hobbies cluster, Keypad)
 * were live WebGL surfaces with the section's UI laid OVER them — which the owner
 * flagged as "totally broken" on mobile: interfaces on top of 3D don't work on a
 * phone, the contexts tank perf, and on weak/headless GPUs they crash the tab.
 * Every consumer ships a real DOM fallback for the small-screen layout (the Mac
 * project list, the Hobbies chips, the Keypad contact chips, the Photos grid), so
 * gating the canvas off at ≤768px loses nothing and gives a clean, fast, static
 * mobile experience. Reactive across a resize/rotation over the 768px line.
 *
 * The hero ring is intentionally NOT gated here (it's the hero's signature
 * centerpiece, mounts on its own, and reads fine on a phone).
 */
const MOBILE_QUERY = "(max-width: 768px)";

function isMobileViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MOBILE_QUERY).matches
  );
}

/**
 * Reliable mount-on-approach gate for a heavy section <Canvas>.
 *
 * THE PROBLEM IT SOLVES: every section's 3D scene (Macintosh, Hobbies, Keypad)
 * used to mount its <Canvas> unconditionally at page load, so FOUR live WebGL
 * contexts (plus the hero ring) coexisted from the first frame. On a weak
 * integrated GPU that standing context tax is the "whole screen freezes whenever
 * 3D appears" symptom, and spinning all of them up during load is a big chunk of
 * the slow start. This hook mounts a section's canvas only as it APPROACHES the
 * viewport and releases the context once the section is well out of view, so at
 * most ~1-2 heavy contexts are live at any moment. On mobile (≤768px) it never
 * mounts at all — see the file header.
 *
 * RELIABILITY (why this isn't the old, removed gate): the previous attempt was
 * dropped because "I scrolled by and nothing appeared" — a too-tight / flaky IO
 * left the section blank. Here:
 *   - the MOUNT observer uses a generous rootMargin (`mountVh` viewports), so
 *     the canvas mounts well BEFORE the section is visible; and
 *   - hysteresis (a separate, wider UNMOUNT observer + debounce) means a quick
 *     scroll-past never tears the canvas down mid-view and the boundary can't
 *     thrash.
 * No per-frame scroll/getBoundingClientRect reads (those are layout-thrash); the
 * browser computes intersection off the main thread.
 *
 * Layout-safety: callers must reserve the canvas's box independent of whether the
 * canvas is mounted (absolute/fixed wrapper, or a same-size placeholder), so
 * mounting/unmounting never changes document height and can't strand GSAP pins.
 */
export function useSectionCanvasMount(
  ref: RefObject<HTMLElement | null>,
  {
    mountVh = 1.75,
    unmountVh = 3,
    unmountDelayMs = 600,
    disableOnMobile = true,
  }: {
    mountVh?: number;
    unmountVh?: number;
    unmountDelayMs?: number;
    /**
     * When true (default), the canvas never mounts at ≤768px — the clean,
     * fast 2D mobile path (Macintosh project list, Keypad contact chips).
     * Pass `false` for a section whose 3D IS the mobile experience and must
     * stay live on a phone (the Play / Hobbies cluster fills the screen).
     */
    disableOnMobile?: boolean;
  } = {},
): boolean {
  const [mounted, setMounted] = useState(false);
  // Reactive ≤768px flag. When true the canvas is force-unmounted and the
  // approach observers are never wired, so a phone holds ZERO section WebGL
  // contexts (the clean, fast mobile path). Flips live on a resize/rotation
  // across the breakpoint so a tablet→phone rotation tears the context down.
  const [isMobile, setIsMobile] = useState(isMobileViewport);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
      return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (typeof window === "undefined" || !el) return;
    // MOBILE: don't mount a section canvas (the 2D fallback renders) — unless
    // this section opted out (its 3D is the mobile experience, e.g. Hobbies).
    if (isMobile && disableOnMobile) {
      setMounted(false);
      return;
    }
    // EAGER PATH (ported back from the pre-gate era, commit 439829b's
    // `useState(true)`): capable DESKTOP hardware mounts the canvas IMMEDIATELY,
    // so the WebGL context + GLB + first paint build during the loader hold
    // instead of on scroll-approach — the keypad-and-friends "loads in late /
    // glitches in" regression the on-approach gate introduced. The
    // IntersectionObserver approach-gate (below) is kept ONLY for low-tier
    // (freeze-prone) GPUs and the mobile-opted-in sections (Hobbies/Photos),
    // which is the ONLY hardware the gate was ever built to protect. The
    // <=768px zero-WebGL short-circuit above is untouched. On capable HW this
    // never unmounts (matches the old eager behavior); a few idle demand-loop
    // contexts cost nothing now that the 27MB live room is gone.
    if (!isMobile && !isLowTier()) {
      setMounted(true);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      // No IO support (very old browsers): fail OPEN — mount immediately so the
      // section is never blank. The perf win is a progressive enhancement.
      setMounted(true);
      return;
    }

    let unmountTimer = 0;
    const cancelUnmount = () => {
      if (unmountTimer) {
        clearTimeout(unmountTimer);
        unmountTimer = 0;
      }
    };

    // MOUNT when the section enters a band of ±mountVh viewports.
    const mountIO = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          cancelUnmount();
          setMounted(true);
        }
      },
      { rootMargin: `${Math.round(mountVh * 100)}% 0px ${Math.round(mountVh * 100)}% 0px` },
    );

    // UNMOUNT when the section leaves a WIDER band of ±unmountVh viewports
    // (debounced). The gap between the two bands is the hysteresis that keeps a
    // quick scroll-past from thrashing the context.
    const unmountIO = new IntersectionObserver(
      (entries) => {
        const near = entries.some((e) => e.isIntersecting);
        if (near) {
          cancelUnmount();
        } else if (!unmountTimer) {
          unmountTimer = window.setTimeout(() => {
            unmountTimer = 0;
            setMounted(false);
          }, unmountDelayMs);
        }
      },
      { rootMargin: `${Math.round(unmountVh * 100)}% 0px ${Math.round(unmountVh * 100)}% 0px` },
    );

    mountIO.observe(el);
    unmountIO.observe(el);
    return () => {
      mountIO.disconnect();
      unmountIO.disconnect();
      cancelUnmount();
    };
  }, [ref, mountVh, unmountVh, unmountDelayMs, isMobile, disableOnMobile]);

  return mounted;
}
