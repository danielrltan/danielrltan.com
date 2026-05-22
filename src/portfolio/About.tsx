import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./sections.css";
import "./about.css";

gsap.registerPlugin(ScrollTrigger);

/**
 * About section — GSAP-pinned theatrical reveal.
 *
 * Beats (anchored to pin progress 0..1):
 *
 *   0.00 – 0.30   wireframes assemble (room hidden by cover dome)
 *   0.30 – 0.50   wireframes hold
 *   0.50 – 0.52   hard swap — wireframes/dome cut to 0, room appears
 *   0.52 – 0.68   ROOM SOLO  — full room visible, only a small
 *                              "ABOUT" eyebrow floats in the
 *                              bottom-left. Lets the user actually
 *                              look at the room without competing
 *                              copy.
 *   0.68 – 0.78   content panel slides in from the right
 *   0.78 – 0.94   lede + 4 inline rows reveal sequentially inside
 *                 the panel
 *   0.94 – 1.00   "Reach" row + "Scroll for the kit →" sign-off
 *
 * The room canvas stays at full opacity from the swap onward. The
 * Macintosh transition happens after the pin releases.
 */

// Longer pin than the original 1100px — the room-solo beat needs
// dwell time, and the panel slide-in + content reveal needs scroll
// room of its own.
const PIN_DURATION_PX = 1700;

// Pin progress at which the content panel begins sliding in.
const PANEL_SLIDE_START = 0.68;
// Pin progress at which the content panel is fully landed.
const PANEL_SLIDE_END = 0.78;

interface Beat {
  /** pin-progress threshold at which this beat is fully revealed. */
  at: number;
}

const ROWS: Array<{ label: string; value: React.ReactNode; beat: Beat }> = [
  {
    label: "Currently",
    value: (
      <>
        Software Developer @{" "}
        <a href="https://windscribe.com" target="_blank" rel="noreferrer">
          Windscribe
        </a>
      </>
    ),
    beat: { at: 0.81 },
  },
  {
    label: "Studying",
    value: <>B.Sc. Computer Science, Western Ontario &rarr; 2027</>,
    beat: { at: 0.85 },
  },
  {
    label: "Building",
    value: <>Cognetech &middot; Revamp &middot; this site</>,
    beat: { at: 0.88 },
  },
  {
    label: "Off-hours",
    value: <>Piano &middot; Taekwondo &middot; mechanical keyboards</>,
    beat: { at: 0.91 },
  },
  {
    label: "Reach",
    value: <a href="mailto:hello@danielrltan.com">hello@danielrltan.com</a>,
    beat: { at: 0.95 },
  },
];

export function About() {
  const sectionRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);

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

  // Floating "ABOUT" eyebrow visible from the moment the room appears
  // (pin 0.52) and stays until the panel takes over.
  const floatingEyebrowVisible = progress >= 0.52 && progress < PANEL_SLIDE_END;
  // Panel slide-in: 0 = off-screen right, 1 = landed.
  const panelSlide = Math.max(
    0,
    Math.min(
      1,
      (progress - PANEL_SLIDE_START) / (PANEL_SLIDE_END - PANEL_SLIDE_START),
    ),
  );
  // Ease-out cubic for a softer arrival.
  const panelEased = 1 - Math.pow(1 - panelSlide, 3);
  // Lede revealed once the panel is mostly landed.
  const ledeRevealed = progress >= 0.79;

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-about">
      {/* Floating wordmark during the room-solo beat. Anchored to
          the bottom-left of the viewport with the room as its
          backdrop. The panel's H2 was removed, so this is now the
          only 'About' heading on screen — no duplication. */}
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
          // Slide the panel in from the right. The translateX
          // percentage is relative to the panel's own width, so 100%
          // is fully off-screen to the right.
          transform: `translate3d(${(1 - panelEased) * 100}%, 0, 0)`,
          opacity: panelEased,
        }}
      >
        <span className="section-marker">01</span>
        <span className="section-index">01 / 06 &middot; About</span>
        {/* H2 'About.' removed — the floating wordmark on the room
            ('Daniel.') + the eyebrow above + the lede paragraph
            below carry the section heading. A literal 'About.' here
            duplicated what the floating element already said. */}
        <p
          className={`about-lede${ledeRevealed ? " is-revealed" : ""}`}
        >
          I&rsquo;m Daniel — a <span className="accent">software developer</span> in
          Toronto who likes building the parts of products that feel
          alive. Right now that&rsquo;s AI tooling, agentic systems, and
          interactive 3D on the web.
        </p>
        <div className="about-grid">
          {ROWS.map((row) => (
            <div
              key={row.label}
              className={`about-row${progress >= row.beat.at ? " is-revealed" : ""}`}
            >
              <span className="about-label">{row.label}</span>
              <span className="about-value">{row.value}</span>
            </div>
          ))}
        </div>
        <div
          className={`about-sign${progress >= 0.97 ? " is-revealed" : ""}`}
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
