import { useEffect, useRef } from "react";
import "./section-transition.css";

/**
 * Bridge between BitsAndPieces and Keypad: single-row pixel-font
 * marquee. Pure CSS animation so it can't fight with the pinned
 * Keypad below; z-index 0 so the pinned Keypad floats above.
 *
 * The marquee only runs while the band is on screen: it starts paused
 * (`.is-paused` in the markup) and an IntersectionObserver toggles the class
 * as the band enters/leaves, so it never ticks unseen. Reduced motion keeps
 * it static in CSS.
 */
export function SectionTransition() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.remove("is-paused");
      return;
    }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        el.classList.toggle("is-paused", !entry.isIntersecting);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

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
    // `is-paused` is the initial state only; the observer owns it after mount
    // (the component never re-renders, so React never rewrites className).
    <section ref={ref} className="section-transition is-paused" aria-hidden="true">
      <div className="st-marquee">
        <div className="st-track">
          {phrase}
          {phrase}
        </div>
      </div>
    </section>
  );
}
