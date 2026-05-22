import "./section-transition.css";

/**
 * Bridge between BitsAndPieces and Keypad — a two-row "contact
 * ticker" with one row sliding LEFT and the other sliding RIGHT
 * at slightly different speeds. Each row mixes phrases (`drop a
 * line`, `say hi`) with the actual email address and social handles
 * so the marquee carries information, not just decoration.
 *
 * Improvements over the v1 single-row marquee:
 *   - Two counter-direction rows give the band visual energy without
 *     auto-marquee fatigue (single row at constant speed gets boring
 *     after one cycle).
 *   - Inline social handles + the email = the band IS the contact
 *     info, not just an editorial frame around it.
 *   - Different sizes between rows create typographic rhythm.
 *
 * Pure CSS — two transform animations. No scroll binding so it can't
 * conflict with the Keypad pin (the prior single-row version had
 * a visual overlap issue with the pinned Keypad below).
 */

export function SectionTransition() {
  const rowTop = (
    <>
      <span className="st-text">Let&rsquo;s connect</span>
      <span className="st-bullet">●</span>
      <span className="st-text st-text--accent">hello@danielrltan.com</span>
      <span className="st-bullet">●</span>
      <span className="st-text">Say hi</span>
      <span className="st-bullet">●</span>
      <span className="st-text">@danielrltan</span>
      <span className="st-bullet">●</span>
    </>
  );
  const rowBot = (
    <>
      <span className="st-text-sm">socials below</span>
      <span className="st-bullet-sm">/</span>
      <span className="st-text-sm">github · linkedin · x · pinterest</span>
      <span className="st-bullet-sm">/</span>
      <span className="st-text-sm">Toronto, CA</span>
      <span className="st-bullet-sm">/</span>
      <span className="st-text-sm">2026 work in progress</span>
      <span className="st-bullet-sm">/</span>
    </>
  );

  return (
    <section className="section-transition" aria-hidden="true">
      {/* Top row — bigger pixel-font phrases sliding LEFT. The
          accent-orange email is the visual anchor. */}
      <div className="st-marquee st-marquee--top">
        <div className="st-track st-track--left">
          {rowTop}
          {rowTop}
        </div>
      </div>
      {/* Bottom row — smaller mono-font meta sliding RIGHT at a
          slightly different speed. Counter-direction sets up a
          parallax-like band that's more interesting than one fast
          line. */}
      <div className="st-marquee st-marquee--bot">
        <div className="st-track st-track--right">
          {rowBot}
          {rowBot}
        </div>
      </div>
    </section>
  );
}
