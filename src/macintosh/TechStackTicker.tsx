import { useMemo } from "react";
import { SKILL_LOGOS } from "./projects";

/**
 * Flat horizontal tech stack scroller — replaces the 3D orbit ring
 * that previously circled the Macintosh. The orbit was hard to read
 * (logos passed in front of the screen, behind, etc.) so the stack
 * is now a single editorial marquee row above the Mac.
 *
 * The marquee auto-scrolls continuously at a slow pace (CSS keyframe
 * — no JS), with each badge fading at the left/right edges via a
 * mask gradient so the loop point is invisible. Awwwards-style
 * "skills as kinetic typography" without the 3D depth-perception
 * problem.
 *
 * Visibility / fade is driven by section progress in Macintosh.tsx
 * via CSS data-attribute on the wrapper.
 */
export function TechStackTicker() {
  // Duplicate the list 3x so the marquee can translate -33.33% per
  // loop and the gap is never visible.
  const repeated = useMemo(
    () => [...SKILL_LOGOS, ...SKILL_LOGOS, ...SKILL_LOGOS],
    [],
  );
  return (
    <div className="tech-ticker" aria-hidden>
      <div className="tech-ticker-track">
        {repeated.map((logo, i) => (
          <div
            key={i}
            className="tech-ticker-chip"
            style={{ "--chip-color": logo.color } as React.CSSProperties}
          >
            <span className="tech-ticker-dot" />
            <span className="tech-ticker-label">{logo.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
