import "./section-transition.css";

/**
 * Bridge between BitsAndPieces and Keypad: single-row pixel-font
 * marquee. Pure CSS animation so it can't fight with the pinned
 * Keypad below; z-index 0 so the pinned Keypad floats above.
 */
export function SectionTransition() {
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
      <div className="st-marquee">
        <div className="st-track">
          {phrase}
          {phrase}
        </div>
      </div>
    </section>
  );
}
