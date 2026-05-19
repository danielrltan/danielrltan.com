import "./sections.css";

export function Hero() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-hero">
        <span className="eyebrow">Portfolio</span>
        <h1>Daniel R.L. Tan</h1>
        <p
          style={{
            fontSize: "clamp(18px, 1.4vw, 24px)",
            opacity: 0.7,
            marginTop: 16,
          }}
        >
          Software engineer. Building interactive, well-considered things.
        </p>
      </div>
      <div className="scroll-hint">scroll ↓</div>
    </section>
  );
}
