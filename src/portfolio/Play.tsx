import "./sections.css";

interface PlayItem {
  title: string;
  meta?: string;
}

const ITEMS: PlayItem[] = [
  { title: "Taekwondo", meta: "Black Belt 2nd Dan" },
  { title: "Kickboxing" },
  { title: "Piano", meta: "12+ years · RCM Level 9" },
  { title: "Computers & Workstation Setups" },
  { title: "Fashion" },
  { title: "Mechanical Keyboards", meta: "& speed typing" },
  { title: "Graphic Design" },
  { title: "Cars & Driving" },
  { title: "Skiing" },
  { title: "Crocheting" },
  { title: "Travelling" },
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
            Stuff I do
          </p>
          <div className="section-rule" />
          <div className="play-grid">
            {ITEMS.map((it) => (
              <div key={it.title} className="play-item">
                <h3 className="play-item-title">{it.title}</h3>
                {it.meta && <p className="play-item-blurb">{it.meta}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
