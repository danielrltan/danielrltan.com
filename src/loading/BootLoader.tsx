import { useEffect, useRef, useState } from "react";
import { useAssembly } from "./AssemblyController";
import { HERO_HOLD_MS, LOADER_FADE_MS, REVEAL_FAILSAFE_MS } from "./types";
import "./boot-loader.css";

/**
 * Live loading overlay shown during html.loading-active.
 *
 * ONE big pixel number climbing 0 → 100 on the International Orange scrim. When
 * it reaches 100 it does NOT immediately fade (owner: the insta-fade "looked
 * vibecoded"). Instead it HOLDS there while the hero composes BEHIND the scrim
 * (the scrim is z-9000, the hero z-3/z-11 — it composes hidden underneath), then
 * the scrim FADES OUT to reveal the fully-ready hero — a real crossfade. Scroll
 * stays locked (html.loading-active) the whole time; the loader dispatches
 * `loader-revealed` once it has faded, which is the page unlock (see
 * AssemblyController). The same orange field the hero sits on, so no colour jump.
 */
export function BootLoader() {
  const { combinedPct, climaxReady } = useAssembly();
  // reveal: the loader has begun fading out (revealing the hero beneath it).
  // gone: the fade finished → unmount.
  const [reveal, setReveal] = useState(false);
  const [gone, setGone] = useState(false);

  const [p, setP] = useState(0); // eased 0..1 progress
  const pRef = useRef(0);
  const targetRef = useRef(0);
  // The count climbs to 100 at climaxReady, then HOLDS there (no fade yet).
  targetRef.current = climaxReady ? 1 : Math.max(0, Math.min(1, combinedPct));

  // Eased count (rAF, fixed-rate). Self-stops once fully landed.
  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let raf = 0;
    const tick = () => {
      const t = targetRef.current;
      if (reduced) pRef.current = t;
      else {
        pRef.current += (t - pRef.current) * 0.14;
        if (t - pRef.current < 0.0015) pRef.current = t;
      }
      const next = Math.round(pRef.current * 1000) / 1000;
      setP((prev) => (prev === next ? prev : next));
      if (t >= 1 && pRef.current >= 0.9999) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // HOLD → REVEAL. Once the count reaches 100 (climaxReady), keep it on screen
  // and wait for BOTH a deliberate beat (HERO_HOLD_MS) AND the hero having
  // composed behind the scrim (`hero-composed`), whichever is later. Only then
  // fade the loader out to reveal the ready hero. Failsafe: reveal anyway if the
  // compose signal stalls, so the loader can't get stuck on screen.
  useEffect(() => {
    if (!climaxReady) return;
    let heroReady = false;
    let holdDone = false;
    const maybe = () => {
      if (heroReady && holdDone) setReveal(true);
    };
    const onHero = () => {
      heroReady = true;
      maybe();
    };
    window.addEventListener("hero-composed", onHero);
    const holdT = window.setTimeout(() => {
      holdDone = true;
      maybe();
    }, HERO_HOLD_MS);
    const failsafe = window.setTimeout(() => setReveal(true), REVEAL_FAILSAFE_MS);
    return () => {
      window.removeEventListener("hero-composed", onHero);
      window.clearTimeout(holdT);
      window.clearTimeout(failsafe);
    };
  }, [climaxReady]);

  // After the fade-out has run, unlock the page (AssemblyController listens for
  // `loader-revealed`) and unmount the loader.
  useEffect(() => {
    if (!reveal) return;
    const t = window.setTimeout(() => {
      window.dispatchEvent(new Event("loader-revealed"));
      setGone(true);
    }, LOADER_FADE_MS);
    return () => window.clearTimeout(t);
  }, [reveal]);

  if (gone) return null;

  const pct = Math.round(p * 100);

  return (
    <div
      className={`boot-loader${reveal ? " is-complete" : ""}`}
      aria-hidden="true"
    >
      <div className="boot-loader__count">{pct}</div>
    </div>
  );
}
