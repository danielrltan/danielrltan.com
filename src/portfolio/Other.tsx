import "./sections.css";

interface OtherEntry {
  label: string;
  title: string;
  blurb?: string;
  href?: string;
}

const ENTRIES: OtherEntry[] = [
  {
    label: "Writing",
    title: "On building toys",
    blurb:
      "Why the web is the best place to ship interactive ideas, and how to keep them weird.",
  },
  {
    label: "Talk",
    title: "R3F: the good, the bad, the boilerplate",
    blurb:
      "A lightning talk at a local meetup on what actually works in production.",
  },
  {
    label: "Open source",
    title: "Bits I&rsquo;ve contributed to",
    blurb:
      "Small PRs against three.js, drei, and a handful of indie libraries.",
  },
];

export function Other() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-col">
        <span className="section-marker">06</span>
        <span className="section-index">06 / 07 &middot; Other</span>
        <h2>Bits and pieces.</h2>
        <div className="section-card">
          <div className="other-stack">
            {ENTRIES.map((e, i) => (
              <div key={i} className="other-entry">
                <div className="other-entry-label">{e.label}</div>
                <h3 className="other-entry-title">{e.title}</h3>
                {e.blurb && <p className="other-entry-blurb">{e.blurb}</p>}
                {e.href && (
                  <a href={e.href} target="_blank" rel="noreferrer">
                    Read &rarr;
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
