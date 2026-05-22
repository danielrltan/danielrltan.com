import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./sections.css";
import "./about.css";

gsap.registerPlugin(ScrollTrigger);

/**
 * About section — GSAP-pinned theatrical reveal.
 *
 * Pin holds the section in place for ~1.4 viewports of scroll. While
 * pinned, pin-progress drives a 3-beat content reveal:
 *
 *   beat 1 (0.00-0.30): big lede "I'm Daniel."
 *   beat 2 (0.30-0.65): "Currently / Studying / Building / Off-hours"
 *                       table reveals, row by row
 *   beat 3 (0.65-1.00): "Reach" row + a closing line
 *
 * Throughout the pin the room canvas stays at full opacity behind —
 * no mid-pin fade-out. The transition to Macintosh happens AFTER the
 * pin releases, with a tight room fade-out window so it doesn't drift
 * into the next section.
 *
 * Replaces the previous version where About content scrolled past
 * the user too quickly while the room faded mid-paragraph — read as
 * "everything is fading and overlapping at once."
 */

const PIN_DURATION_PX = 1100;

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
    beat: { at: 0.32 },
  },
  {
    label: "Studying",
    value: <>B.Sc. Computer Science, Western Ontario &rarr; 2027</>,
    beat: { at: 0.42 },
  },
  {
    label: "Building",
    value: <>Cognetech &middot; Revamp &middot; this site</>,
    beat: { at: 0.52 },
  },
  {
    label: "Off-hours",
    value: <>Piano &middot; Taekwondo &middot; mechanical keyboards</>,
    beat: { at: 0.62 },
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

  // Lede fades in early, stays. The other beats are owned per-row
  // via the beat.at threshold check below.
  const ledeRevealed = progress >= 0.05;

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-about">
      <div className="portfolio-col about-col">
        <span className="section-marker">01</span>
        <span className="section-index">01 / 06 &middot; About</span>
        <h2 className="about-h">About.</h2>
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
          className={`about-sign${progress >= 0.9 ? " is-revealed" : ""}`}
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
