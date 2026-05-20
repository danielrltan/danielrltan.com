import "./sections.css";

export function Contact() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-col">
        <span className="section-marker">07</span>
        <span className="section-index">07 / 07 &middot; Contact</span>
        <h2>Let&rsquo;s talk.</h2>
        <div className="section-card">
          <a className="contact-email" href="mailto:hello@danielrltan.com">
            hello@danielrltan.com
          </a>
          <p className="contact-note" style={{ marginTop: 0 }}>
            The fastest way to reach me is email. I read everything;
            I reply to most things.
          </p>
          <div className="section-rule" />
          <div className="contact-grid">
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
            <a
              className="btn-pill"
              href="/resume/Daniel_Tan_Resume.pdf"
              target="_blank"
              rel="noreferrer"
            >
              Resume &darr;
            </a>
          </div>
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
