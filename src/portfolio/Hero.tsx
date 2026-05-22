import "./sections.css";

/**
 * Hero section — pure viewport spacer. The actual hero CONTENT
 * (wordmark + 3D signature + meta line + scroll prompt) is rendered
 * at App level via <HeroSignature/> as a fixed-position overlay, so
 * it can persist across the loading→ready handoff cleanly.
 *
 * This component's only responsibility is to take up one viewport
 * of vertical space so the rest of the page can be scrolled into.
 *
 * Previously also rendered its own `scroll-hint` element, which
 * duplicated the one in HeroSignature → two "scroll ↓" labels on
 * top of each other. Removed.
 */
export function Hero() {
  return <section className="portfolio-section portfolio-section--hero" />;
}
