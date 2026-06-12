import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./sections.css";
import "./about.css";
import { ScrambleText } from "./ScrambleText";

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
 *   0.66 – 0.78   key/value rows reveal one per beat
 *
 * MOBILE (≤720px) keeps the same pin but compresses the schedule
 * (MOBILE_* constants below): the room canvas is faded out on phones (see
 * about.css note), so About becomes a clean top-anchored section. The
 * "Daniel" wordmark heads it, then a gentle translateY rise brings the
 * full-width body up, with the lede + all rows + coda revealing in a
 * short scrub band (0.5 → 0.62) so a thumb-scrub lands the whole block.
 *
 * prefers-reduced-motion: when set, the panel is snapped into place and
 * every beat is forced revealed so the content is fully readable without
 * relying on the scrub-driven choreography. The scroll-pin itself still
 * works (it's structural, not decorative) but nothing fades/slides.
 */

const PIN_DURATION_PX = 1700;
/* Mobile pin is MUCH shorter. The 1700px desktop pin exists to pace the
   room/wireframe reveal beats — but the room canvas is faded out on
   phones (see about.css note), so most of that scrub was a blank page:
   ~550px of empty viewport before the card rose, and ~640px of pinned
   dwell after everything had revealed. 900px paces the compressed
   mobile schedule below with no dead air on either side. */
const MOBILE_PIN_DURATION_PX = 900;
// Panel slide-in window. WIDENED 0.55-0.62 (a 0.07 slice ≈ 119px of scroll,
// which whipped in even with scrub:1 — scrub floors the FULL progress sweep,
// not this narrow sub-range) to 0.15-0.58 (~0.43 of the pin ≈ 730px), so the
// panel eases in over a real stretch of scroll and lands just before the lede
// (0.63) / rows reveal. The slide window is the real rate lever here, not scrub.
const PANEL_SLIDE_START = 0.15;
const PANEL_SLIDE_END = 0.58;
/* Lede is the top of the panel + the first thing read, so it must
   reveal right after the panel lands, BEFORE the rows below it.
   (Previously gated at 0.79, which popped it in last, after every
   row had already appeared above an empty lede slot.) */
const LEDE_REVEAL_AT = 0.63;
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
const MOBILE_PANEL_SLIDE_START = 0.25;
const MOBILE_PANEL_SLIDE_END = 0.5;
const MOBILE_LEDE_REVEAL_AT = 0.5;
const MOBILE_ROW_START = 0.52;
const MOBILE_ROW_STEP = 0.05;
/* Wordmark lands almost immediately on mobile: there is no room reveal
   to wait for (canvas hidden), so any later and the pin opens on a
   blank page. */
const MOBILE_EYEBROW_AT = 0.12;

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
    value: <>Computer Science &amp; Ivey Business School, Western</>,
    beat: { at: 0.70 },
  },
  {
    label: "Exploring",
    value: <>Gaussian splatting &amp; semantic segmentation</>,
    beat: { at: 0.74 },
  },
  {
    label: "Reach",
    value: <a href="mailto:hello@danielrltan.com">hello@danielrltan.com</a>,
    beat: { at: 0.78 },
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
      ? window.matchMedia("(max-width: 768px)").matches
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
    /* 768 matches the room-canvas mobile fade + RoomPhysics pause
       breakpoint (App.tsx) AND the about.css mobile block: below it the
       room never shows during this pin, so the short mobile schedule
       must kick in (at the old 720 the 721-768 band got the long
       desktop pin over a hidden room = dead scroll). */
    const mql = window.matchMedia("(max-width: 768px)");
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
      end: `+=${mobile ? MOBILE_PIN_DURATION_PX : PIN_DURATION_PX}`,
      pin: true,
      pinSpacing: true,
      // Rate-limit: scrub:1 (a ~1s catch-up lerp), NOT scrub:true (which is
      // instant, locked 1:1 to scroll). Without the numeric scrub a fast
      // flick teleported the side panel in; now it eases through.
      scrub: 1,
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
    // Re-create the pin when the breakpoint flips so the pin duration
    // matches the layout (mirrors the Work/Keypad pattern).
  }, [mobile]);

  const slideStart = mobile ? MOBILE_PANEL_SLIDE_START : PANEL_SLIDE_START;
  const slideEnd = mobile ? MOBILE_PANEL_SLIDE_END : PANEL_SLIDE_END;
  const eyebrowAt = mobile ? MOBILE_EYEBROW_AT : 0.52;
  const ledeAt = mobile ? MOBILE_LEDE_REVEAL_AT : LEDE_REVEAL_AT;
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
  /* Reveal axis: a gentle rise on every breakpoint. The old desktop
     full-width translateX slide belonged to the retired sidebar panel
     (the content is now an uncontained overlay set into the page's
     negative space — sweeping it across the room read as a drawer).
     Desktop rises a touch less than mobile since its pieces are
     corner-anchored rather than a stacked card. */
  const panelOffset = (1 - panelEased) * 100;
  const panelTransform = mobile
    ? `translate3d(0, ${panelOffset * 0.18}%, 0)`
    : `translate3d(0, ${panelOffset * 0.06}%, 0)`;
  const ledeRevealed = reducedMotion || progress >= ledeAt;
  const rowRevealed = (at: number) => reducedMotion || progress >= at;

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-about">
      <div
        className={`about-floating-eyebrow${
          floatingEyebrowVisible ? " is-visible" : ""
        }`}
        aria-hidden
      >
        <span className="about-floating-num">01</span>
        <span className="about-floating-label">
          <ScrambleText text="About" play={floatingEyebrowVisible} />
          <span className="about-floating-period">.</span>
        </span>
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
        {/* Spec-sheet header: wayfinding index with a hairline rule
            beneath. Reads like the title block of a TE spec sheet and
            gives the panel a firm top edge instead of a lone floating
            index line. */}
        <div className="about-spec-header">
          <span className="section-index">01 / 06 &middot; About</span>
        </div>
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
              {/* Spec-sheet row numeral: pure chrome (aria-hidden), same
                  language as the Mac tiles' "01"-numbered cards. */}
              <span className="about-row-num" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <dt className="about-label">{row.label}</dt>
              <dd className="about-value">{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
