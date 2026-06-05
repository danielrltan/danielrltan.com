import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./sections.css";
import "./about.css";

gsap.registerPlugin(ScrollTrigger);

/**
 * About: GSAP-pinned theatrical reveal.
 *
 * DESKTOP pin progress beats (kept in sync with the thresholds below):
 *   0.00 – 0.50   wireframes assemble + hold (room hidden by cover dome)
 *   0.50 – 0.52   hard swap: wireframes/dome cut to 0, room appears
 *   0.52 – 0.55   room solo (only the floating "About." wordmark)
 *   0.55 – 0.62   content panel slides in from the right (over the room)
 *   0.63          lede reveals (top of panel, first body beat)
 *   0.66 – 0.79   key/value rows reveal one per beat
 *   0.82          sign-off row
 *
 * MOBILE (≤720px) keeps the same pin but compresses the schedule
 * (MOBILE_* constants below): the room canvas is faded out on phones (see
 * about.css note), so About becomes a clean top-anchored section. The
 * "About." wordmark heads it, then a gentle translateY rise brings the
 * full-width body up, with the lede + all rows + sign-off revealing in a
 * short scrub band (0.5 → 0.68) so a thumb-scrub lands the whole block.
 *
 * prefers-reduced-motion: when set, the panel is snapped into place and
 * every beat is forced revealed so the content is fully readable without
 * relying on the scrub-driven choreography. The scroll-pin itself still
 * works (it's structural, not decorative) but nothing fades/slides.
 */

const PIN_DURATION_PX = 1700;
const PANEL_SLIDE_START = 0.55;
const PANEL_SLIDE_END = 0.62;
/* Lede is the top of the panel + the first thing read, so it must
   reveal right after the panel lands, BEFORE the rows below it.
   (Previously gated at 0.79, which popped it in last, after every
   row had already appeared above an empty lede slot.) */
const LEDE_REVEAL_AT = 0.63;
const SIGN_REVEAL_AT = 0.82;

/* Mobile (≤720px) reveal schedule. On a phone the same 1700px pin is
   scrubbed with a thumb, so the desktop drip (panel 0.55→0.62, then
   six staggered beats trailing out to 0.82) means a reader has to
   scrub most of the pin before the content is even legible. We pull
   everything earlier and tighten the spacing so the card lands and
   reads as one clean block. The panel also rises from the bottom
   (translateY) rather than sliding in from the right: natural for
   portrait, and it keeps the room + wordmark visible above the card
   the whole time. Row thresholds stay ordered so the stagger still
   reads top-to-bottom, just over a much shorter scrub band. */
const MOBILE_PANEL_SLIDE_START = 0.4;
const MOBILE_PANEL_SLIDE_END = 0.5;
const MOBILE_LEDE_REVEAL_AT = 0.5;
const MOBILE_ROW_START = 0.52;
const MOBILE_ROW_STEP = 0.025;
const MOBILE_SIGN_REVEAL_AT = 0.68;
/* Wordmark appears a touch earlier on mobile so it has presence over
   the room before the card rises. */
const MOBILE_EYEBROW_AT = 0.32;

interface Beat {
  /** pin-progress threshold at which this beat is fully revealed. */
  at: number;
}

const ROWS: Array<{ label: string; value: React.ReactNode; beat: Beat }> = [
  {
    label: "Currently",
    value: (
      <>
        Software Engineer @{" "}
        <a href="https://www.broadridge.com" target="_blank" rel="noreferrer">
          Broadridge
        </a>
      </>
    ),
    beat: { at: 0.66 },
  },
  {
    label: "Studying",
    value: <>B.Sc. Computer Science, Western Ontario &rarr; 2027</>,
    beat: { at: 0.70 },
  },
  {
    label: "Building",
    value: <>Cognetech &middot; Revamp &middot; this site</>,
    beat: { at: 0.73 },
  },
  {
    label: "Off-hours",
    value: <>Piano &middot; Taekwondo &middot; mechanical keyboards</>,
    beat: { at: 0.76 },
  },
  {
    label: "Reach",
    value: <a href="mailto:hello@danielrltan.com">hello@danielrltan.com</a>,
    beat: { at: 0.79 },
  },
];

export function About() {
  const sectionRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  /* Mirror the CSS panel breakpoint (≤720px goes full-width) so the
     reveal schedule + slide axis match the layout the user actually
     sees. Initialised synchronously to avoid a desktop→mobile flash on
     first paint. */
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(max-width: 720px)").matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(max-width: 720px)");
    const apply = () => setMobile(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const st = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: `+=${PIN_DURATION_PX}`,
      pin: true,
      pinSpacing: true,
      scrub: true,
      anticipatePin: 1,
      onUpdate: (self) => setProgress(self.progress),
    });
    const html = document.documentElement;
    let lastLoading = html.classList.contains("loading-active");
    const obs = new MutationObserver(() => {
      const now = html.classList.contains("loading-active");
      if (lastLoading && !now) ScrollTrigger.refresh();
      lastLoading = now;
    });
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    if (!lastLoading) {
      requestAnimationFrame(() => ScrollTrigger.refresh());
    }
    return () => {
      obs.disconnect();
      st.kill();
    };
  }, []);

  const slideStart = mobile ? MOBILE_PANEL_SLIDE_START : PANEL_SLIDE_START;
  const slideEnd = mobile ? MOBILE_PANEL_SLIDE_END : PANEL_SLIDE_END;
  const eyebrowAt = mobile ? MOBILE_EYEBROW_AT : 0.52;
  const ledeAt = mobile ? MOBILE_LEDE_REVEAL_AT : LEDE_REVEAL_AT;
  const signAt = mobile ? MOBILE_SIGN_REVEAL_AT : SIGN_REVEAL_AT;
  /* Row thresholds: on desktop each row carries its own authored beat;
     on mobile we re-space them off a tighter base so the whole list
     reveals in a short scrub band right after the card lands. */
  const rowAt = (index: number, desktopAt: number) =>
    mobile ? MOBILE_ROW_START + index * MOBILE_ROW_STEP : desktopAt;

  const floatingEyebrowVisible = reducedMotion || progress >= eyebrowAt;
  const panelSlide = Math.max(
    0,
    Math.min(1, (progress - slideStart) / (slideEnd - slideStart)),
  );
  // Reduced motion: snap the panel fully in (no slide / fade-in).
  const panelEased = reducedMotion ? 1 : 1 - Math.pow(1 - panelSlide, 3);
  /* Slide axis: desktop panel enters from the right (translateX) over the
     full-bleed room; mobile (room canvas faded out, see about.css note)
     gently rises (translateY) into a top-anchored, self-contained section.
     Distance is a fraction of the element box so it tracks the panel size. */
  const panelOffset = (1 - panelEased) * 100;
  /* Mobile rises a modest fraction of its own height (a gentle lift, not a
     full-screen sweep); desktop slides the full panel width from the right. */
  const panelTransform = mobile
    ? `translate3d(0, ${panelOffset * 0.18}%, 0)`
    : `translate3d(${panelOffset}%, 0, 0)`;
  const ledeRevealed = reducedMotion || progress >= ledeAt;
  const rowRevealed = (at: number) => reducedMotion || progress >= at;
  const signRevealed = reducedMotion || progress >= signAt;

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-about">
      <div
        className={`about-floating-eyebrow${
          floatingEyebrowVisible ? " is-visible" : ""
        }`}
        aria-hidden
      >
        <span className="about-floating-num">01</span>
        <span className="about-floating-label">About.</span>
      </div>

      <div
        className="portfolio-col about-col"
        style={{
          transform: panelTransform,
          opacity: panelEased,
        }}
      >
        <span className="section-marker" aria-hidden="true">
          01
        </span>
        <span className="section-index">01 / 06 &middot; About</span>
        {/* DOM-real heading for screen readers / SEO. The big floating
            "About." wordmark that carries this visually is aria-hidden,
            so this is the section's only programmatic heading: it must
            exist even though it's not painted. */}
        <h2 className="about-sr-heading">About Daniel Tan</h2>
        <p
          className={`about-lede${ledeRevealed ? " is-revealed" : ""}`}
        >
          I&rsquo;m Daniel, a <span className="accent">software developer</span> in
          Toronto who likes building the parts of products that feel
          alive. Right now that&rsquo;s AI tooling, agentic systems, and
          interactive 3D on the web.
        </p>
        <dl className="about-grid">
          {ROWS.map((row, index) => (
            <div
              key={row.label}
              className={`about-row${rowRevealed(rowAt(index, row.beat.at)) ? " is-revealed" : ""}`}
            >
              <dt className="about-label">{row.label}</dt>
              <dd className="about-value">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div
          className={`about-sign${signRevealed ? " is-revealed" : ""}`}
        >
          <span className="about-sign-line" />
          <span className="about-sign-text">
            Scroll for the kit &rarr;
          </span>
        </div>
      </div>
    </section>
  );
}
