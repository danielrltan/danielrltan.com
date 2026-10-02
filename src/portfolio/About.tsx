import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { requestScrollRefresh, refreshScrollOnLoaderLift } from "./scrollRefresh";
import "./sections.css";
import "./about.css";
import { ScrambleText } from "./ScrambleText";
import { track } from "../analytics";
import { MQ, reducedMotion as reducedMotionPref } from "../motion";
import { useMedia } from "../useMedia";
import { heroHandoff } from "../hero/heroState";
import { useReveal } from "./useReveal";

gsap.registerPlugin(ScrollTrigger);

/**
 * About: GSAP-pinned BENTO DASHBOARD reveal.
 *
 * The section is an opaque light-grey bento grid that "boots up" panel by
 * panel. The isometric room render (/render.webp) is the feature centerpiece;
 * two info cards sit BEHIND it (the room's transparent margins let them peek
 * through, the room silhouette occludes the rest).
 *
 * ARRIVAL TRIO (banner, name card, room render): revealed while About is still
 * parked under the opaque, settled hero (heroHandoff.armed, set by the hero
 * wipe controller; the `about-arrive` trigger is the fallback), so the hero's
 * pixel iris opens onto a populated room and its first frames carry no React
 * commit and no image first paint. The banner's "ABOUT" decode is cued
 * separately (heroHandoff.cue: iris about a third open / hero fade start) so it
 * plays where it can be seen.
 *
 * DESKTOP pin (1.25vh, viewport-relative) progress beats, the rest of the
 * boot-up (BEATS below):
 *   0.08 portrait   0.16 "Currently"   0.24 "Exploring"
 *   0.34 "Studying" 0.42 "Reach"       0.50 "Location"
 *   0.50 -> 1.0 hold (the finished dashboard)
 * Reveals are imperative class toggles (zero React renders per scroll frame)
 * and LATCH: coming back up from the Mac shows the finished dashboard, never
 * a blank sheet. Cells crossed in one update stagger by --reveal-order.
 *
 * NARROW (MQ.narrow: ≤900px, or a phone on its side) SKIPS the pin entirely
 * (mirrors Work): a pinned, internally-scrolling stage was a nested
 * scroll-trap inside the page pin. The bento collapses to a compact column
 * that flows + scrolls with the page; each cell rises in once as it enters
 * (useReveal, 400ms / 12px), and the room render is neither rendered nor
 * decoded (about.css hides it there anyway).
 *
 * prefers-reduced-motion: every cell is force-revealed (no transforms), so
 * the dashboard is fully readable without the choreography. The scroll-pin
 * itself still works (structural, not decorative).
 */

/** Pin length in viewports (spec §3: 1.25vh). */
const PIN_VH = 1.25;

/** The boot-up beats (pin progress), in reveal order. */
const BEATS: ReadonlyArray<readonly [key: string, at: number]> = [
  ["portrait", 0.08],
  ["now", 0.16],
  ["explore", 0.24],
  ["study", 0.34],
  ["reach", 0.42],
  ["loc", 0.5],
];

/** Arrival trio selectors, in reveal (stagger) order. */
const ARRIVAL = [".about-banner", ".card.c-name", ".card.c-render"];

/** Latch one element revealed, staggered by `order` (--reveal-order). */
function reveal(el: Element | null | undefined, order: number) {
  if (!el || el.classList.contains("is-revealed")) return;
  (el as HTMLElement).style.setProperty("--reveal-order", String(order));
  el.classList.add("is-revealed");
}

/** Cells the narrow layout reveals on enter (the room render is not rendered there). */
const NARROW_REVEAL = ".about-banner, .about-grid > .card";

export function About() {
  const sectionRef = useRef<HTMLElement>(null);
  const roomRef = useRef<HTMLImageElement>(null);
  const [reducedMotion, setReducedMotion] = useState(() => reducedMotionPref.value);
  /* Mirror the CSS bento breakpoint (MQ.narrow collapses the bento) so the
     reveal schedule matches the layout the user actually sees. Live (follows
     resize / rotation) and initialised synchronously, so there is no
     desktop→mobile flash on first paint and no room-render request on a
     phone. */
  const mobile = useMedia(MQ.narrow);
  /* The ONLY React state left in the reveal: the header decode cue. */
  const cue = useSyncExternalStore(
    heroHandoff.subscribe,
    () => heroHandoff.cue,
    () => false,
  );

  useEffect(() => reducedMotionPref.subscribe(setReducedMotion), []);

  /* Warm the room render's decode so its first paint (under the parked,
     covered stage) never lands on a scroll frame. Desktop only: the narrow
     layout never renders the room. */
  useEffect(() => {
    if (mobile) return;
    roomRef.current?.decode?.().catch(() => {});
  }, [mobile]);

  /* Narrow: each cell rises in once as it scrolls into view (shared reveal
     primitive; about.css owns the hidden pose + transition). Reduced motion
     is handled below (force-reveal). */
  useReveal(sectionRef, {
    selector: NARROW_REVEAL,
    enabled: mobile && !reducedMotion,
  });

  /* Arrival trio: reveal once the hero wipe controller arms it (the hero is
     settled and opaque above), or on the about-arrive fallback trigger. */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const revealArrival = () =>
      ARRIVAL.forEach((sel, i) => reveal(el.querySelector(sel), i));
    if (heroHandoff.armed) revealArrival();
    const unsub = heroHandoff.subscribe(() => {
      if (heroHandoff.armed) revealArrival();
    });
    const arrive = ScrollTrigger.create({
      id: "about-arrive",
      trigger: el,
      start: "top 92%",
      // Active from the arrival point to the page end, so a load at or below
      // it fires onEnter on the first refresh (reveal immediately).
      end: "max",
      onEnter: () => heroHandoff.set("armed"),
    });
    return () => {
      unsub();
      arrive.kill();
    };
  }, []);

  /* Reduced motion: force-reveal every cell up front (no stagger). */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || !reducedMotion) return;
    el.querySelectorAll(".about-banner, .card").forEach((c) => reveal(c, 0));
  }, [mobile, reducedMotion]);

  /* Room bob runs only while the section is on screen (about.css pauses it
     otherwise). */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => {
      el.classList.toggle("is-onscreen", !!entry?.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    // NARROW: skip the GSAP pin entirely (mirrors Work). The pinned bento on
    // a phone created a nested scroll-trap — a full-height internally-
    // scrolling stage captured inside the page pin (rubber-band). On narrow
    // the bento is a plain stacked column that scrolls with the page; the
    // cells rise in on enter (useReveal above).
    if (mobile) {
      // A breakpoint flip from desktop→mobile kills the old pin; refresh so
      // every pin BELOW (Work, Other, Keypad) recomputes its start now that
      // this section no longer contributes a pin spacer.
      const html = document.documentElement;
      if (!html.classList.contains("loading-active")) {
        requestScrollRefresh();
      }
      return;
    }

    // Boot-up cells in beat order; `stage` = how many beats are revealed.
    const cells = BEATS.map(([key]) => el.querySelector(`.card.c-${key}`));
    let stage = 0;
    const apply = (progress: number) => {
      let next = stage;
      // +1e-3: a jump to data-jump-progress 0.5 lands on the last beat
      // exactly; float error must not leave "Location" unrevealed.
      while (next < BEATS.length && progress + 1e-3 >= BEATS[next]![1]) next++;
      if (next <= stage) return; // latched: never un-reveal
      for (let i = stage; i < next; i++) reveal(cells[i], i - stage);
      stage = next;
    };

    const st = ScrollTrigger.create({
      id: "about-pin",
      trigger: el,
      start: "top top",
      // Viewport-relative (spec §3), recomputed on every refresh.
      end: () => "+=" + Math.round(window.innerHeight * PIN_VH),
      invalidateOnRefresh: true,
      pin: true,
      pinSpacing: true,
      // No numeric scrub (it was inert: no animation is attached) and no
      // anticipatePin: Lenis drives ScrollTrigger.update in the same frame it
      // scrolls, and the stage is parked under the hero right up to this
      // pin's start (about.css), so an EARLY pin would shift the parked stage
      // for a few frames.
      onUpdate: (self) => apply(self.progress),
      onRefresh: (self) => apply(self.progress),
    });
    // Refresh after THIS pin is (re)created — not only after the loading
    // scrim clears. When the breakpoint flips mid-session (rotation), the
    // pin is killed and recreated with a different duration, which changes
    // this section's spacer height and therefore the START position of
    // every pin below it (Work, Other, Keypad). Without a refresh those
    // pins keep stale positions until some other refresh happens to fire.
    const stopLoaderWatch = refreshScrollOnLoaderLift();
    return () => {
      stopLoaderWatch();
      st.kill();
    };
    // Re-create (or skip) the pin when the breakpoint flips so the layout
    // matches (mirrors the Work/Keypad pattern).
  }, [mobile]);

  return (
    <section
      ref={sectionRef}
      className="portfolio-section portfolio-about"
      data-jump-progress="0.5"
    >
      <div className="about-stage">
        {/* TOP CHROME: wayfinding crumb + status. The big "ABOUT" wordmark
            is aria-hidden chrome; the real <h2> below carries the heading
            for assistive tech / SEO. */}
        <header className="about-banner" aria-hidden="true">
          <div className="about-banner-meta">
            <span className="about-crumb-idx">01</span>
            {/* Desktop crumb: "01 —— danielrltan.com". Narrow keeps only the
                number tag (the site-wide mobile index rule, sections.css). */}
            <span className="about-crumb-rule" />
            <span className="about-banner-domain">danielrltan.com</span>
          </div>
          <p className="about-banner-title">
            <ScrambleText text="About" play={cue} />
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
          <div className="card c-name">
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
          {!mobile && (
            <div className="card c-render">
              <div className="render-frame">
                <img ref={roomRef} className="about-room" src="/render.webp" alt="" />
              </div>
            </div>
          )}

          {/* PORTRAIT */}
          <div className="card c-portrait">
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
          <dl className="card c-now c-info behind">
            <div className="pad">
              <dt className="label">Currently</dt>
              <dd className="c-info-body">
                <span className="big">
                  HBA
                  <br />
                  Candidate
                </span>
                <span className="pill">
                  @{" "}
                  <a
                    href="https://www.ivey.uwo.ca/hba/"
                    target="_blank"
                    rel="noreferrer"
                    onClick={() =>
                      track("outbound_link", {
                        url: "ivey",
                        context: "about",
                      })
                    }
                  >
                    Ivey Business School
                  </a>
                </span>
              </dd>
            </div>
          </dl>

          {/* EXPLORING — behind, peeks under the render's RIGHT margin. */}
          <dl className="card c-explore c-info behind">
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
          <dl className="card c-study c-info">
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
          <dl className="card c-reach c-info">
            <div className="pad">
              <dt className="label">Reach</dt>
              <dd className="c-info-body">
                <span className="reach-primary">
                  <a
                    className="mail"
                    href="mailto:hello@danielrltan.com"
                    onClick={() => track("contact_email", { context: "about" })}
                  >
                    {/* <wbr>: the only places a narrow card may wrap the
                        address (after the @, before the .com). */}
                    hello@<wbr />
                    <span className="accent">danielrltan</span>
                    <wbr />.com
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
          <dl className="card c-loc c-info">
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
