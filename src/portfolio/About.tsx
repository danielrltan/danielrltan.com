import "./sections.css";

export function About() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-col">
        <span className="section-marker">01</span>
        <span className="section-index">01 / 07 &middot; About</span>
        <h2>About me.</h2>
        <div className="section-card">
          <p>
            welcome! this website is currently work in progress.
          </p>
          <p>
            check back soon...
          </p>
          <div className="section-rule" />
          <p>
            🤫
          </p>
        </div>
      </div>
    </section>
  );
}
