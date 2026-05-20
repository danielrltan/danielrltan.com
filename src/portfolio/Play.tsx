import "./sections.css";

interface PlayItem {
  title: string;
  blurb: string;
  href?: string;
}

const ITEMS: PlayItem[] = [
  {
    title: "Shader sketches",
    blurb:
      "Daily GLSL experiments — noise fields, raymarched shapes, signed-distance functions. Mostly throwaway, occasionally surprising.",
  },
  {
    title: "Furniture in Blender",
    blurb:
      "I model my own room in Blender every few months as a poly-budget exercise. Hard-surface practice, basically.",
  },
  {
    title: "Mechanical keyboards",
    blurb:
      "Soldered. Sanded. Lubed. The keyboard in the scene is the one I actually type on right now.",
  },
];

export function Play() {
  return (
    <section className="portfolio-section">
      <div className="portfolio-col">
        <span className="section-marker">05</span>
        <span className="section-index">05 / 07 &middot; Play</span>
        <h2>Off the clock.</h2>
        <div className="section-card">
          <p>
            Stuff I do for fun. Not commercial work, not portfolio-grade
            &mdash; just sketches and obsessions.
          </p>
          <div className="section-rule" />
          <div className="play-grid">
            {ITEMS.map((it) => (
              <div key={it.title} className="play-item">
                <h3 className="play-item-title">{it.title}</h3>
                <p className="play-item-blurb">{it.blurb}</p>
                {it.href && (
                  <a href={it.href} target="_blank" rel="noreferrer">
                    See it &rarr;
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
