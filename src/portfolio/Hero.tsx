import "./sections.css";

export function Hero() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-hero">
        <span className="eyebrow">Portfolio · 2026</span>
        <h1 className="hero-name">Daniel R.L. Tan</h1>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "clamp(13px, 1vw, 16px)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            opacity: 0.7,
            marginTop: 28,
          }}
        >
          Software engineer · interactive web · 3D
        </p>
      </div>
      <div className="scroll-hint">scroll ↓</div>
    </section>
  );
}
