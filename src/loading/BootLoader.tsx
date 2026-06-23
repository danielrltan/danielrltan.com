import { useEffect, useRef, useState } from "react";
import { useAssembly } from "./AssemblyController";
import "./boot-loader.css";

/**
 * Live loading overlay shown during html.loading-active.
 *
 * Dead simple: ONE big pixel number climbing 0 → 100 on the International Orange
 * scrim — nothing else. No bar, no percent sign, no wordmark. The same orange
 * field the hero signature draws onto next, so the hand-off has no colour jump.
 * One eased progress value drives the count on a fixed-rate rAF loop. Unmounts at
 * loaderDone; resolves instantly under reduced motion; the outro is a small lift.
 */
export function BootLoader() {
  const { combinedPct, climaxReady, loaderDone } = useAssembly();
  const complete = climaxReady;

  const [p, setP] = useState(0); // eased 0..1 progress
  const pRef = useRef(0);
  const targetRef = useRef(0);
  targetRef.current = complete ? 1 : Math.max(0, Math.min(1, combinedPct));

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

  if (loaderDone) return null;

  const pct = Math.round(p * 100);

  return (
    <div
      className={`boot-loader${complete ? " is-complete" : ""}`}
      aria-hidden="true"
    >
      <div className="boot-loader__count">{pct}</div>
    </div>
  );
}
