import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { HeroSignature2D } from "./HeroSignature2D";
// HeroGlyphRing pulls in three.js + @react-three/fiber (the ~1MB `three`
// chunk). Lazy-load it so that chunk leaves the entry/first-paint path: the
// orange scrim, loader, and static wordmark paint immediately and the ring
// streams in a beat later (it sits behind the loader until loaderDone anyway).
// This is the single biggest first-paint win on weak hardware.
const HeroGlyphRing = lazy(() =>
  import("./HeroGlyphRing").then((m) => ({ default: m.HeroGlyphRing })),
);
import { type SignatureData } from "./signatureGeometry";
import { useAssembly } from "../loading";
import { useTier } from "../capabilityTier";
import "./hero-composition.css";

// LOW tier (weak GPU/CPU) or an explicit reduced-motion preference get a static,
// baked still of the ring (public/hero-ring.webp) instead of the live WebGL
// pipeline. Because this is a MOUNT-TIME branch, the lazy three.js chunk + the
// 2-pass shader compile + all per-frame GPU work simply never happen there — the
// single biggest first-screen cost on exactly the hardware that can't afford it.
// It is a disclosed, brand-identical fallback (the same approach as the mobile
// DOM section fallbacks), NOT a blank gap. The wordmark renders live on top,
// exactly as it does over the live ring. Read once at module load (matches the
// IS_SMALL_SCREEN pattern): the preference doesn't change mid-session.
const PREFERS_REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Hero composition. ASCII ring is the kinetic centerpiece; editorial
 * type frames it (eyebrow top-left, wordmark center, meta row bottom).
 *
 * State machine (the loader now finishes BEFORE the signature draws):
 *   drawing:    waits for loaderDone, then the 2D signature draws on the
 *               orange scrim (the BootLoader has already lifted off)
 *   transition: draw done AND loaderDone, ~520ms crossfade window
 *   settled:    composition is the only visible layer; fires `hero-composed`
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
  // Start "draw complete" so the phase machine does NOT wait on the signature
  // flourish. In the new intro the hero composes BEHIND the held loader scrim
  // and is then revealed by a crossfade (the user never sees the draw), so
  // blocking the compose on a multi-second hand-drawn signature would only
  // stretch the loader hold. The signature still draws (hidden) + unmounts.
  const [drawingComplete, setDrawingComplete] = useState(true);
  const [phase, setPhase] = useState<Phase>("drawing");
  const assembly = useAssembly();
  // Static ring fallback on the weakest hardware (or reduced-motion). See the
  // PREFERS_REDUCED_MOTION note above — this keeps three.js off low-end entirely.
  const staticRing = useTier() === "low" || PREFERS_REDUCED_MOTION;

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
  //   1) drawing → transition (when the signature draw is done AND the
  //      loader has finished — loaderDone, not climaxReady, so a failed
  //      signature fetch that flips drawingComplete early still can't
  //      compose before the loader is off-screen)
  //   2) transition → settled (after the crossfade window)
  // Splitting these into two effects so the timeout that schedules
  // step 2 isn't torn down by the dep-change from step 1. When the
  // single combined effect re-ran on phase change, React's cleanup
  // cleared the timeout before it could fire, stranding the page
  // in `transition` forever.
  useEffect(() => {
    if (phase !== "drawing") return;
    if (!drawingComplete) return;
    if (!assembly.loaderDone) return;
    setPhase("transition");
  }, [phase, drawingComplete, assembly.loaderDone]);
  useEffect(() => {
    if (phase !== "transition") return;
    const t = window.setTimeout(() => setPhase("settled"), 520);
    return () => window.clearTimeout(t);
  }, [phase]);
  // Composition settled ⇒ the whole opening sequence (loader → signature →
  // wordmark) is done. Signal AssemblyController to lift the orange scrim
  // and unlock the page. This is the page-unlock seam (it replaced the
  // fixed climaxDone timer, which would now fire mid-signature-draw).
  useEffect(() => {
    if (phase !== "settled") return;
    window.dispatchEvent(new Event("hero-composed"));
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
  // Unmount the 2D signature canvas once settled (it's opacity 0 then anyway) —
  // frees its full-viewport backing buffer (~tens of MB) + one compositor layer,
  // which compounds the hero's VRAM pressure on weak GPUs through the scroll.
  const renderTwoD = phase !== "settled";
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

    // PERF: only refresh rects on scroll while the cursor is actually over the
    // wordmark — the proximity field is unused otherwise, so the default
    // behaviour was a per-glyph getBoundingClientRect() forced-layout storm on
    // every scroll frame (pricey inside the scaled + filtered composition).
    // pointerenter already re-caches, so a scroll that ends over the wordmark
    // still gets fresh rects on the next pointermove.
    const onScrollRects = () => {
      if (hovering) scheduleRects();
    };
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerenter", onEnter);
    wrap.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", scheduleRects, { passive: true });
    window.addEventListener("scroll", onScrollRects, { passive: true });
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      if (rectsRaf !== 0) window.cancelAnimationFrame(rectsRaf);
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerenter", onEnter);
      wrap.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", scheduleRects);
      window.removeEventListener("scroll", onScrollRects);
    };
  }, []);

  return (
    <>
      {/* PARKED / INERT (perf): these blur-then-downsample mosaic filters
          (feGaussianBlur → feFlood/feComposite/feTile → feMorphology) are a
          true pixelation of the composition's own rendered pixels, BUT
          feMorphology + feTile have no GPU path in Chromium, so applying
          url(#hero-px-N) to the full-viewport composition (which holds the live
          WebGL ring <canvas>) software-rasterized the whole subtree on the MAIN
          THREAD every dive frame as it scaled — ~19fps at 6× CPU. The live dive
          now uses GPU-cheap contrast()+scale only (see hero-composition.css), so
          NOTHING references these anymore — an unreferenced <filter> in <defs>
          never executes, so they cost nothing at rest. Kept (not deleted) so the
          block mosaic is a one-line opt-in (re-add `url(#hero-px-N)` to the
          data-hero-px rules) if it's ever wanted behind a capability probe. */}
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
                stdDeviation={c * 0.175}
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
              <feMorphology operator="dilate" radius={Math.min(4, c / 2)} />
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
            <feFlood floodColor="#ff4f00" x="1" y="1" width="2.4" height="2.4" />
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
          start={assembly.loaderDone}
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
          {staticRing ? (
            // Baked still of the ring at rest — no WebGL, no three.js, no shader
            // compile. fetchPriority high so it paints with the opening beat.
            <img
              className="hero-ring-static"
              src="/hero-ring.webp"
              alt=""
              draggable={false}
              fetchPriority="high"
            />
          ) : (
            <Suspense fallback={null}>
              <HeroGlyphRing color="#ff4f00" spinDuration={26} />
            </Suspense>
          )}
        </div>

        <div className="hero-mega-wordmark" ref={wordmarkRef}>
          {/* Greeting that leads INTO the wordmark below (no repeated name).
              Decorative; the h1 above carries the semantic name for AT/SEO. */}
          <p className="hero-welcome" aria-hidden>
            Hey! Welcome to the website of
          </p>
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
      </div>

      {/* Scroll cue: a pixel down-chevron, lower-middle, bobbing frame-by-frame.
          Sibling of .hero-composition so the dive transform/pixelation doesn't
          scale it; fades the instant the dive begins (--hero-to-about). */}
      <div className="hero-scroll-cue" aria-hidden="true">
        <svg width="46" height="26" viewBox="0 0 9 5" fill="#ffffff" shapeRendering="crispEdges">
          <rect x="0" y="0" width="1" height="1" />
          <rect x="8" y="0" width="1" height="1" />
          <rect x="1" y="1" width="1" height="1" />
          <rect x="7" y="1" width="1" height="1" />
          <rect x="2" y="2" width="1" height="1" />
          <rect x="6" y="2" width="1" height="1" />
          <rect x="3" y="3" width="1" height="1" />
          <rect x="5" y="3" width="1" height="1" />
          <rect x="4" y="4" width="1" height="1" />
        </svg>
      </div>
    </>
  );
}
