import { useEffect, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";

/**
 * Full-screen loading overlay. The static HTML `#boot-screen` in
 * index.html covers the JS-parse gap; this component takes over on
 * React mount, then fades itself out once loading completes AND the
 * main thread has settled (see frame-stability gate below).
 */
const FADE_AFTER_READY_MS = 250;

// Grace period: after frame-stability is detected the overlay holds at
// full opacity for this long before the fade starts. Anything still
// settling into view (transparency cycles, late shader compile, physics
// warm-up) happens hidden under the overlay rather than visibly popping
// into the user's face.
const HOLD_AFTER_READY_MS = 700;

// Frame-stability gate. drei's `useProgress` flips to 100 the instant
// the last asset's onLoad fires — but three.js still has to compile
// shaders, upload textures, and warm up physics on the next few
// frames, which is the stutter the user actually sees. Hold the
// overlay up until N consecutive frames come in under the budget;
// that's the real moment the lag is over.
const STABLE_FRAMES_REQUIRED = 30;
const STABLE_FRAME_BUDGET_MS = 22;

// Blink — open frame is `cat.svg` (with eye cutouts), closed frame is
// `cat_blink.svg` (same silhouette, eyes filled in). Both render
// stacked and we toggle opacity, so the first blink has no network
// race waiting for the closed asset to fetch.
//
// Pacing is intentionally irregular: a random gap between blink
// sequences plus an occasional quick double-blink. A strict interval
// reads as a placeholder animation; randomness reads as alive.
//
// The visuals are driven via refs (`element.style.opacity = ...`)
// rather than React state. Loading is the most main-thread-loaded
// moment of the app's life — three.js shader compilation can stall
// React's commit cycle for hundreds of ms. Skipping reconciliation
// for the blink keeps each frame snappy even under that load.
const BLINK_CLOSED_MS = 100;
const BLINK_FADE_MS = 0;
// First blink fires fast so the user actually sees one before the
// scene-load main-thread blockage kicks in.
const BLINK_FIRST_MIN_MS = 200;
const BLINK_FIRST_MAX_MS = 700;
const BLINK_GAP_MIN_MS = 1600;
const BLINK_GAP_MAX_MS = 3600;
const DOUBLE_BLINK_CHANCE = 0.28;
const DOUBLE_BLINK_GAP_MIN_MS = 180;
const DOUBLE_BLINK_GAP_MAX_MS = 300;
const CAT_OPEN_SRC = "/images/cat.svg";
const CAT_CLOSED_SRC = "/images/cat_blink.svg";
const CAT_SIZE_PX = 80;

export function LoadingScreen() {
  const { progress, active } = useProgress();
  const [visible, setVisible] = useState(true);
  const [readyToFade, setReadyToFade] = useState(false);
  const [startFade, setStartFade] = useState(false);
  const openRef = useRef<HTMLImageElement>(null);
  const closedRef = useRef<HTMLImageElement>(null);

  // Pull the static index.html boot screen the moment React mounts.
  useEffect(() => {
    const bs = document.getElementById("boot-screen");
    if (bs && bs.parentNode) bs.parentNode.removeChild(bs);
  }, []);

  // Hide the custom MoveableCursor while the overlay is opaque — main
  // thread blockage during scene init makes the parallax-tracked dot
  // visibly stutter. The actual hide is the `html.loading-active`
  // rule in index.css; the class lifts the moment the fade begins so
  // the cursor reappears in sync with the room becoming interactive.
  useEffect(() => {
    if (startFade) return;
    document.documentElement.classList.add("loading-active");
    return () => document.documentElement.classList.remove("loading-active");
  }, [startFade]);

  useEffect(() => {
    let cancelled = false;
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const after = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        pending.delete(t);
        if (!cancelled) fn();
      }, ms);
      pending.add(t);
    };
    const rand = (min: number, max: number) =>
      min + Math.random() * (max - min);

    const setEyes = (open: boolean) => {
      const o = openRef.current;
      const c = closedRef.current;
      if (o) o.style.opacity = open ? "1" : "0";
      if (c) c.style.opacity = open ? "0" : "1";
    };

    const closeThenOpen = (onOpened: () => void) => {
      setEyes(false);
      after(BLINK_CLOSED_MS, () => {
        setEyes(true);
        onOpened();
      });
    };

    const cycle = (isFirst = false) => {
      const gap = isFirst
        ? rand(BLINK_FIRST_MIN_MS, BLINK_FIRST_MAX_MS)
        : rand(BLINK_GAP_MIN_MS, BLINK_GAP_MAX_MS);
      after(gap, () => {
        closeThenOpen(() => {
          if (Math.random() < DOUBLE_BLINK_CHANCE) {
            after(
              rand(DOUBLE_BLINK_GAP_MIN_MS, DOUBLE_BLINK_GAP_MAX_MS),
              () => closeThenOpen(() => cycle()),
            );
          } else {
            cycle();
          }
        });
      });
    };

    cycle(true);
    return () => {
      cancelled = true;
      pending.forEach(clearTimeout);
    };
  }, []);

  // After assets finish, watch frame deltas — only flag ready once
  // the renderer has been calm for a while. This is what actually
  // masks the shader-compile / first-frame stutter.
  useEffect(() => {
    if (readyToFade) return;
    if (active || progress < 100) return;
    let stable = 0;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (dt < STABLE_FRAME_BUDGET_MS) {
        stable++;
        if (stable >= STABLE_FRAMES_REQUIRED) {
          setReadyToFade(true);
          return;
        }
      } else {
        stable = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, progress, readyToFade]);

  // Hold opaque for HOLD_AFTER_READY_MS, then start the visual fade.
  useEffect(() => {
    if (!readyToFade) return;
    const t = setTimeout(() => setStartFade(true), HOLD_AFTER_READY_MS);
    return () => clearTimeout(t);
  }, [readyToFade]);

  // Unmount after the fade animation completes.
  useEffect(() => {
    if (!startFade) return;
    const t = setTimeout(() => setVisible(false), FADE_AFTER_READY_MS);
    return () => clearTimeout(t);
  }, [startFade]);

  if (!visible) return null;

  const fading = startFade;
  const catLayer: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    transition: `opacity ${BLINK_FADE_MS}ms ease`,
    willChange: "opacity",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#330a05",
        color: "var(--hud-amber)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        fontFamily: "var(--font-mono)",
        zIndex: 9999,
        opacity: fading ? 0 : 1,
        transition: "opacity 0.32s ease",
        pointerEvents: fading ? "none" : "auto",
        // Pair with `html.loading-active` (which hides the custom
        // cursor) — also kills the system arrow so the overlay reads
        // as a clean, deliberate full-bleed.
        cursor: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          width: CAT_SIZE_PX,
          height: CAT_SIZE_PX,
        }}
        aria-hidden
      >
        <img
          ref={openRef}
          src={CAT_OPEN_SRC}
          alt=""
          style={{ ...catLayer, opacity: 1 }}
          draggable={false}
        />
        <img
          ref={closedRef}
          src={CAT_CLOSED_SRC}
          alt=""
          style={{ ...catLayer, opacity: 0 }}
          draggable={false}
        />
      </div>
      <div
        style={{
          fontSize: "var(--text-base)",
          letterSpacing: "var(--tracking-widest)",
          textTransform: "uppercase",
          opacity: 0.7,
          minWidth: 90,
          textAlign: "center",
        }}
      >
        loading
      </div>
    </div>
  );
}
