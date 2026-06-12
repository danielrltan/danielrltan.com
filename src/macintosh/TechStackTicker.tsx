import { useMemo } from "react";
import { SKILL_LOGOS } from "./projects";
import { useMacNarrow } from "./useMacNarrow";

/**
 * Flat horizontal tech stack scroller: MOBILE FALLBACK ONLY.
 *
 * Desktop now shows a 3D volumetric orbit of card sprites circling
 * the Macintosh (BEAT 2 of the Mac choreography). On small screens
 * the orbit is too dense to read; there isn't enough horizontal
 * resolution to space ~12 cards around a radius-2 ring without them
 * overlapping the model. So mobile gets the flat marquee row above
 * the Mac instead; desktop returns null.
 *
 * The marquee auto-scrolls continuously at a slow pace (CSS keyframe
 * (no JS), with each badge fading at the left/right edges via a
 * mask gradient so the loop point is invisible.
 *
 * Visibility / fade is driven by section progress in Macintosh.tsx
 * via CSS data-attribute on the wrapper.
 */
export function TechStackTicker() {
  // Narrow = ≤900px, the same breakpoint the CSS and MacintoshScene
  // use to switch from the orbit cinematic to the flat stacked layout.
  // (Deliberately NOT the shared 768px useIsMobile: that hook also
  // gates Hero/Keypad/RoomHUD and must stay at 768.)
  const narrow = useMacNarrow();
  // Duplicate the list 3x so the marquee can translate -33.33% per
  // loop and the gap is never visible.
  const repeated = useMemo(
    () => [...SKILL_LOGOS, ...SKILL_LOGOS, ...SKILL_LOGOS],
    [],
  );
  if (!narrow) return null;
  return (
    <div className="tech-ticker" aria-hidden>
      <div className="tech-ticker-track">
        {/* Label-only chips: the per-tech colored dot was the canonical
            vibe-coded badge tell (user call). */}
        {repeated.map((logo, i) => (
          <div key={i} className="tech-ticker-chip">
            <span className="tech-ticker-label">{logo.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
