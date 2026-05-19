import "./sections.css";

export function Hero() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-hero">
        <span className="eyebrow">Portfolio · 2026</span>
        <h1 className="hero-name">Daniel R.L. Tan</h1>
        <p className="hero-subtitle">
          Software engineer · interactive web · 3D
        </p>
      </div>
      <div className="scroll-hint">scroll ↓</div>
    </section>
  );
}
