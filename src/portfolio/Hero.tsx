import "./sections.css";

/**
 * Hero: viewport spacer. The actual hero content (wordmark + ring +
 * meta) is rendered at App level via <HeroSignature/> as a fixed
 * overlay so it persists across the loading→ready handoff cleanly.
 */
export function Hero() {
  return <section className="portfolio-section portfolio-section--hero" />;
}
