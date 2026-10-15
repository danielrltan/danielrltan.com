/**
 * Honours data, shared by the desktop trophy wall (BitsAndPieces.tsx) and the
 * phone site (src/phone).
 */

export type Category =
  | "Launch"
  | "Hackathon"
  | "Competition"
  | "Grant"
  | "Leadership"
  | "Scholarship";

export interface Entry {
  category: Category;
  title: string;
  /** Pulled-out metric: printed huge in the card's "stat slot". */
  metric?: string;
  /** Optional smaller secondary metric (e.g. "Top 50 / 2000+"). */
  context?: string;
  blurb?: string;
  /** Featured items get a larger card. */
  featured?: boolean;
}

// DOM order IS visual order: the three featured wins lead so they pack into
// the top row as a uniform hero band (taller cards + bigger metric), then the
// supporting items follow in category groups. With 3 featured + 9 supporting
// and a 3-up grid, every row fills cleanly (1 hero row + 3 supporting rows),
// so card edges align top-to-bottom with no ragged trailing column.
export const ENTRIES: Entry[] = [
  // --- Hero row: the three marquee placements, each with a verified metric ---
  // Owner (2026-10-05): IBM Watsonx Top 50 takes the podium's third spot and
  // WFN Odyssey Cup moves into the tower.
  // Headliner (owner, 2026-10-05): Poddle placed #25 on Product Hunt on its
  // Oct 4 2026 launch day. It leads the hero row; TRREB moved down to the
  // supporting grid so the row stays three-up.
  {
    category: "Launch",
    title: "Poddle on Product Hunt",
    metric: "#25",
    context: "Oct 4, 2026",
    blurb: "Launch-day ranking for Poddle, my motion-controlled online pickleball game.",
    featured: true,
  },
  {
    category: "Hackathon",
    title: "Hack The 6ix",
    metric: "Finalist",
    context: "Top 1% · 400+",
    blurb: "Revamp universal BMS for second-life EV modules.",
    featured: true,
  },
  {
    category: "Competition",
    title: "IBM Watsonx Orchestrate",
    metric: "Top 50",
    context: "of 2000+",
    blurb: "Global agentic-AI build challenge.",
    featured: true,
  },
  {
    category: "Competition",
    title: "TRREB 2024",
    metric: "2nd",
    context: "$2,500",
    blurb: "Toronto Regional Real Estate Board student competition.",
  },
  // --- Supporting grid ---
  {
    category: "Competition",
    title: "WFN Odyssey Cup",
    metric: "1st",
    context: "$500",
    blurb: "Western Founders Network annual venture competition.",
  },
  {
    category: "Competition",
    title: "TD Innovation Sprint",
    metric: "Finalist",
  },
  {
    category: "Grant",
    title: "Ontario Summer Company",
    metric: "$3,000",
    blurb: "Small-business operating grant, summer 2023.",
  },
  {
    category: "Scholarship",
    title: "Western Scholarship of Distinction",
    metric: "$3,500",
  },
  {
    category: "Scholarship",
    title: "National Merit Scholarship",
    metric: "$2,000",
  },
  {
    category: "Scholarship",
    title: "Chris Binns-Smith Memorial",
    metric: "$5,000",
  },
  {
    category: "Leadership",
    title: "VP of Design",
    // Not featured: a leadership role has no honest pulled-out metric (the
    // résumé lists only the title + org), and inventing one ("Co-Founder"
    // etc.) would be worse than none — so it stays a regular card rather than
    // padding the hero row with an empty metric. Copy unchanged.
    blurb: "Western Founders Network.",
  },
  {
    category: "Leadership",
    title: "VP of Marketing",
    blurb: "Tethos.",
  },
];

// $3000 (Ontario Summer Company grant) + $500 (WFN Odyssey) + $2500 (TRREB)
// + $3500 (Western Scholarship of Distinction) + $2000 (National Merit)
// + $5000 (Chris Binns-Smith Memorial) = $16,500 total. Scholarships were
// previously labelled "Awarded" with no dollar figure and excluded from the
// stat: they had real amounts on the resume, so they're now itemised on
// each card AND rolled into the headline number.
export const TOTAL_GRANTS_USD = 16500;
export const TOTAL_WINS = ENTRIES.filter(
  (e) => e.category === "Hackathon" || e.category === "Competition",
).length;
export const TOTAL_LEADERSHIP = ENTRIES.filter((e) => e.category === "Leadership").length;

export function formatMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${n}`;
}
