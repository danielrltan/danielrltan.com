import "./sections.css";

interface OtherEntry {
  label: string;
  title: string;
  blurb?: string;
}

const ENTRIES: OtherEntry[] = [
  {
    label: "Hackathon",
    title: "Hack The 6ix — Finalist",
    blurb: "Top finalist out of 400+ participants for the Revamp battery-management project.",
  },
  {
    label: "Competition",
    title: "IBM watsonx Orchestrate Challenge — Top 50",
    blurb: "Top 50 of 2000+ global participants in IBM's agentic-AI build challenge.",
  },
  {
    label: "Competition",
    title: "WFN Odyssey Cup — First Place",
    blurb: "$500 prize at the Western Founders Network's annual venture competition.",
  },
  {
    label: "Competition",
    title: "TD Innovation Sprint — Finalist",
  },
  {
    label: "Competition",
    title: "2024 TRREB Contest — 2nd Place",
    blurb: "$2,500 award at the Toronto Regional Real Estate Board student competition.",
  },
  {
    label: "Grant",
    title: "Ontario Summer Company Grant",
    blurb: "$3,000 grant for a small business operated through Ontario's 2023 summer program.",
  },
  {
    label: "Leadership",
    title: "Director of Flagship — Western AI Club",
  },
  {
    label: "Leadership",
    title: "VP of Design — Western Founders Network",
  },
  {
    label: "Leadership",
    title: "Director of Outreach — Tech for Social Impact",
  },
  {
    label: "Leadership",
    title: "Developer — Western Developer's Society",
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
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
