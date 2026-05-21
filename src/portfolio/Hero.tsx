import "./sections.css";
import { useScrollProgress } from "../useScrollProgress";

/**
 * Hero section is now JUST a section-sized spacer. The visible hero
 * content — the 3D extruded signature — is rendered at App level
 * (via <HeroSignature/>) as a position-fixed overlay so it can
 * persist across the loading sequence cleanly. This component is
 * only responsible for taking up one viewport of vertical space and
 * showing a small scroll hint that fades out as the user scrolls.
 *
 * The old `Daniel Tan` wordmark + Portfolio eyebrow block was removed
 * — the signature itself IS the wordmark now.
 */
const FADE_START = 0.003;
const FADE_DONE = 0.03;

export function Hero() {
  const progress = useScrollProgress();
  const t = Math.max(
    0,
    Math.min(1, (progress - FADE_START) / (FADE_DONE - FADE_START)),
  );
  const opacity = 1 - t;
  return (
    <section className="portfolio-section portfolio-section--hero">
      <div className="scroll-hint" style={{ opacity }}>
        scroll &darr;
      </div>
    </section>
  );
}
