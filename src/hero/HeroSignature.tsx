import { useEffect, useRef, useState } from "react";
import { HeroSignature2D } from "./HeroSignature2D";
import { HeroGlyphRing } from "./HeroGlyphRing";
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

/* Mosaic cell sizes (px, pre-transform) for the dive's stepped
   pixelation. The composition also scales up to 3x during the dive, so
   the on-screen block size is cell * scale — the late cells read much
   chunkier than these numbers suggest. Must stay in sync with the
   `data-hero-px` bucket count in App.tsx and the rules in
   hero-composition.css. */
const PIXELATE_CELLS = [4, 8, 14, 22, 32];

export function HeroSignature() {
  const [data, setData] = useState<SignatureData | null>(null);
  const [drawingComplete, setDrawingComplete] = useState(false);
  const [phase, setPhase] = useState<Phase>("drawing");
  const assembly = useAssembly();

  useEffect(() => {
    let cancelled = false;
    // FAILURE FALLBACK: if signature.json can't load (offline, 404, CDN
    // hiccup), data stays null, HeroSignature2D never draws, and
    // onComplete never fires — which would strand the phase machine in
    // "drawing" and the wordmark would NEVER compose (the page unlocks
    // via climaxDone regardless, so the user would just see an empty
    // hero). Treat a failed fetch as "drawing finished" so the
    // composition still lands; only the signature flourish is lost.
    const fail = () => {
      if (!cancelled) setDrawingComplete(true);
    };
    fetch("/signature.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d) setData(d as SignatureData);
        else fail();
      })
      .catch(fail);
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

  // The 2D signature draws at full opacity on the orange loading scrim,
  // fades through the transition, then DISAPPEARS once settled (user:
  // remove the watermark behind the hero). The persistent low-opacity
  // ghost behind the wordmark is gone; the signature is purely a
  // loading-screen flourish now.
  const twoDOpacity =
    phase === "drawing" ? 1 : phase === "transition" ? 0.5 : 0;
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
  // orange wordmark read as a muddy haze). Each GLYPH is pushed
  // outward from its line's horizontal centre, the push scaled by how
  // close the cursor is (2D proximity) plus a small global hover bias.
  // Motion is quantised to a pixel grid before it reaches the DOM (see
  // GRID below) so the spread hops in discrete steps, on-voice with
  // the pixel font. Letters keep the accent colour.
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
      cur: number; // current x offset (px, smooth internal spring value)
      tgt: number; // target x offset (px)
      qx: number; // last QUANTISED offset written to the DOM
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
          qx: 0,
        });
      });
    });
    if (glyphs.length === 0) return;

    // Magnitudes scale with the live (clamped/responsive) font size so
    // the spread reads the same from mobile clamp floor to 280px ceiling.
    let MAX_PUSH = 24;
    let BASE_PUSH = 9;
    let SIGMA = 170;
    // PIXEL GRID: the spring's smooth value is quantised to this step
    // before it touches the DOM, so glyphs MOVE in discrete pixel jumps
    // (matching the OffBit pixel-art voice) instead of sub-pixel
    // smoothing. ~2% of the font size ≈ a visible fraction of one glyph
    // block: stepped enough to read as pixel motion, fine enough that
    // the spread's shape survives.
    let GRID = 4;
    const readFont = () => {
      const fs = parseFloat(getComputedStyle(textEl).fontSize) || 200;
      MAX_PUSH = fs * 0.11; // peak outward shove at the cursor
      BASE_PUSH = fs * 0.04; // gentle global airy bias while hovering
      SIGMA = fs * 0.85; // proximity falloff radius
      GRID = Math.max(2, Math.round(fs * 0.02));
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
        // Subtract the QUANTISED offset (what is actually applied to the
        // DOM), not the smooth spring value, to recover the rest centre.
        g.cx = r.left + r.width / 2 - g.qx;
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
          continue;
        }
        const dx = g.cx - pointerX;
        const dy = g.cy - pointerY;
        const prox = Math.exp(-(dx * dx + dy * dy) / (2 * SIGMA * SIGMA));
        const push = BASE_PUSH + prox * MAX_PUSH;
        g.tgt = g.dir * push;
      }
    };

    // The spring lerps smoothly in JS, but the DOM only ever sees the
    // value SNAPPED to the pixel grid — and only when the snapped value
    // actually changes. Glyphs therefore hop grid-step by grid-step
    // (the pixel-art read), and most frames write zero styles: strictly
    // cheaper than the old per-frame sub-pixel transform on every
    // glyph. The fractional scale lift (1→1.05) was removed with the
    // smoothing: non-integer scaling of pixel glyphs blurs their blocks,
    // which is the exact effect this rework is killing.
    const tick = () => {
      let moving = false;
      for (const g of glyphs) {
        g.cur += (g.tgt - g.cur) * 0.16;
        if (Math.abs(g.tgt - g.cur) > 0.05) moving = true;
        const qx = Math.round(g.cur / GRID) * GRID;
        if (qx !== g.qx) {
          g.qx = qx;
          g.el.style.transform = `translate3d(${qx}px,0,0)`;
        }
      }
      if (moving || hovering) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        // Settle to exact rest.
        for (const g of glyphs) {
          g.cur = 0;
          g.qx = 0;
          g.el.style.transform = "translate3d(0,0,0)";
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
      {/* REAL pixelation filters for the hero→about dive. Each filter
          Gaussian-blurs the composition's actual rendered pixels
          (feGaussianBlur), samples one dot per cell (feFlood→feComposite
          →feTile→composite-in), and dilates the samples back to full
          cells (feMorphology) — a true blur-then-downsample mosaic of
          the content itself. App.tsx's scroll choreography steps
          `data-hero-px` on <html> through these as the dive progresses;
          hero-composition.css maps each step to its filter. (Replaces
          the Bayer-dither mask overlay, which just painted a pixel
          TEXTURE over the type instead of pixelating it.) */}
      <svg
        aria-hidden
        focusable="false"
        width="0"
        height="0"
        style={{ position: "absolute" }}
      >
        <defs>
          {PIXELATE_CELLS.map((c, i) => (
            <filter
              key={c}
              id={`hero-px-${i + 1}`}
              x="-5%"
              y="-5%"
              width="110%"
              height="110%"
            >
              <feGaussianBlur
                in="SourceGraphic"
                stdDeviation={c * 0.35}
                result="blur"
              />
              <feFlood
                x={c * 0.4}
                y={c * 0.4}
                width={Math.max(1, c * 0.2)}
                height={Math.max(1, c * 0.2)}
              />
              <feComposite width={c} height={c} />
              <feTile result="grid" />
              <feComposite in="blur" in2="grid" operator="in" />
              <feMorphology operator="dilate" radius={c / 2} />
            </filter>
          ))}
          {/* ASCII outline: the wordmark's keyline is a DITHERED orange
              dot-grid band around the glyphs (not a smooth line, which
              read as cheap), echoing the symbol field. Dilate the glyph
              alpha to a band, knock out the original to get the ring,
              tile a small orange dot grid, and keep the dots only inside
              the ring. White glyph composited on top. */}
          <filter
            id="hero-ascii-outline"
            x="-12%"
            y="-12%"
            width="124%"
            height="124%"
            colorInterpolationFilters="sRGB"
          >
            <feMorphology
              in="SourceAlpha"
              operator="dilate"
              radius="4.5"
              result="dil"
            />
            <feComposite in="dil" in2="SourceAlpha" operator="out" result="ring" />
            <feFlood floodColor="#e87040" x="1" y="1" width="2.4" height="2.4" />
            <feComposite width="5" height="5" result="cell" />
            <feTile in="cell" result="grid" />
            <feComposite in="grid" in2="ring" operator="in" result="outline" />
            <feMerge>
              <feMergeNode in="outline" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>
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
          <HeroGlyphRing color="#e87040" spinDuration={26} />
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
          {/* ROLE / LOC meta card removed (owner: useless + vibe-coded).
              The name + the work below carry the role; SEO/a11y keep it
              via the visually-hidden h1 above. */}
          {/* Simple down arrow (user: no text, just an arrow). The
              chevron bobs gently downward on a loop to read as "scroll
              down". aria-label carries the semantics. */}
          <button
            type="button"
            className="hero-next"
            aria-label="Go to the next section"
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
            <span className="hero-next-arrow" aria-hidden />
          </button>
        </div>
      </div>
    </>
  );
}
