import "./section-transition.css";

/**
 * Bridge between the editorial portfolio sections (Other, ...) and
 * the keypad/socials section. Replaces what was a hard horizontal
 * cut with a guided, awwwards-style transition:
 *
 *   - A LARGE horizontal marquee with brand phrasing scrolls slowly
 *     across the band, separated by orange accent bullets. Reads as
 *     an intentional editorial divider rather than dead space.
 *   - A vertical gradient bg transitions from the cool grey of the
 *     page (`--wrapper-bg-deep`) into the keypad section's slightly
 *     lighter grey, so the color shift feels engineered.
 *   - A subtle dot-cascade overlay drifts downward beneath the
 *     marquee — picks up the rice motif from the keypad section and
 *     hints at the rice-fluid blob the user is about to discover.
 *
 * Pure CSS (no JS / Canvas), so it costs essentially nothing — the
 * marquee is a transform-only animation and the cascade is repeating
 * radial-gradient + background-position animation.
 */
export function SectionTransition() {
  // Duplicate the phrase track so the marquee can translate -50%
  // (one copy off the left) and loop seamlessly.
  const phrase = (
    <>
      <span className="st-text">Let&rsquo;s connect</span>
      <span className="st-bullet">•</span>
      <span className="st-text">Say hi</span>
      <span className="st-bullet">•</span>
      <span className="st-text">Drop a line</span>
      <span className="st-bullet">•</span>
      <span className="st-text">Socials below</span>
      <span className="st-bullet">•</span>
      <span className="st-text">hello@danielrltan.com</span>
      <span className="st-bullet">•</span>
    </>
  );

  return (
    <section className="section-transition" aria-hidden="true">
      {/* Rice-cascade overlay — repeating dot pattern that drifts
          downward, hinting at the keypad's rice fluid backdrop. */}
      <div className="st-cascade" />
      {/* Marquee track. aria-hidden because the same content lives
          (semantically) in the keypad section's hidden link list. */}
      <div className="st-marquee">
        <div className="st-track">
          {phrase}
          {phrase}
        </div>
      </div>
    </section>
  );
}
