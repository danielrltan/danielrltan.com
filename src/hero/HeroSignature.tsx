import { useEffect, useRef, useState } from "react";
import { HeroSignature2D } from "./HeroSignature2D";
import { HeroAsciiRing } from "./HeroAsciiRing";
import { type SignatureData } from "./signatureGeometry";
import { useAssembly } from "../loading";
import "./hero-composition.css";

/**
 * Hero composition. ASCII ring is the kinetic centerpiece; editorial
 * type frames it (eyebrow top-left, wordmark center, meta row bottom).
 *
 * State machine:
 *   drawing:    2D signature draws on the orange loading scrim
 *   transition: both gates met (draw done + assets climaxReady),
 *               600ms crossfade window
 *   settled:    composition is the only visible layer
 */

type Phase = "drawing" | "transition" | "settled";

export function HeroSignature() {
  const [data, setData] = useState<SignatureData | null>(null);
  const [drawingComplete, setDrawingComplete] = useState(false);
  const [phase, setPhase] = useState<Phase>("drawing");
  const assembly = useAssembly();

  useEffect(() => {
    let cancelled = false;
    fetch("/signature.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setData(d as SignatureData);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Two-step state advance:
  //   1) drawing → transition (when draw complete AND assets ready)
  //   2) transition → settled (after a 600ms crossfade window)
  // Splitting these into two effects so the timeout that schedules
  // step 2 isn't torn down by the dep-change from step 1. When the
  // single combined effect re-ran on phase change, React's cleanup
  // cleared the timeout before it could fire, stranding the page
  // in `transition` forever.
  useEffect(() => {
    if (phase !== "drawing") return;
    if (!drawingComplete) return;
    if (!assembly.climaxReady) return;
    setPhase("transition");
  }, [phase, drawingComplete, assembly.climaxReady]);
  useEffect(() => {
    if (phase !== "transition") return;
    const t = window.setTimeout(() => setPhase("settled"), 600);
    return () => window.clearTimeout(t);
  }, [phase]);

  // Keep the 2D signature mounted even after the composition lands.
  // During loading it draws at full opacity on the orange scrim;
  // after settling, it lingers in the background at low opacity as a
  // ghosted gesture behind the wordmark. User explicitly wants the
  // signature to PERSIST in the EXACT same screen position as during
  // loading, "everything kinda loads around it", so we leave it as
  // a fixed-position anchor at low (but visible) opacity. 0.14 reads
  // as "there but quiet" -- bumped from 0.10 so the gesture registers
  // without competing with the wordmark.
  const twoDOpacity =
    phase === "drawing" ? 1 : phase === "transition" ? 0.5 : 0.14;
  // Z-index hand-off. While drawing/crossfading, the signature paints
  // ON TOP of the orange scrim (z 5, above the composition at z 3).
  // Once settled it drops BEHIND the composition (z 1, under the
  // wordmark fill at z 2) so the persistent ghost reads as a background
  // gesture the wordmark "loads around", not a faint veil sitting over
  // the orange type muddying its edges.
  const twoDZIndex = phase === "settled" ? 1 : 5;
  const renderTwoD = true;
  const compositionVisible = phase !== "drawing";

  // Wordmark split into per-character spans so the entrance /
  // micro-hover staggers anchor to per-character elements.
  const wordmarkLines = [
    { text: "DANIEL", className: "hero-mega-line" },
    { text: "TAN", className: "hero-mega-line hero-mega-line-2" },
  ];

  // Matrix / squared-gradient proximity hover.
  //
  // Each `.hero-mega-line` gets its own matrix overlay (a span clipped
  // to the line's text via background-clip:text) and its own --mx/--my
  // CSS variables: coordinates expressed RELATIVE TO THAT LINE's
  // bounding rect. A radial-gradient mask centered at (--mx, --my)
  // reveals only the cells within ~170px of the pointer; outside that
  // radius the overlay fades to transparent and the black ink fill
  // underneath shows through.
  //
  // Per-line (not per-wordmark) coordinates because the mask is sized
  // to the LINE box; a single wordmark-level var would land off-mask
  // on the second line.
  //
  // Pointermove never calls setState. The handler captures the event
  // into refs and schedules ONE rAF that writes --mx / --my / --mhover
  // directly to each line element. --mhover (0/1) drives a 240ms CSS
  // opacity transition so the matrix fades out on pointerleave.
  // Touch / coarse pointers skip the listener entirely (CSS also gates
  // the overlay via @media (hover: none)).
  const wordmarkRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const wrap = wordmarkRef.current;
    if (!wrap) return;
    const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
    if (coarse) return;
    // Reduced motion: skip the matrix spotlight entirely. The CSS also
    // zeroes the matrix transition, but the rAF tracking loop is the
    // motion itself; don't run it at all for these users.
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) return;

    const lines = Array.from(
      wrap.querySelectorAll<HTMLElement>(".hero-mega-line"),
    );
    if (lines.length === 0) return;

    let rafId = 0;
    // Target pos (latest pointer event) vs current pos (lerped toward
    // target each frame). Decoupling them gives the spotlight inertia
    // so it TRAILS the cursor fluidly instead of snapping. LERP_K
    // controls how quickly the spotlight catches up; 0.18 reads as
    // "responsive but viscous".
    let targetX = 0;
    let targetY = 0;
    let curX = -9999;
    let curY = -9999;
    let pendingActive = false;
    const LERP_K = 0.18;

    // PERF: cache each line's bounding rect (top-left in client coords).
    // Previously this was read via getBoundingClientRect INSIDE the rAF
    // tick, forcing layout every frame across all lines; major scroll
    // jank source. The wordmark is fixed-positioned and its lines only
    // resize on window resize / scroll (the composition translates
    // during the hero→about dive). Recompute the cache on those events
    // (rAF-debounced) and just read from the cache during the hover
    // tick.
    const rects: Array<{ left: number; top: number }> = new Array(lines.length);
    let rectsRaf = 0;
    const refreshRects = () => {
      rectsRaf = 0;
      for (let i = 0; i < lines.length; i++) {
        const r = lines[i]!.getBoundingClientRect();
        rects[i] = { left: r.left, top: r.top };
      }
    };
    refreshRects();
    const scheduleRects = () => {
      if (rectsRaf !== 0) return;
      rectsRaf = window.requestAnimationFrame(refreshRects);
    };

    const tick = () => {
      curX += (targetX - curX) * LERP_K;
      curY += (targetY - curY) * LERP_K;
      const hover = pendingActive ? "1" : "0";
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const r = rects[i];
        if (!r) continue;
        line.style.setProperty("--mx", `${curX - r.left}px`);
        line.style.setProperty("--my", `${curY - r.top}px`);
        line.style.setProperty("--mhover", hover);
      }
      // Keep ticking while the cursor is hovering OR while we're still
      // settling (within 0.5px of target). Once both are quiet, stop.
      const settled =
        Math.abs(targetX - curX) < 0.5 && Math.abs(targetY - curY) < 0.5;
      if (pendingActive || !settled) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    };
    const schedule = () => {
      if (rafId !== 0) return;
      rafId = window.requestAnimationFrame(tick);
    };
    const onMove = (e: PointerEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      pendingActive = true;
      schedule();
    };
    const onEnter = (e: PointerEvent) => {
      // Snap current to target on enter so the spotlight appears AT
      // the cursor rather than drifting in from off-screen. Also
      // re-cache rects in case the composition just shifted (the
      // hero-to-about dive moves the wordmark vertically).
      refreshRects();
      targetX = e.clientX;
      targetY = e.clientY;
      curX = e.clientX;
      curY = e.clientY;
      pendingActive = true;
      schedule();
    };
    const onLeave = () => {
      pendingActive = false;
      schedule();
    };

    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerenter", onEnter);
    wrap.addEventListener("pointerleave", onLeave);
    // Refresh cache (rAF-debounced) on resize + scroll, since the dive-
    // in transform shifts the wordmark vertically as the user scrolls.
    window.addEventListener("resize", scheduleRects, { passive: true });
    window.addEventListener("scroll", scheduleRects, { passive: true });
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      if (rectsRaf !== 0) window.cancelAnimationFrame(rectsRaf);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerenter", onEnter);
      wrap.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", scheduleRects);
      window.removeEventListener("scroll", scheduleRects);
    };
  }, []);

  return (
    <>
      {renderTwoD && (
        <HeroSignature2D
          data={data}
          opacity={twoDOpacity}
          zIndex={twoDZIndex}
          onComplete={() => setDrawingComplete(true)}
        />
      )}
      <div
        className={`hero-composition${compositionVisible ? " is-visible" : ""}`}
        aria-hidden={!compositionVisible}
      >
        {/* Real accessible heading. The wordmark below is built from
            aria-hidden decorative spans (per-char fill + matrix overlay),
            so screen readers + SEO get the name from this single h1
            instead of nothing. Visually hidden, DOM-real. */}
        <h1 className="hero-sr-heading">Daniel Tan, Software Engineer</h1>

        <div className="hero-ring-wrap" aria-hidden>
          <HeroAsciiRing color="#e87040" spinDuration={26} />
        </div>


        <div className="hero-mega-wordmark" ref={wordmarkRef}>
          <div className="hero-mega-text" aria-hidden>
            {wordmarkLines.map((line) => (
              <span key={line.text} className={line.className} data-text={line.text}>
                <span className="hero-mega-fill" aria-hidden>
                  {line.text.split("").map((ch, i) => (
                    <span
                      key={i}
                      className="hero-mega-char"
                      style={{ transitionDelay: `${i * 22}ms` }}
                    >
                      {ch}
                    </span>
                  ))}
                </span>
                <span className="hero-mega-outline" aria-hidden>{line.text}</span>
                {/* Matrix overlay must mirror the fill's per-character
                    span structure: browsers kern adjacent glyphs
                    differently in spans vs. a contiguous string, so a
                    plain-text matrix drifts horizontally vs. the
                    fill. Same span structure = pixel-perfect overlay. */}
                <span className="hero-mega-matrix" aria-hidden>
                  {line.text.split("").map((ch, i) => (
                    <span key={i} className="hero-mega-matrix-char">
                      {ch}
                    </span>
                  ))}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Feathered cool-white scrim: quiets the orange ASCII ring in
            the bottom strip so the meta pill + scroll chip read clearly.
            Behind .hero-bottom (z-index 2), above the ring (z 0). */}
        <div className="hero-bottom-scrim" aria-hidden />

        <div className="hero-bottom">
          <div className="hero-meta" role="group" aria-label="Profile metadata">
            <span className="hero-meta-field">
              <span className="hero-meta-key">Role</span>
              <span className="hero-meta-val">Software Engineer</span>
            </span>
            <span className="hero-meta-sep" aria-hidden />
            <span className="hero-meta-field">
              <span className="hero-meta-key">Loc</span>
              <span className="hero-meta-val">Toronto, CA</span>
            </span>
          </div>
          <button
            type="button"
            className="hero-scroll"
            aria-label="Scroll to the next section"
            onClick={() => {
              const reduce = window.matchMedia(
                "(prefers-reduced-motion: reduce)",
              ).matches;
              // Advance one viewport. The scroll choreography is purely
              // scrollY-driven, so a plain scroll triggers the dive-in
              // for free. Honour reduced-motion with an instant jump.
              window.scrollTo({
                top: window.innerHeight,
                behavior: reduce ? "auto" : "smooth",
              });
            }}
          >
            <span className="hero-scroll-arrow" aria-hidden>↓</span>
            <span className="hero-scroll-label">Scroll</span>
            <span className="hero-scroll-idx" aria-hidden>01</span>
          </button>
        </div>
      </div>
    </>
  );
}
