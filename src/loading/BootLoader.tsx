import { useEffect, useRef, useState } from "react";
import { useAssembly } from "./AssemblyController";
import {
  HERO_HOLD_MS,
  LOADER_FADE_MS,
  REVEAL_FAILSAFE_MS,
  TIMELINE_FLOOR_MS,
} from "./types";
import { reducedMotion } from "../motion";
import { clamp01 } from "../math";
import { readLoadStats, startLoadStats } from "./loadStats";
import type { LoaderVariant } from "./variants/shared";
import "./boot-loader.css";

/** `?loader=1..18` previews an alternative 3D look (src/loading/variants). The
 *  variants chunk only loads when asked for; no param = the plain count. */
const VARIANT_ID = (() => {
  if (typeof location === "undefined") return 0;
  const id = Number(new URLSearchParams(location.search).get("loader"));
  return id >= 1 && id <= 18 ? id : 0;
})();

/**
 * Live loading overlay shown during html.loading-active.
 *
 * ONE big pixel number climbing 0 → 100 on the International Orange scrim. When
 * it reaches 100 it does NOT immediately fade (owner: the insta-fade "looked
 * vibecoded"). Instead it HOLDS there while the hero composes BEHIND the scrim
 * (the scrim is z-9000, the hero z-3/z-11 — it composes hidden underneath), then
 * the scrim FADES OUT to reveal the fully-ready hero — a real crossfade. The
 * moment that fade STARTS the loader dispatches `loader-reveal-start`, so the
 * hero's entrance plays over the fading scrim instead of behind it. Scroll
 * stays locked (html.loading-active) the whole time; the loader dispatches
 * `loader-revealed` once it has faded, which is the page unlock (see
 * AssemblyController). The same orange field the hero sits on, so no colour jump.
 */

/** Slack on the provider's (100 ms-stepped) combinedPct before the count's own
 *  clock is capped by it: never bites on a healthy load, holds the count if the
 *  provider's timeline is paused (hidden tab). One emit interval. */
const COUNT_CAP_SLACK = 100 / TIMELINE_FLOOR_MS;
/** The count never shows 100 until climaxReady actually lands. */
const COUNT_PRE_CLIMAX_MAX = 0.99;
const outQuad = (t: number) => 1 - (1 - t) * (1 - t);

export function BootLoader() {
  const { combinedPct, climaxReady } = useAssembly();
  // reveal: the loader has begun fading out (revealing the hero beneath it).
  // gone: the fade finished → unmount.
  const [reveal, setReveal] = useState(false);
  const [gone, setGone] = useState(false);
  // A ?loader= variant that paints its own field and plays its own exit.
  const [ownExit, setOwnExit] = useState(false);

  // The count is written straight to its text node: no React commit per frame
  // (it used to setState ~every frame from a 0.14-per-frame chase lerp, which
  // also ran twice as fast at 120 Hz). The JSX child stays a constant "0" so
  // the provider's ~100 ms re-renders never overwrite the written number.
  const countRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef({ combinedPct, climaxReady });
  liveRef.current = { combinedPct, climaxReady };
  // What the count clock is showing, for a ?loader= variant to draw.
  const shownRef = useRef({ p: 0, n: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  // performance.now() when the reveal (fade / variant exit) began.
  const revealAtRef = useRef(0);

  // Count clock (motion spec W7.13): elapsed-time driven, eased with
  // outQuad (see below) over TIMELINE_FLOOR_MS (it decelerates into 100 rather than
  // chasing the provider's 8%-steps), capped so it never runs ahead of a
  // paused provider or reaches 100 early, forced to 100 at climaxReady.
  //
  // Reading of "capped by combinedPct": combinedPct IS elapsed / floor, so
  // min(outCubic(e / floor), combinedPct) would just be the stepped linear
  // value and the easing would vanish. The cap is applied to the LINEAR input
  // instead (with one emit interval of slack), which keeps its real job:
  // holding the count while the provider's timeline is paused.
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    let shown = -1;
    const tick = () => {
      const { combinedPct: pct, climaxReady: done } = liveRef.current;
      let p: number;
      if (done) p = 1;
      else if (reducedMotion.value) p = Math.min(pct, COUNT_PRE_CLIMAX_MAX);
      else {
        const lin = Math.min(
          clamp01((performance.now() - t0) / TIMELINE_FLOOR_MS),
          pct + COUNT_CAP_SLACK,
        );
        // SCALE (not clamp) into 0..0.99 and floor: a clamped outCubic
        // saturated at lin ~0.75 and then sat on 99 for the last ~0.3 s of
        // the floor plus the stable-frame wait. Scaled + floored, 99 only
        // shows once the linear clock reaches the end of the floor. outQuad
        // rather than outCubic: still decelerates into the top, but its tail
        // is shallow enough that no integer below 99 holds for more than
        // ~120 ms (outCubic held 98 for ~260 ms).
        p = COUNT_PRE_CLIMAX_MAX * outQuad(lin);
      }
      const n = done ? 100 : Math.floor(p * 100 + 1e-6);
      shownRef.current = { p, n };
      if (n !== shown && countRef.current) {
        shown = n; // at most one DOM write per displayed integer
        countRef.current.textContent = String(n);
      }
      if (n >= 100) {
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

  // ?loader=N: mount the variant and give it every frame (it keeps animating
  // through the hold and the fade) until the loader unmounts.
  useEffect(() => {
    if (!VARIANT_ID) return;
    startLoadStats();
    let raf = 0;
    let dead = false;
    let variant: LoaderVariant | null = null;
    import("./variants").then(({ VARIANTS }) => {
      const info = VARIANTS.find((v) => v.id === VARIANT_ID);
      if (dead || !info || !stageRef.current) return;
      const v = info.create(stageRef.current, reducedMotion.value);
      variant = v;
      // Readouts freeze the frame the count lands on 100: the hold and the
      // fade after it are not load time.
      let final: ReturnType<typeof readLoadStats> | null = null;
      let first = true;
      const loop = (now: number) => {
        const { p, n } = shownRef.current;
        if (n >= 100 && !final) final = readLoadStats();
        const at = revealAtRef.current;
        const exit = at ? clamp01((now - at) / LOADER_FADE_MS) : 0;
        v.frame(now, p, n, final ?? readLoadStats(), exit);
        // Its first frame has painted the orange: the scrim can step aside
        // and leave the exit to the variant.
        if (first && info.ownsExit) setOwnExit(true);
        first = false;
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    });
    return () => {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      variant?.destroy();
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

  // The fade has started (this effect runs on the commit that applies
  // .is-complete, for the normal and the failsafe path alike): tell the hero
  // so its entrance plays over the fading scrim. After the fade has run, unlock
  // the page (AssemblyController listens for `loader-revealed`) and unmount.
  const revealStartSentRef = useRef(false);
  useEffect(() => {
    if (!reveal) return;
    if (!revealStartSentRef.current) {
      revealStartSentRef.current = true;
      revealAtRef.current = performance.now();
      window.dispatchEvent(new Event("loader-reveal-start"));
    }
    const t = window.setTimeout(() => {
      window.dispatchEvent(new Event("loader-revealed"));
      setGone(true);
    }, LOADER_FADE_MS);
    return () => window.clearTimeout(t);
  }, [reveal]);

  if (gone) return null;

  return (
    <div
      className={`boot-loader${reveal ? " is-complete" : ""}${ownExit ? " is-own-exit" : ""}`}
      aria-hidden="true"
    >
      {VARIANT_ID ? (
        <div className="ldr-host" ref={stageRef} />
      ) : (
        <div className="boot-loader__count" ref={countRef}>
          0
        </div>
      )}
    </div>
  );
}
