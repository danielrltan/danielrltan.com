import { SKILL_LOGOS } from "./projects";
import { useMacNarrow } from "./useMacNarrow";

/**
 * Flat horizontal tech stack strip: MOBILE / NARROW FALLBACK ONLY.
 *
 * Desktop shows a 3D volumetric orbit of card sprites circling the
 * Macintosh (BEAT 2). On small screens the orbit is too dense to read,
 * so narrow viewports get this flat row above the Mac; desktop returns
 * null.
 *
 * It's a USER-SWIPEABLE horizontal scroller (native overflow-x, touch
 * pan) — NOT an auto-marquee. The owner asked to be able to swipe/scroll
 * the stack on mobile, and an auto-translate keyframe fights native
 * scroll, so the list renders once and the strip is dragged by hand.
 *
 * Visibility is driven by section progress in Macintosh.tsx via a CSS
 * data-attribute on the wrapper.
 */
export function TechStackTicker() {
  // Narrow = ≤900px, the same breakpoint the CSS and MacintoshScene use
  // to switch from the orbit cinematic to the flat stacked layout.
  // (Deliberately NOT the shared 768px useIsMobile.)
  const narrow = useMacNarrow();
  if (!narrow) return null;
  return (
    <div className="tech-ticker" aria-hidden>
      <div className="tech-ticker-track">
        {/* Label-only chips: the per-tech colored dot was the canonical
            vibe-coded badge tell (user call). */}
        {SKILL_LOGOS.map((logo, i) => (
          <div key={i} className="tech-ticker-chip">
            <span className="tech-ticker-label">{logo.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
