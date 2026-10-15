/**
 * Work stints, shared by the desktop timeline (Work.tsx) and the phone site
 * (src/phone).
 */

export interface Stint {
  when: string;
  year: string;
  where: string;
  /** Short all-caps sector label shown above the company name. */
  brand: string;
  role?: string;
  location?: string;
  /** `**key phrase**` renders bold (see BulletText). */
  bullets: string[];
  /** Editorial pull-quote / impact metric extracted from the stint. */
  pull: { metric: string; caption: string };
  current?: boolean;
}

export const STINTS: Stint[] = [
  {
    when: "May 2026 - Aug 2026",
    year: "2026",
    where: "Broadridge",
    brand: "Fintech",
    role: "Software Developer Intern",
    location: "Toronto, ON",
    pull: {
      metric: "COBOL → Java 21",
      caption:
        "legacy tax-slip logic, re-realized as structured YAML rules and a Spring Boot service verified against DB2",
    },
    bullets: [
      "Built an **AI-assisted COBOL modernization** proof of concept: turned legacy tax-slip status logic into **12 structured YAML rules** and a generated **Java 21 / Spring Boot service**, verified end-to-end against development DB2.",
      "Adapted the existing batch DAO contract into a **REST path with dynamic T4A/R1 routing**, optimistic concurrency, and per-slip results, so the live application called the new service with **no redesign**.",
      "Designed a **reusable family of extraction and code-generation agents** plus an alternate iBatis realization, showing the rules were stack-independent. Integration tests green: **2 run, 0 failures**.",
    ],
  },
  {
    when: "May 2025 - Nov 2025",
    year: "2025",
    where: "Windscribe",
    brand: "VPN Privacy",
    role: "Software Developer Intern",
    location: "Toronto, ON",
    pull: {
      metric: "90s → 20s",
      caption:
        "manual triage per ticket, via an OpenAI-backed automation flow deployed to 89M users",
    },
    bullets: [
      "Engineered a ticket automation extension that **resolved 30% of support load autonomously**, **cutting response times by 50%** and improving SLA compliance at scale for **89M users**.",
      "Built and deployed an **internal Slackbot “Demerzel”** with thread-based context, TOML-configured endpoints, Prometheus metrics, and Notion-integrated memory prompts, grounded in **650+ internal articles**.",
      "Integrated **OpenAI API** for ticket automation, reducing manual triage from **90s to 20s** per average ticket.",
    ],
  },
  {
    when: "Jan 2025 - May 2025",
    year: "2025",
    where: "Nodes",
    brand: "Automation",
    role: "Software Developer Intern",
    location: "London, ON",
    pull: {
      metric: "33min → 5s",
      caption:
        "hiring-email verification, automated against 250+ applicants via a Firebase cross-check",
    },
    bullets: [
      "Implemented **Gmail OAuth** for user authentication, replacing MFA entry with a secure flow that contributed to a launch driving **600+ users in the first week**.",
      "Automated hiring email verification with a Firebase script cross-referencing **250+ applicant emails** against the user DB. **33 minutes of manual work down to 5 seconds**.",
    ],
  },
];
