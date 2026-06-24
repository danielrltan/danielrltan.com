import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { requestScrollRefresh } from "./scrollRefresh";
import "./sections.css";
import "./about.css";
import { ScrambleText } from "./ScrambleText";
import { track } from "../analytics";

gsap.registerPlugin(ScrollTrigger);

/**
 * About: GSAP-pinned BENTO DASHBOARD reveal.
 *
 * The section is an opaque light-grey bento grid (faint dot-grid bg) that
 * "boots up" as the pin scrubs. The isometric room render (/render.webp) is
 * the feature centerpiece; two info cards sit BEHIND it (the room's
 * transparent margins let them peek through, the room silhouette occludes
 * the rest) and two chips float IN FRONT. As pin progress climbs, each cell
 * crosses an increasing threshold and fades+rises into place — a dashboard
 * powering on, panel by panel.
 *
 * DESKTOP pin progress beats (kept in sync with the CELLS thresholds below):
 *   0.06   topbar / crumb header lights up
 *   0.10   NAME + lede card
 *   0.18   feature render (the centerpiece)
 *   0.24   portrait
 *   0.30   "Currently" (behind, peeks under render's left margin)
 *   0.36   "Exploring" (behind, peeks under render's right margin)
 *   0.44   "Studying"
 *   0.50   "Reach"
 *   0.56   "Location"
 *   0.62   "Focus / 3D" dark card
 *   0.70   "Building things that feel alive" front chip
 *   0.76   "SCENE / VERTS" front chip
 *
 * MOBILE (≤900px) SKIPS the pin entirely (mirrors Work's staticLayout): a
 * pinned, internally-scrolling stage was a nested scroll-trap inside the
 * page pin. The bento collapses to a single readable column (render is a
 * smaller hero at the top, cards stack full-width) that flows + scrolls with
 * the page, and every cell is force-revealed up front (no scrub dependency).
 *
 * prefers-reduced-motion: every cell is force-revealed (no transforms),
 * so the dashboard is fully readable without the scrub choreography. The
 * scroll-pin itself still works (structural, not decorative).
 */

const PIN_DURATION_PX = 1700;

/* Mobile reveal band: everything lands in a tight 0.18 → 0.66 window so a
   thumb-scrub powers the whole dashboard up as one block. Cells keep their
   ORDER (via the CELLS index) but ride this compressed base + step. */
const MOBILE_REVEAL_START = 0.18;
const MOBILE_REVEAL_STEP = 0.045;

/** A bento cell's identity, layout class, and pin-progress reveal beat. */
interface Cell {
  /** stable key + CSS class suffix (.c-<key>). */
  key: string;
  /** pin-progress threshold at which this cell is fully revealed (desktop). */
  at: number;
}

/* Reveal order = boot-up order. Mobile re-spaces these off a tighter base
   while preserving the sequence, so the column still reveals top-to-bottom. */
const CELLS: Cell[] = [
  { key: "name", at: 0.1 },
  { key: "render", at: 0.18 },
  { key: "portrait", at: 0.24 },
  { key: "now", at: 0.3 },
  { key: "explore", at: 0.36 },
  { key: "study", at: 0.44 },
  { key: "reach", at: 0.5 },
  { key: "loc", at: 0.56 },
];

/* Topbar / crumb lights up first; its own early beat. */
const HEADER_AT = 0.06;
const MOBILE_HEADER_AT = 0.08;

export function About() {
  const sectionRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  /* Mirror the CSS bento breakpoint (≤900px collapses to one column) so the
     reveal schedule matches the layout the user actually sees. Initialised
     synchronously to avoid a desktop→mobile flash on first paint. Aligned to
     900px (Work's breakpoint) so the 769-900 tablet band gets the stacked
     column too. */
  const [mobile, setMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(max-width: 900px)").matches
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
    /* 900 matches Work's mobile breakpoint AND the about.css mobile block:
       below it the bento collapses to a single column and the GSAP pin is
       skipped, so the mobile (non-pinned) layout must kick in. Using 900 (not
       768) removes the cramped 769-900 tablet band where the dense 12-col
       bento and the floating room overlapped the side cards. */
    const mql = window.matchMedia("(max-width: 900px)");
    const apply = () => setMobile(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    // MOBILE: skip the GSAP pin entirely (mirrors Work's staticLayout). The
    // pinned bento on a phone created a nested scroll-trap — a full-height
    // internally-scrolling stage captured inside the page pin (rubber-band).
    // On mobile the bento is a plain stacked single column that scrolls with
    // the page; the cells force-reveal up front so nothing depends on scrub.
    if (mobile) {
      setProgress(1);
      // A breakpoint flip from desktop→mobile kills the old pin; refresh so
      // every pin BELOW (Work, Other, Keypad) recomputes its start now that
      // this section no longer contributes a pin spacer.
      const html = document.documentElement;
      if (!html.classList.contains("loading-active")) {
        requestScrollRefresh();
      }
      return;
    }

    const st = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: `+=${PIN_DURATION_PX}`,
      pin: true,
      pinSpacing: true,
      // Rate-limit: scrub:1 (a ~1s catch-up lerp), NOT scrub:true (instant,
      // locked 1:1 to scroll). Without the numeric scrub a fast flick would
      // teleport the dashboard in; now the cells ease up through the band.
      scrub: 1,
      anticipatePin: 1,
      onUpdate: (self) => setProgress(self.progress),
    });
    const html = document.documentElement;
    let lastLoading = html.classList.contains("loading-active");
    const obs = new MutationObserver(() => {
      const now = html.classList.contains("loading-active");
      if (lastLoading && !now) requestScrollRefresh();
      lastLoading = now;
    });
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    // Refresh after THIS pin is (re)created — not only after the loading
    // scrim clears. When the breakpoint flips mid-session (rotation), the
    // pin is killed and recreated with a different duration, which changes
    // this section's spacer height and therefore the START position of
    // every pin below it (Work, Other, Keypad). Without a refresh those
    // pins keep stale positions until some other refresh happens to fire.
    if (!lastLoading) {
      requestScrollRefresh();
    }
    return () => {
      obs.disconnect();
      st.kill();
    };
    // Re-create (or skip) the pin when the breakpoint flips so the layout
    // matches (mirrors the Work/Keypad pattern).
  }, [mobile]);

  /* Reveal gate. reduced-motion → everything revealed up front. Otherwise a
     cell is revealed once progress crosses its threshold; mobile re-spaces
     each cell off a tighter base by its order index so the stack reveals
     top-to-bottom in a short scrub band. The CSS handles the rise/fade. */
  const headerAt = mobile ? MOBILE_HEADER_AT : HEADER_AT;
  const headerRevealed = reducedMotion || progress >= headerAt;

  const cellAt = (index: number, desktopAt: number) =>
    mobile ? MOBILE_REVEAL_START + index * MOBILE_REVEAL_STEP : desktopAt;

  const revealed = (index: number, desktopAt: number) =>
    reducedMotion || progress >= cellAt(index, desktopAt);

  /* Look a cell up by key so the JSX can ask for its class without tracking
     indices by hand (the array order IS the boot order). `base` is the
     reveal-bearing wrapper class: glass cells use "card", the two floating
     chips use "front" (they carry their own surface, NOT the .card glass). */
  const cellClass = (key: string, base = "card") => {
    const index = CELLS.findIndex((c) => c.key === key);
    const cell = CELLS[index];
    const on = revealed(index, cell.at) ? " is-revealed" : "";
    return `${base} c-${key}${on}`;
  };

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-about">
      <div className="about-stage">
        {/* TOP CHROME: wayfinding crumb + status. The big "ABOUT" wordmark
            is aria-hidden chrome; the real <h2> below carries the heading
            for assistive tech / SEO. */}
        <header
          className={`about-banner${headerRevealed ? " is-revealed" : ""}`}
          aria-hidden="true"
        >
          <div className="about-banner-meta">
            <span className="about-crumb-idx">01</span>
            <span className="about-crumb-rule" />
            <span className="about-banner-domain">danielrltan.com</span>
          </div>
          <p className="about-banner-title">
            <ScrambleText text="About" play={headerRevealed} />
          </p>
        </header>

        {/* DOM-real <h2> for assistive tech + SEO. The painted "ABOUT"
            wordmark above is aria-hidden, so this is the section's only
            programmatic heading: present even though it's visually hidden. */}
        <h2 className="about-sr-heading">About Daniel Tan</h2>

        {/* BENTO GRID. Depth: behind-cards (Currently / Exploring) carry a
            low z-index and tuck under the render's transparent margins; the
            render cell + room art occlude them. The two chips float on top
            (high z-index). */}
        <div className="about-grid">
          {/* NAME + LEDE */}
          <div className={cellClass("name")}>
            <div className="pad">
              <div className="c-name-top">
                <span className="label">Software developer / Toronto</span>
              </div>
              <p className="about-name-h" aria-hidden="true">
                Daniel <span>Tan</span>
              </p>
              <p className="about-lede">
                I&rsquo;m Daniel, a{" "}
                <span className="accent">software developer</span> in Toronto
                who likes building the parts of products that{" "}
                <span className="accent">feel alive</span>. Right now that&rsquo;s{" "}
                <span className="accent">AI tooling</span>, agentic systems,
                and interactive 3D on the web.
              </p>
            </div>
          </div>

          {/* FEATURE RENDER — the centerpiece. Cell is transparent so only
              the room art paints; the transparent PNG margins let the behind
              cards show through, while the room silhouette occludes them. */}
          <div className={cellClass("render")}>
            <div className="render-frame">
              <img className="about-room" src="/render.webp" alt="" />
            </div>
          </div>

          {/* PORTRAIT */}
          <div className={cellClass("portrait")}>
            {/* Photo + caption STACKED and hugging the right edge so the central
                floating room only overlaps the empty inner half, never the
                portrait. */}
            <div className="portrait-wrap">
              <img
                className="about-portrait"
                src="/images/Me.jpg"
                alt="Daniel Tan"
                width={800}
                height={800}
                loading="lazy"
                decoding="async"
              />
              <div className="portrait-info" aria-hidden="true">
                <span className="n">Daniel Tan</span>
                <span className="r">Software Engineer / Designer</span>
              </div>
            </div>
          </div>

          {/* CURRENTLY — behind, peeks under the render's LEFT margin. */}
          <dl className={`${cellClass("now")} c-info behind`}>
            <div className="pad">
              <dt className="label">Currently</dt>
              <dd className="c-info-body">
                <span className="big">
                  Software
                  <br />
                  Engineer
                </span>
                <span className="pill">
                  @{" "}
                  <a
                    href="https://www.broadridge.com"
                    target="_blank"
                    rel="noreferrer"
                    onClick={() =>
                      track("outbound_link", {
                        url: "broadridge",
                        context: "about",
                      })
                    }
                  >
                    Broadridge
                  </a>
                </span>
              </dd>
            </div>
          </dl>

          {/* EXPLORING — behind, peeks under the render's RIGHT margin. */}
          <dl className={`${cellClass("explore")} c-info behind`}>
            <div className="pad">
              <dt className="label">Exploring</dt>
              <dd className="c-info-body">
                <span className="big">
                  Gaussian
                  <br />
                  splatting
                </span>
                <span className="tags">
                  <span className="tag">Splatting</span>
                  <span className="tag">Semantic segmentation</span>
                </span>
              </dd>
            </div>
          </dl>

          {/* STUDYING */}
          <dl className={`${cellClass("study")} c-info`}>
            <div className="pad">
              <dt className="label">Studying</dt>
              <dd className="c-info-body">
                <span className="study-split">
                  <span className="study-col">
                    <span className="mini">Degree</span>
                    <span className="val">Computer Science</span>
                  </span>
                  <span className="study-col">
                    <span className="mini">+ Business</span>
                    <span className="val">Ivey Business School</span>
                  </span>
                </span>
                <span className="sub">Western University / dual degree </span>
              </dd>
            </div>
          </dl>

          {/* REACH */}
          <dl className={`${cellClass("reach")} c-info`}>
            <div className="pad">
              <dt className="label">Reach</dt>
              <dd className="c-info-body">
                <span className="reach-primary">
                  <a
                    className="mail"
                    href="mailto:hello@danielrltan.com"
                    onClick={() => track("contact_email", { context: "about" })}
                  >
                    hello@<span className="accent">danielrltan</span>.com
                  </a>
                  <span className="hint">Replies &lt; 24h</span>
                </span>
                {/* Not buttons: a comms "switchboard" — each channel is a row an
                    orange bar wipes across on hover, with the handle + an
                    external mark. Ties into the site's channel-dial language. */}
                <ul
                  className="reach-channels"
                  aria-label="Find Daniel elsewhere"
                  onClick={(e) => {
                    const a = (e.target as HTMLElement).closest("a");
                    if (!a) return;
                    const name =
                      a
                        .querySelector(".ch-name")
                        ?.textContent?.trim()
                        .toLowerCase() ?? "link";
                    track("outbound_link", { url: name, context: "about" });
                  }}
                >
                  <li className="ch">
                    <a
                      href="https://github.com/danielrltan"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="ch-name">GitHub</span>
                      <span className="ch-handle">@danielrltan</span>
                      <span className="ch-go" aria-hidden="true">
                        &#8599;
                      </span>
                    </a>
                  </li>
                  <li className="ch">
                    <a
                      href="https://www.linkedin.com/in/danielrltan"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="ch-name">LinkedIn</span>
                      <span className="ch-handle">in/danielrltan</span>
                      <span className="ch-go" aria-hidden="true">
                        &#8599;
                      </span>
                    </a>
                  </li>
                  <li className="ch">
                    <a
                      href="https://x.com/danielrltan"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="ch-name">X</span>
                      <span className="ch-handle">@danielrltan</span>
                      <span className="ch-go" aria-hidden="true">
                        &#8599;
                      </span>
                    </a>
                  </li>
                  <li className="ch">
                    <a
                      href="https://www.pinterest.com/danrlt"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <span className="ch-name">Pinterest</span>
                      <span className="ch-handle">@danrlt</span>
                      <span className="ch-go" aria-hidden="true">
                        &#8599;
                      </span>
                    </a>
                  </li>
                </ul>
              </dd>
            </div>
          </dl>

          {/* LOCATION */}
          <dl className={`${cellClass("loc")} c-info`}>
            <div className="pad">
              <dt className="label">Location</dt>
              <dd className="c-info-body">
                <span className="big">Toronto</span>
                <span className="sub">Canada / EST</span>
                <span className="big loc-alt">London, ON</span>
                <span className="coord">43.01 N / 81.27 W</span>
              </dd>
            </div>
          </dl>

        </div>
      </div>
    </section>
  );
}
