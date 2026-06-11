import { useEffect, useRef, useState } from "react";
import { HeroSignature2D } from "./HeroSignature2D";
import { HeroAsciiRing } from "./HeroAsciiRing";
import { HeroIgnition } from "./HeroIgnition";
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

  // Inhale tracking: per-letter proximity spread.
  //
  // Replaces the old white "matrix" spotlight (white-on-white over the
  // orange wordmark read as a muddy haze). Now each GLYPH is pushed
  // outward from its line's horizontal centre, the push scaled by how
  // close the cursor is (2D proximity) plus a small global hover bias,
  // with a subtle weight-lift scale. Letters keep the accent colour.
  //
  // A spring-eased rAF loop lerps each glyph's current offset toward its
  // target; the loop self-stops once everything is hovering-off AND
  // settled to rest. Pointer handlers only update the target/pointer —
  // never setState. Touch / coarse pointers and reduced-motion skip it.
  const wordmarkRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const wrap = wordmarkRef.current;
    if (!wrap) return;
    const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
    if (coarse) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion) return;

    const textEl = wrap.querySelector<HTMLElement>(".hero-mega-text");
    const lineEls = Array.from(
      wrap.querySelectorAll<HTMLElement>(".hero-mega-fill"),
    );
    if (!textEl || lineEls.length === 0) return;

    type Glyph = {
      el: HTMLElement;
      dir: number; // signed distance from line centre: <0 left, >0 right
      cx: number; // cached REST centre x (client coords)
      cy: number; // cached REST centre y (client coords)
      cur: number; // current x offset (px)
      tgt: number; // target x offset (px)
      sCur: number; // current scale
      sTgt: number; // target scale
    };
    const glyphs: Glyph[] = [];
    lineEls.forEach((lineEl) => {
      const chars = Array.from(
        lineEl.querySelectorAll<HTMLElement>(".hero-mega-char"),
      );
      const center = (chars.length - 1) / 2;
      chars.forEach((el, idx) => {
        glyphs.push({
          el,
          dir: idx - center,
          cx: 0,
          cy: 0,
          cur: 0,
          tgt: 0,
          sCur: 1,
          sTgt: 1,
        });
      });
    });
    if (glyphs.length === 0) return;

    // Magnitudes scale with the live (clamped/responsive) font size so
    // the spread reads the same from mobile clamp floor to 280px ceiling.
    let MAX_PUSH = 24;
    let BASE_PUSH = 9;
    let SIGMA = 170;
    const readFont = () => {
      const fs = parseFloat(getComputedStyle(textEl).fontSize) || 200;
      MAX_PUSH = fs * 0.11; // peak outward shove at the cursor
      BASE_PUSH = fs * 0.04; // gentle global airy bias while hovering
      SIGMA = fs * 0.85; // proximity falloff radius
    };
    readFont();

    let rafId = 0;
    let pointerX = 0;
    let pointerY = 0;
    let hovering = false;

    // PERF: cache each glyph's REST centre. getBoundingClientRect inside
    // the rAF tick would force layout every frame across every letter.
    // The measured centre includes any transform we've applied, so we
    // subtract the current offset to recover the rest position — keeps
    // the proximity field stable instead of drifting with the spread.
    let rectsRaf = 0;
    const refreshRects = () => {
      rectsRaf = 0;
      for (const g of glyphs) {
        const r = g.el.getBoundingClientRect();
        g.cx = r.left + r.width / 2 - g.cur;
        g.cy = r.top + r.height / 2;
      }
    };
    refreshRects();
    const scheduleRects = () => {
      if (rectsRaf !== 0) return;
      rectsRaf = window.requestAnimationFrame(() => {
        readFont();
        refreshRects();
      });
    };

    const computeTargets = () => {
      for (const g of glyphs) {
        if (!hovering) {
          g.tgt = 0;
          g.sTgt = 1;
          continue;
        }
        const dx = g.cx - pointerX;
        const dy = g.cy - pointerY;
        const prox = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
        const push = BASE_PUSH + prox * MAX_PUSH;
        g.tgt = g.dir * push;
        g.sTgt = 1 + prox * 0.05;
      }
    };

    const tick = () => {
      let moving = false;
      for (const g of glyphs) {
        g.cur += (g.tgt - g.cur) * 0.16;
        g.sCur += (g.sTgt - g.sCur) * 0.16;
        if (
          Math.abs(g.tgt - g.cur) > 0.05 ||
          Math.abs(g.sTgt - g.sCur) > 0.001
        ) {
          moving = true;
        }
        g.el.style.transform = `translate3d(${g.cur.toFixed(2)}px,0,0) scale(${g.sCur.toFixed(3)})`;
      }
      if (moving || hovering) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        // Settle to exact rest so transforms don't linger at sub-px values.
        for (const g of glyphs) {
          g.cur = 0;
          g.sCur = 1;
          g.el.style.transform = "translate3d(0,0,0) scale(1)";
        }
        rafId = 0;
      }
    };
    const schedule = () => {
      if (rafId === 0) rafId = window.requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      hovering = true;
      computeTargets();
      schedule();
    };
    const onEnter = (e: PointerEvent) => {
      // Re-cache in case the composition just shifted (hero→about dive
      // moves the wordmark vertically) and read pointer immediately.
      refreshRects();
      pointerX = e.clientX;
      pointerY = e.clientY;
      hovering = true;
      computeTargets();
      schedule();
    };
    const onLeave = () => {
      hovering = false;
      for (const g of glyphs) {
        g.tgt = 0;
        g.sTgt = 1;
      }
      schedule();
    };

    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerenter", onEnter);
    wrap.addEventListener("pointerleave", onLeave);
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
        className={`hero-composition${compositionVisible ? " is-visible" : ""}${phase === "settled" ? " is-settled" : ""}`}
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

        {/* One-shot ASCII blast on load, centred on the ring; the ring then
            crossfades in over it and tilts into the scene. Sibling of the
            ring-wrap (not inside it) so it isn't dimmed by the wrap's own
            fade-in. */}
        <HeroIgnition />


        <div className="hero-mega-wordmark" ref={wordmarkRef}>
          <div className="hero-mega-text" aria-hidden>
            {wordmarkLines.map((line) => (
              <span key={line.text} className={line.className} data-text={line.text}>
                <span className="hero-mega-fill" aria-hidden>
                  {line.text.split("").map((ch, i) => (
                    <span key={i} className="hero-mega-char">
                      {ch}
                    </span>
                  ))}
                </span>
                <span className="hero-mega-outline" aria-hidden>{line.text}</span>
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
