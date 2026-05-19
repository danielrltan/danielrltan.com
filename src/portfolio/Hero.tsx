import "./sections.css";
import { useScrollProgress } from "../useScrollProgress";

/** Hero text + scroll hint fade out as the user scrolls into the
 *  about section. Without this, the title (anchored to the bottom of
 *  the hero section in flow) drifts up into the viewport once you
 *  scroll past 0vh — it visibly bleeds across the room canvas and
 *  the about-section copy on the right. */
const FADE_START = 0.005;
const FADE_DONE = 0.05;

export function Hero() {
  const progress = useScrollProgress();
  const t = Math.max(
    0,
    Math.min(1, (progress - FADE_START) / (FADE_DONE - FADE_START)),
  );
  const opacity = 1 - t;
  return (
    <section className="portfolio-section">
      <div className="portfolio-hero" style={{ opacity, transition: "opacity 160ms ease-out" }}>
        <span className="eyebrow">Portfolio · 2026</span>
        <h1 className="hero-name">Daniel R.L. Tan</h1>
        <p className="hero-subtitle">
          Software engineer · interactive web · 3D
        </p>
      </div>
      <div className="scroll-hint" style={{ opacity, transition: "opacity 160ms ease-out" }}>scroll ↓</div>
    </section>
  );
}
