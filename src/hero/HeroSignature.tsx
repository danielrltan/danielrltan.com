import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
// The WebGL signature hero pulls in three.js (the ~1MB `three` chunk). Lazy-load
// it so that chunk leaves the entry/first-paint path: the orange scrim, loader,
// and the words paint immediately and the scene streams in behind the loader.
const HeroSigScene = lazy(() => import("./sig/HeroSigScene"));
import { loadSignatureData, type SignatureData } from "./signatureGeometry";
import { signatureBox, type SigBox } from "./sig/layout";
import { SignatureMark } from "../SignatureMark";
import { useAssembly } from "../loading";
import { useTier } from "../capabilityTier";
import "./hero-composition.css";

// LOW tier (weak GPU/CPU) or an explicit reduced-motion preference get a static
// hero: the signature as a flat vector mark with the same words around it. A
// MOUNT-TIME branch, so the lazy three.js chunk, the shader compiles and all
// per-frame GPU work never happen there. Read once at module load: the
// preference doesn't change mid-session.
const PREFERS_REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** public/signature.json's aspect, used until the data lands (static layout). */
const FALLBACK_ASPECT = 2.6074;

/**
 * Hero composition (redesign 2026-10-09, after haoqi.design): Daniel's
 * signature as an inflated 3D tube over the glyph field (sig/signatureHero.ts),
 * "hello!" / "I'm Daniel Tan" / "software engineer & designer" set around it,
 * his hobby props floating free to grab and throw. Replaced the glyph ring +
 * DANIEL TAN wordmark.
 *
 * State machine:
 *   drawing:    waits for the loader; the scene mounts (and compiles) behind it
 *   transition: loader lifting, ~520ms crossfade; the signature draws itself in
 *   settled:    composition is the only visible layer; fires `hero-composed`
 */

type Phase = "drawing" | "transition" | "settled";

export function HeroSignature() {
  const [data, setData] = useState<SignatureData | null>(null);
  const [phase, setPhase] = useState<Phase>("drawing");
  const assembly = useAssembly();
  const staticHero = useTier() === "low" || PREFERS_REDUCED_MOTION;

  useEffect(() => {
    let cancelled = false;
    // The phase machine never waits on the signature: a failed fetch (offline,
    // 404) just leaves the words over the bare field.
    void loadSignatureData().then((d) => {
      if (!cancelled && d) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Two-step state advance:
  //   1) drawing → transition once the loader has finished (loaderDone, not
  //      climaxReady, so the hero can't compose before the loader is off-screen)
  //   2) transition → settled (after the crossfade window)
  // Split into two effects so the timeout that schedules step 2 isn't torn
  // down by the dep-change from step 1 (a combined effect stranded the page in
  // `transition` forever).
  // Loader seam (spec §5 O9): the loader announces the START of its scrim fade
  // with `loader-reveal-start`, so the composition fades in OVER the fading
  // scrim instead of behind it. loaderDone stays the fallback.
  const [revealStarted, setRevealStarted] = useState(false);
  useEffect(() => {
    if (revealStarted) return;
    const on = () => setRevealStarted(true);
    window.addEventListener("loader-reveal-start", on, { once: true });
    return () => window.removeEventListener("loader-reveal-start", on);
  }, [revealStarted]);
  const loaderLifting = assembly.loaderDone || revealStarted;
  useEffect(() => {
    if (phase !== "drawing") return;
    if (!loaderLifting) return;
    setPhase("transition");
  }, [phase, loaderLifting]);
  useEffect(() => {
    if (phase !== "transition") return;
    const t = window.setTimeout(() => setPhase("settled"), 520);
    return () => window.clearTimeout(t);
  }, [phase]);
  // Composition settled ⇒ the opening sequence is done. Signal
  // AssemblyController to lift the orange scrim and unlock the page.
  useEffect(() => {
    if (phase !== "settled") return;
    window.dispatchEvent(new Event("hero-composed"));
  }, [phase]);
  const compositionVisible = phase !== "drawing";

  // Signature box -> CSS vars on the composition: the words and the iris
  // guard (.hero-name-box, heroWipe.ts) are laid out from them in CSS. The 3D
  // scene reports its box on every layout; the static hero computes the same
  // box (sig/layout.ts) itself.
  const compRef = useRef<HTMLDivElement | null>(null);
  const [staticBox, setStaticBox] = useState<SigBox | null>(null);
  const applyBox = useCallback((box: SigBox) => {
    const el = compRef.current;
    if (!el) return;
    el.style.setProperty("--sig-l", `${box.left.toFixed(1)}px`);
    el.style.setProperty("--sig-r", `${box.right.toFixed(1)}px`);
    el.style.setProperty("--sig-t", `${box.top.toFixed(1)}px`);
    el.style.setProperty("--sig-b", `${box.bottom.toFixed(1)}px`);
    el.toggleAttribute("data-narrow", box.narrow);
  }, []);
  useEffect(() => {
    if (!staticHero) return;
    const b = data?.bounds;
    const aspect = b ? (b.maxX - b.minX) / Math.max(1, b.maxY - b.minY) : FALLBACK_ASPECT;
    const run = () => {
      const box = signatureBox(window.innerWidth, window.innerHeight, aspect);
      applyBox(box);
      setStaticBox(box);
    };
    run();
    window.addEventListener("resize", run, { passive: true });
    return () => window.removeEventListener("resize", run);
  }, [staticHero, data, applyBox]);

  return (
    <>
      <div
        ref={compRef}
        className={`hero-composition${compositionVisible ? " is-visible" : ""}${phase === "settled" ? " is-settled" : ""}`}
        aria-hidden={!compositionVisible}
      >
        {/* Real accessible heading; everything visible below is decorative. */}
        <h1 className="hero-sr-heading">Daniel Tan, Software Engineer and Designer</h1>

        {staticHero ? (
          staticBox && (
            <div
              className="hero-sig-static"
              aria-hidden
              style={{ left: staticBox.left, top: staticBox.top + staticBox.height * 0.1 }}
            >
              <SignatureMark height={staticBox.height} strokeRatio={0.1} />
            </div>
          )
        ) : (
          data && (
            <Suspense fallback={null}>
              <HeroSigScene data={data} start={compositionVisible} onLayout={applyBox} />
            </Suspense>
          )
        )}

        <span className="hero-brand" aria-hidden>
          Daniel Tan
        </span>
        <p className="hero-say hero-say--hello" aria-hidden>
          hello!
        </p>
        <p className="hero-say hero-say--name" aria-hidden>
          I&rsquo;m Daniel Tan
        </p>
        <p className="hero-say hero-say--role" aria-hidden>
          <span>software engineer</span>
          <span>&amp; designer</span>
        </p>
        {/* The signature's box: heroWipe.ts keeps the iris hole off it. */}
        <div className="hero-name-box" aria-hidden />
      </div>

      {/* Pixel-iris rim (hero -> About handoff). Styled + animated only while
          the iris is open; see heroWipe.ts / hero-composition.css. */}
      <div className="hero-iris-rim" aria-hidden="true" />

      {/* Scroll cue: a pixel down-chevron, lower-middle, bobbing frame-by-frame.
          Sibling of .hero-composition so the iris push-in doesn't scale it;
          fades the instant you leave the resting hero (data-hero-diving). */}
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
