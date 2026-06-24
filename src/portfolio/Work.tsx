import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { requestScrollRefresh } from "./scrollRefresh";
import "./sections.css";
import "./work-timeline.css";
import { ScrambleText } from "./ScrambleText";
import { scrollToSection } from "./Keypad";
import { track } from "../analytics";

gsap.registerPlugin(ScrollTrigger);

interface Stint {
  when: string;
  year: string;
  where: string;
  /** Short all-caps sector label shown above the company name. */
  brand: string;
  role?: string;
  location?: string;
  bullets: string[];
  /** Editorial pull-quote / impact metric extracted from the stint. */
  pull: { metric: string; caption: string };
  current?: boolean;
}

const STINTS: Stint[] = [
  {
    when: "May 2026 - Present",
    year: "2026",
    where: "Broadridge",
    brand: "Fintech",
    role: "Software Engineer",
    current: true,
    pull: { metric: "", caption: "" },
    bullets: [
      "Recently joined as a Software Engineer. More on this work soon.",
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
      "Engineered a ticket automation extension that resolved 30% of support load autonomously, cutting response times by 50% and improving SLA compliance at scale for 89M users.",
      "Built and deployed an internal Slackbot “Demerzel” with thread-based context, TOML-configured endpoints, Prometheus metrics, and Notion-integrated memory prompts, grounded in 650+ internal articles.",
      "Integrated OpenAI API for ticket automation, reducing manual triage from 90s to 20s per average ticket.",
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
      "Implemented Gmail OAuth for user authentication, replacing MFA entry with a secure flow that contributed to a launch driving 600+ users in the first week.",
      "Automated hiring email verification with a Firebase script cross-referencing 250+ applicant emails against the user DB. 33 minutes of manual work down to 5 seconds.",
    ],
  },
];

/**
 * Work: "The Ledger" — a CLICK-DRIVEN ACCORDION TIMELINE.
 *
 * Every role is a node on a left spine and is always visible as a header
 * (dot-matrix year + sector + company + dates). Click any row to drop it open
 * (role, pull metric, bullets) — a single-open accordion, so opening one closes
 * the last, and re-clicking the open row collapses it. The whole row is the
 * button; it lifts a clear colour wash on hover so it unmistakably reads as
 * pressable. No scroll-pinning or scroll-scrub: the section flows with the page
 * and you navigate it purely by clicking (the old pinned scrub coupled "which
 * role is open" to scroll position, which read as unclickable / fighting the
 * scroll — replaced wholesale per user feedback).
 *
 * Motion (Emil / impeccable): panels open on an ease-out height+fade, the
 * chevron rotates, bullets stagger in. prefers-reduced-motion opens every panel
 * and drops the transitions for a static, readable résumé.
 */
export function Work() {
  const sectionRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [entered, setEntered] = useState(false);

  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  // Mobile (<=900px): the narrow accordion already stacks full-width, and the
  // smooth scrollIntoView nudge on open reads as a jarring page-jerk on a phone
  // (the row is already in view). Let panels expand in place there; desktop
  // keeps the scroll-into-view so a lower row's detail isn't left below the
  // fold. Read once at mount — a viewport-class flip is rare enough that not
  // re-subscribing is fine, and avoids a listener for a one-line guard.
  const [isMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 900px)").matches,
  );

  // Single-open accordion. Current role open first so the section never reads as
  // a wall of collapsed rows. null = all collapsed.
  const firstOpen = Math.max(
    0,
    STINTS.findIndex((s) => s.current),
  );
  const [openIndex, setOpenIndex] = useState<number | null>(firstOpen);

  // Entrance reveal once the section scrolls into view (replaces the old GSAP
  // pin's onEnter). One-shot, and a no-op default-visible under reduced motion.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (reducedMotion || typeof IntersectionObserver === "undefined") {
      setEntered(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setEntered(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -18% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reducedMotion]);

  // DESKTOP GUIDED TIMELINE: pin the section and roll the scroll THROUGH the
  // timeline — each entry auto-opens in turn and the vertical spine fills with
  // accent (--work-fill 0..1) so you can see yourself traversing down it. A
  // click jumps the SCROLL to that entry's band (handleActivate), so the click
  // and the scrub agree instead of fighting (the reason the old pin was pulled).
  // Skipped on mobile / reduced-motion: those keep the plain click-accordion.
  const stRef = useRef<ScrollTrigger | null>(null);
  const pinPxRef = useRef(0);
  useEffect(() => {
    if (isMobile || reducedMotion) return;
    const el = sectionRef.current;
    if (!el) return;
    const N = STINTS.length;
    // ~0.62 viewport of scroll per entry: enough dwell to read each before the
    // next opens, short enough that the pin never feels like a scroll-trap.
    const pinPx = Math.round(N * (window.innerHeight || 800) * 0.62);
    pinPxRef.current = pinPx;
    el.style.setProperty("--work-fill", "0");
    const st = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: `+=${pinPx}`,
      pin: true,
      pinSpacing: true,
      onUpdate: (self) => {
        const p = self.progress;
        const idx = Math.min(N - 1, Math.max(0, Math.floor(p * N)));
        setOpenIndex(idx);
        // Fill leads the active node a touch so the spine reads "ahead of" the
        // open row rather than lagging it.
        el.style.setProperty("--work-fill", Math.min(1, p + 0.5 / N).toFixed(3));
      },
    });
    stRef.current = st;
    const html = document.documentElement;
    let lastLoading = html.classList.contains("loading-active");
    const obs = new MutationObserver(() => {
      const now = html.classList.contains("loading-active");
      if (lastLoading && !now) requestScrollRefresh();
      lastLoading = now;
    });
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    if (!lastLoading) requestScrollRefresh();
    return () => {
      obs.disconnect();
      st.kill();
      stRef.current = null;
    };
    // Re-create when the breakpoint flips so the pin is added/torn down to match.
  }, [isMobile, reducedMotion]);

  // Open a row. On the desktop guided timeline this JUMPS the scroll to that
  // entry's band (the pin's onUpdate then opens it + advances the fill, so the
  // click and the scroll never disagree). Mobile / reduced-motion just toggle
  // open in place (no pin, no scroll-jack).
  const handleActivate = (i: number) => {
    if (i === openIndex && (isMobile || reducedMotion)) return;
    if (isMobile || reducedMotion) {
      setOpenIndex(i);
      return;
    }
    const st = stRef.current;
    if (!st) {
      setOpenIndex(i);
      return;
    }
    const N = STINTS.length;
    scrollToSection(st.start + ((i + 0.5) / N) * pinPxRef.current);
  };

  const isOpen = (i: number) => reducedMotion || i === openIndex;

  return (
    <section
      ref={sectionRef}
      aria-label="Work experience timeline"
      className={`portfolio-section portfolio-work${entered ? " is-entered" : ""}${reducedMotion ? " is-reduced-motion" : ""}`}
    >
      <div className="work-ledger">
        <header className="work-ledger-head">
          <div className="work-ledger-head-text">
            <div className="work-ledger-head-left">
              <span className="work-ledger-num">03</span>
              <span className="work-ledger-index">03 / 06 · Work</span>
            </div>
            <h2 className="work-ledger-title">
              <ScrambleText text="Experience" />
            </h2>
          </div>

          {/* Résumé CTA — relocated out of the awkward floating top-right corner
              into the header flow, and given a real accent treatment (orange
              keyline + arrow at rest, fills solid orange on hover) so it actually
              reads as the primary action of the section instead of disappearing
              into the chrome. */}
          <a
            href="/resume/Daniel_Tan_Resume.pdf"
            target="_blank"
            rel="noreferrer"
            aria-label="Download Daniel Tan's full résumé (PDF, opens in a new tab)"
            className="work-resume"
            onClick={() => track("resume_download", { context: "work" })}
          >
            <span className="work-resume-label">Full résumé</span>
            <span className="work-resume-arrow" aria-hidden>
              ↗
            </span>
          </a>
        </header>

        <ol className="work-acc">
          {STINTS.map((s, i) => {
            const open = isOpen(i);
            const panelId = `work-panel-${i}`;
            return (
              <li
                key={i}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                className={`work-acc-item${open ? " is-open" : ""}${s.current ? " is-current" : ""}${openIndex != null && i < openIndex ? " is-past" : ""}`}
              >
                <button
                  type="button"
                  className="work-acc-head"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => {
                    if (!open) track("work_expand", { role: s.brand });
                    handleActivate(i);
                  }}
                >
                  <span className="work-acc-node" aria-hidden>
                    <span className="work-acc-year">{s.year}</span>
                  </span>
                  <span className="work-acc-headline">
                    <span className="work-acc-brand">
                      <span className="work-acc-brand-text">{s.brand}</span>
                      {s.current && (
                        <span className="work-acc-current">Currently</span>
                      )}
                    </span>
                    <span className="work-acc-company">{s.where}</span>
                  </span>
                  <span className="work-acc-side">
                    <span className="work-acc-when">{s.when}</span>
                    {/* Plain chevron — the misleading "button-in-a-circle" ring
                        is gone (it read as the only clickable thing while the row
                        itself is the control). It rotates 180° on open and goes
                        accent on row-hover. */}
                    <span className="work-acc-chevron" aria-hidden>
                      <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                        <path
                          d="M6 9l5 5 5-5"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="square"
                        />
                      </svg>
                    </span>
                  </span>
                </button>

                <div id={panelId} className="work-acc-panel" role="region">
                  <div className="work-acc-panel-inner">
                    <div className="work-acc-meta">
                      {s.role && <span className="work-acc-role">{s.role}</span>}
                      {s.location && (
                        <span className="work-acc-locgroup">
                          <span className="work-acc-sep" aria-hidden>
                            /
                          </span>
                          {s.location}
                        </span>
                      )}
                    </div>

                    {s.pull.metric && (
                      <div className="work-acc-pull">
                        <div className="work-acc-pull-metric">
                          {s.pull.metric}
                        </div>
                        {s.pull.caption && (
                          <p className="work-acc-pull-caption">
                            {s.pull.caption}
                          </p>
                        )}
                      </div>
                    )}

                    <ul className="work-acc-bullets">
                      {s.bullets.map((b, j) => (
                        <li
                          key={j}
                          className="work-acc-bullet"
                          style={{ ["--bullet-i" as string]: j }}
                        >
                          <span className="work-acc-bullet-num">
                            {String(j + 1).padStart(2, "0")}
                          </span>
                          <span className="work-acc-bullet-text">{b}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
