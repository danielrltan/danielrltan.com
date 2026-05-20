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
            I&rsquo;m a software engineer who builds full-stack web
            applications and interactive 3D experiences. I care about
            details that most people don&rsquo;t notice &mdash; the easing
            curve on a hover, the inertia of a drag, the latency between a
            click and a frame.
          </p>
          <p>
            The room you&rsquo;re looking at is a hand-modelled likeness of
            where I work. The keyboard types when you type. The mouse
            follows your cursor. Yank the PC tower; throw the cat.
            It&rsquo;s a website that&rsquo;s also a toy.
          </p>
          <div className="section-rule" />
          <p>
            I split my time between client work and personal projects.
            The goal: build things I&rsquo;d want to use, and ship them.
          </p>
        </div>
      </div>
    </section>
  );
}
