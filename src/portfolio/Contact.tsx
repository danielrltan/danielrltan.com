import "./sections.css";

export function Contact() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-col">
        <span className="eyebrow">Contact</span>
        <h2>Let’s talk</h2>
        <a className="contact-email" href="mailto:hello@danielrltan.com">
          hello@danielrltan.com
        </a>
        <div className="contact-socials">
          <a
            className="contact-social-btn"
            href="https://github.com/danielrltan"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <a
            className="contact-social-btn"
            href="https://www.linkedin.com/in/danielrltan"
            target="_blank"
            rel="noreferrer"
          >
            LinkedIn
          </a>
        </div>
        <p style={{ marginTop: 32, opacity: 0.6, fontSize: 14 }}>
          The fastest way to reach me is email. I read everything; I reply
          to most things.
        </p>
        <div style={{ marginTop: 64 }}>
          <button
            type="button"
            onClick={() =>
              window.scrollTo({ top: 0, behavior: "smooth" })
            }
            style={{
              padding: "12px 24px",
              background: "var(--wrapper-ink)",
              color: "var(--wrapper-bg)",
              border: 0,
              borderRadius: 999,
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontWeight: 600,
              cursor: "pointer",
              pointerEvents: "auto",
            }}
          >
            Back to top ↑
          </button>
        </div>
      </div>
    </section>
  );
}
