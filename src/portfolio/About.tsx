import "./sections.css";
import "./about.css";

/**
 * About section. Editorial right-column layout against the room
 * canvas on the left half of the viewport. The previous version used
 * the generic `.section-card` wrapper, which painted a translucent
 * white card with a "+" decoration on top of the room — read as
 * "vibe-coded placeholder UI." Replaced with confident editorial
 * typography:
 *
 *   - eyebrow + section number (existing pattern)
 *   - large lede paragraph, one orange word as accent
 *   - 5-row "currently" table: doing / studying / building / off-hours / reach
 *   - no card, no `+` icon, no transparency
 *
 * Content is finally real, not "work in progress" placeholder.
 */
export function About() {
  return (
    <section className="portfolio-section portfolio-about">
      <div className="portfolio-col about-col">
        <span className="section-marker">01</span>
        <span className="section-index">01 / 06 &middot; About</span>
        <h2 className="about-h">About.</h2>
        <p className="about-lede">
          I&rsquo;m Daniel — a <span className="accent">software developer</span> in
          Toronto who likes building the parts of products that feel
          alive. Right now that means AI tooling, agentic systems, and
          interactive 3D on the web.
        </p>
        <div className="about-grid">
          <div className="about-row">
            <span className="about-label">Currently</span>
            <span className="about-value">
              Software Developer @{" "}
              <a href="https://windscribe.com" target="_blank" rel="noreferrer">
                Windscribe
              </a>
            </span>
          </div>
          <div className="about-row">
            <span className="about-label">Studying</span>
            <span className="about-value">
              B.Sc. Computer Science, Western Ontario &rarr; 2027
            </span>
          </div>
          <div className="about-row">
            <span className="about-label">Building</span>
            <span className="about-value">
              Cognetech &middot; Revamp &middot; this site
            </span>
          </div>
          <div className="about-row">
            <span className="about-label">Off-hours</span>
            <span className="about-value">
              Piano &middot; Taekwondo &middot; speed-typing on
              over-engineered keyboards
            </span>
          </div>
          <div className="about-row">
            <span className="about-label">Reach</span>
            <span className="about-value">
              <a href="mailto:hello@danielrltan.com">hello@danielrltan.com</a>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
