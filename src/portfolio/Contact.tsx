import "./sections.css";

export function Contact() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-col">
        <span className="section-marker">04</span>
        <span className="eyebrow">Contact</span>
        <h2>Let&rsquo;s talk</h2>
        <div className="section-card">
          <a className="contact-email" href="mailto:hello@danielrltan.com">
            hello@danielrltan.com
          </a>
          <div className="contact-socials">
            <a
              className="btn-pill"
              href="https://github.com/danielrltan"
              target="_blank"
              rel="noreferrer"
            >
              GitHub &rarr;
            </a>
            <a
              className="btn-pill"
              href="https://www.linkedin.com/in/danielrltan"
              target="_blank"
              rel="noreferrer"
            >
              LinkedIn &rarr;
            </a>
          </div>
          <div className="section-rule" />
          <p className="contact-note">
            The fastest way to reach me is email. I read everything;
            I reply to most things.
          </p>
        </div>
        <div style={{ marginTop: 48 }}>
          <button
            type="button"
            className="btn-pill"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          >
            Back to top &uarr;
          </button>
        </div>
      </div>
    </section>
  );
}
