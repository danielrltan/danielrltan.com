import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./sections.css";
import "./work-timeline.css";

gsap.registerPlugin(ScrollTrigger);

interface Stint {
  when: string;
  /** Display year shown on the ticker (4-digit string). */
  year: string;
  where: string;
  /** Shorter, all-caps brand line shown above the huge company headline. */
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
    // Sector tag, not the company name again: the headline already says
    // "Broadridge" at 132px, so the orange eyebrow earns its place as a
    // chapter label rather than a same-word repeat one line up.
    brand: "Fintech",
    role: "Software Engineer",
    current: true,
    // Just started: no specifics yet, by request. Keep the entry
    // honest + forward-looking rather than padding it with detail.
    pull: {
      // Caption intentionally empty: the bullet below already says this,
      // and the duplicate "just started, more to come" read as filler.
      metric: "Now",
      caption: "",
    },
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
    // Pull metric pulls from the TRIAGE bullet (bullet 3, 90s→20s) rather
    // than mirroring bullet[0]'s −50% figure, so the oversized hero number
    // carries an orthogonal insight instead of repeating the first line.
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
    // Pull metric pulls from the verification-automation bullet (33min→5sec,
    // bullet 2) rather than mirroring bullet[0]'s 600+ launch figure, so the
    // hero number reports a distinct win from the launch headline.
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

// 3 stints × ~0.9vh dwell each + entry/exit padding ≈ 3 viewports.
const PIN_DURATION_PX = 2600;

// Years for the ticker: 2 padding years either side of the
// earliest / latest stint year. Stints at 2026/2025/2025 yield a
// 6-row ticker [2023, 2024, 2025, 2026, 2027, 2028].
const STINT_YEARS = STINTS.map((s) => parseInt(s.year, 10));
const MIN_YEAR = Math.min(...STINT_YEARS) - 2;
const MAX_YEAR = Math.max(...STINT_YEARS) + 2;
const YEARS: number[] = Array.from(
  { length: MAX_YEAR - MIN_YEAR + 1 },
  (_, i) => MIN_YEAR + i,
);
// Index within YEARS for each stint's year.
const STINT_YEAR_INDICES = STINT_YEARS.map((y) => y - MIN_YEAR);

// (Removed HOLD: the mid-window glide is what desynced the ticker.
// See the active-year invariant below: the ticker now targets the
// active stint's year-index directly, with no early fractional climb.)

/**
 * Work: "The Ledger". Editorial vertical-pinned timeline.
 *
 * Signature device: a left-gutter VERTICAL SLIDING YEAR STACK.
 * A height-clipped frame is vertically centred in the gutter, with
 * a mask-image fade on top + bottom. Inside the frame a column of
 * year rows slides up / down on a single CSS var (--ticker-offset).
 * The active year is rendered in accent orange (the primary
 * indicator); a single small orange dot sits in the left gutter as
 * a quiet anchor, clear of the digits. The active year lands
 * geographically at the frame's vertical centre, beside the dot.
 *
 * Alignment math (load-bearing; do not regress):
 *   .work-ticker-stack {
 *     top: calc(50% - var(--row-h) / 2);
 *     transform: translateY(calc(var(--ticker-offset) * var(--row-h) * -1));
 *   }
 * Anchors row 0's centre at the frame midline, then slides up by
 * N row-heights for offset N. `top: 50% + translateY(-50%)` was
 * wrong because `-50%` is relative to the stack's intrinsic
 * height, which changes the moment row count or row-h changes.
 *
 * Active-year invariant (SHARED INDEX, load-bearing): the orange
 * year and the on-stage entry are driven by ONE index. The scroll
 * window picks the active stint `idx`; BOTH setActiveIndex(idx) and
 * the ticker target = STINT_YEAR_INDICES[idx] use that same idx.
 * The rAF lerp eases currentOffset toward that target for a smooth
 * slide (never binding CSS to raw scroll), but the SNAP TARGET is
 * always the active entry's exact year-index, so Math.round of the
 * settled offset lands on YEARS[STINT_YEAR_INDICES[idx]], i.e. the
 * active entry's year, at every scroll position. A previous HOLD
 * glide advanced the offset fractionally mid-window (target eased
 * idx→idx+1 from a continuous source), which flipped the orange year
 * BEFORE activeIndex crossed the window boundary; that was the
 * desync. Padding years (2024/2026/2028, no entry) are now only
 * ever PASSED THROUGH by the lerp during a stint change, never a
 * resting target.
 */
export function Work() {
  const sectionRef = useRef<HTMLElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const stintCounterRef = useRef<HTMLSpanElement>(null);
  const rowElsRef = useRef<HTMLDivElement[]>([]);
  // Continuous target & current offsets for the rAF lerp. Both are
  // year-INDEX values (not pixels): fractional during glides.
  const targetOffsetRef = useRef<number>(STINT_YEAR_INDICES[0] ?? 0);
  const currentOffsetRef = useRef<number>(STINT_YEAR_INDICES[0] ?? 0);
  const rafIdRef = useRef<number | null>(null);
  // Visibility + settle gate for the ticker rAF. When the section is
  // off-screen AND the lerp has settled, we stop rescheduling to avoid
  // burning a frame budget on invisible work.
  // OLD: loop runs unconditionally every frame forever.
  // NEW: O(0) rAF cost when settled + off-screen; loop restarts on visibility or target change.
  const isVisibleRef = useRef(false);
  const rafArmedRef = useRef(false);
  // Cross-effect ref: lets the ScrollTrigger onUpdate re-arm the rAF
  // loop when the target offset changes without coupling the two effects.
  const armLoopRef = useRef<(() => void) | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // Track whether the section has been pinned + started: drives the
  // first-paint reveal so the stage doesn't pop in before the user
  // arrives at the section.
  const [entered, setEntered] = useState(false);
  // Honour prefers-reduced-motion: when set we skip the pin/scrub +
  // ticker lerp entirely and let CSS stack every stint as a static,
  // fully legible list (no cross-fade, no sliding ticker). Read once
  // at mount; the value is stable for the page's lifetime.
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  // Mobile (< 900px): the editorial spread is laid out STATICALLY, the
  // same way reduced-motion stacks it: full-width single column, every
  // stint flowing top-to-bottom, all bullets fully readable. A phone in
  // portrait can't fit a giant headline + multi-line bullets + pull +
  // foot inside one ~100svh pinned viewport without clipping (the stage
  // is overflow:hidden), so on mobile we DROP the pin/scrub + ticker
  // lerp entirely and let the section grow to content height with native
  // scroll. The ticker is a wide-gutter motion device that's hidden
  // below 900px anyway; the dates survive in each stint's meta row.
  // Tracked with a resize listener so a desktop→narrow resize (and the
  // 768 breakpoint) cleanly switches modes. The 900px breakpoint EXACTLY
  // mirrors the CSS `@media (max-width: 900px)` ticker-hide / static-flow
  // cutoff so the two never disagree at the boundary (a mismatch would
  // leave the pin running while CSS un-absolutes the stage).
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 900px)").matches,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
      return;
    const mq = window.matchMedia("(max-width: 900px)");
    const onChange = () => setIsMobile(mq.matches);
    // addEventListener('change') is the modern API; both Safari < 14 and
    // older engines fall back to addListener. Guard for both.
    if (typeof mq.addEventListener === "function")
      mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => {
      if (typeof mq.removeEventListener === "function")
        mq.removeEventListener("change", onChange);
      else mq.removeListener(onChange);
    };
  }, []);

  // Both reduced-motion AND mobile use the static stacked layout: no pin,
  // no scrub, no ticker slide, every stint revealed and the résumé CTA
  // shown. The single derived flag keeps the pin / rAF / reveal gating
  // in one place so the two paths never diverge.
  const staticLayout = reducedMotion || isMobile;

  // Slice the pin's 0..1 progress into per-stint windows. Tiny entry
  // and exit buffers so the first stint isn't already mid-stage when
  // the pin engages and the last gets a beat before release.
  const ENTRY = 0.06;
  const EXIT = 0.06;
  const windows = useMemo(() => {
    const span = 1 - ENTRY - EXIT;
    const each = span / STINTS.length;
    return STINTS.map((_, i) => ({
      start: ENTRY + i * each,
      end: ENTRY + (i + 1) * each,
    }));
  }, []);

  // Per-frame ticker slide. currentOffsetRef lerps toward
  // targetOffsetRef. Each frame:
  //   1. Write --ticker-offset on the stack so CSS slides it.
  //   2. Compute distance from each row to the active offset and
  //      assign opacity bands so the ACTIVE orange year dominates
  //      and everything else is a faint suggestion of a continuum:
  //      active 1.0, ±1 ~0.18, ±2 ~0.04, beyond 0 (also killed by
  //      the frame's tightened mask fade). Decluttered from the
  //      previous active/0.32/0.14 ramp which left ±2 clearly
  //      readable and the stack looking like a list.
  useEffect(() => {
    // Under reduced-motion OR mobile the ticker is hidden (CSS) and the
    // stints are stacked statically: no per-frame slide needed. Bail so
    // we never spin a rAF loop whose output isn't rendered.
    if (staticLayout) return;

    // loop is declared with `let` before armLoop so armLoop's body can
    // reference it at call-time (not definition-time — no hoisting issue).
    let loop: () => void;

    // Arm/restart the loop. Called when the section becomes visible or
    // the target changes. Guards against double-scheduling via rafArmedRef.
    const armLoop = () => {
      if (rafArmedRef.current) return;
      rafArmedRef.current = true;
      rafIdRef.current = requestAnimationFrame(loop);
    };
    // Expose so the ScrollTrigger onUpdate (separate useEffect) can wake
    // the loop when targetOffsetRef changes while the loop is parked.
    armLoopRef.current = armLoop;

    loop = () => {
      rafArmedRef.current = false; // consumed; will re-arm if needed

      const cur = currentOffsetRef.current;
      const tgt = targetOffsetRef.current;
      const delta = tgt - cur;
      const settled = Math.abs(delta) < 0.0005;
      const next = settled ? tgt : cur + delta * 0.11;
      currentOffsetRef.current = next;

      const off = currentOffsetRef.current;
      const stack = stackRef.current;
      if (stack) {
        stack.style.setProperty("--ticker-offset", off.toFixed(4));
      }

      // The orange highlight + opacity bands are derived from the SAME
      // current lerped offset that positions the stack (above), so the
      // orange year is ALWAYS the row physically at the crosshair, at
      // every scroll position: they can never drift apart. The active
      // row is the one nearest the marker: round(offset). Using round
      // (rather than `d < 0.5`) guarantees EXACTLY one active row even
      // at the precise midpoint between two years (offset = N.5), where
      // a strict `< 0.5` test would briefly leave no row orange.
      const els = rowElsRef.current;
      const activeRow = Math.round(off);
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!el) continue;
        const d = Math.abs(i - off);
        const isActive = i === activeRow;
        if (isActive) el.classList.add("is-active");
        else el.classList.remove("is-active");
        let opacity: number;
        if (d < 0.5) {
          opacity = 1; // active band: orange year dominates
        } else if (d < 1.5) {
          // ±1: ghost hint. Ramps 0.18 (adjacent) → 0.05 (toward ±2)
          // so the neighbour is faintly legible but clearly recessive.
          opacity = 0.05 + (1.5 - d) * 0.13;
        } else if (d < 2.5) {
          // ±2: nearly gone. Ramps 0.04 → 0; the mask fade finishes
          // the job so these never read as a "2023 / 2027" list.
          opacity = (2.5 - d) * 0.04;
        } else {
          opacity = 0;
        }
        el.style.opacity = opacity.toFixed(3);
      }

      // Early-out: stop rescheduling when settled AND off-screen.
      // The loop is re-armed by the ScrollTrigger onToggle/onUpdate
      // (target change) and the IntersectionObserver (visibility regain).
      // OLD: unconditional reschedule every frame.
      // NEW: zero rAF cost when lerp has settled and section is not visible.
      if (settled && !isVisibleRef.current) {
        rafArmedRef.current = false;
        return; // do NOT reschedule
      }

      rafArmedRef.current = true;
      rafIdRef.current = requestAnimationFrame(loop);
    };

    // Re-arm when section enters viewport so the ticker wakes up.
    const visObs = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry!.isIntersecting;
        if (entry!.isIntersecting) armLoop();
      },
      { threshold: 0 },
    );
    const sectionEl = sectionRef.current;
    if (sectionEl) visObs.observe(sectionEl);

    isVisibleRef.current = false;
    armLoop(); // initial arm so the first frame paints correctly

    return () => {
      visObs.disconnect();
      armLoopRef.current = null;
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
      rafArmedRef.current = false;
    };
  }, [staticLayout]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    // Static layout (reduced-motion OR mobile): no pin, no scrub. CSS
    // lays every stint out as a static stack (all visible, all on-stage).
    // Mark entered so the .is-on-stage reveal classes resolve to visible
    // and the résumé CTA shows. The section reads top-to-bottom like a
    // résumé. On mobile this also means native momentum scroll through
    // the full work history with no clipped bullets.
    if (staticLayout) {
      setEntered(true);
      return;
    }

    const st = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: `+=${PIN_DURATION_PX}`,
      pin: true,
      pinSpacing: true,
      // Rate-limit: scrub:1 (~1s catch-up lerp) instead of scrub:true
      // (instant 1:1 with scroll) so the timeline reveal can't be flicked
      // past in one gesture.
      scrub: 1,
      anticipatePin: 1,
      onEnter: () => setEntered(true),
      onEnterBack: () => setEntered(true),
      onUpdate: (self) => {
        const p = self.progress;

        const bar = progressBarRef.current;
        if (bar) bar.style.transform = `scaleX(${p})`;

        // Handoff: keep the ledger fully opaque through the end of the
        // pin. The old "exit dissolve" faded it to 0 over the last 10%,
        // but Other's beat-A content doesn't fade in until ITS pin
        // engages ~900px (one viewport) later — so the cross-dissolve had
        // nothing to dissolve INTO and the seam read as ~1.3 viewports of
        // blank background. Holding the content lets Work physically
        // scroll up out of frame while Other slides in beneath it: a
        // normal, seamless vertical handoff with no empty gap.
        el.style.setProperty("--work-exit", "1");

        // Locate the active stint by which scroll window `p` falls in.
        // Pre-entry collapses to stint 0; past the last window stays on
        // the final stint. This single `idx` is the shared source of
        // truth for BOTH the on-stage entry and the ticker year.
        let idx = 0;
        for (let i = 0; i < windows.length; i++) {
          const w = windows[i]!;
          if (p < w.start) {
            idx = 0;
            break;
          }
          if (p >= w.start && p <= w.end) {
            idx = i;
            break;
          }
          if (i === windows.length - 1 && p > w.end) {
            idx = windows.length - 1;
          }
        }
        setActiveIndex(idx);

        // SHARED INDEX (load-bearing): the ticker targets the SAME `idx`
        // that drives the on-stage entry: its exact year-index, not a
        // continuous mid-window glide. So the snap target advances in
        // lockstep with activeIndex (both flip together at the window
        // boundary), and the rAF lerp below settles on exactly this
        // year: Math.round(offset) === STINT_YEAR_INDICES[idx]. The
        // orange year therefore always matches the entry at the
        // crosshair. The lerp still glides smoothly THROUGH any padding
        // years between two stints (e.g. 2025 → 2026 → 2027), but only
        // ever RESTS on a stint year. A prior HOLD glide fed the target
        // from a continuous within-window fraction, flipping the year
        // before activeIndex crossed the boundary; that was the desync.
        targetOffsetRef.current = STINT_YEAR_INDICES[idx] ?? 0;
        // Re-arm the rAF loop if it was parked (settled + off-screen).
        armLoopRef.current?.();

        const cnt = stintCounterRef.current;
        if (cnt) {
          cnt.textContent = `${String(idx + 1).padStart(2, "0")} / ${String(STINTS.length).padStart(2, "0")}`;
        }
      },
    });

    // Park the ticker on the first stint's year at mount.
    const startOff = STINT_YEAR_INDICES[0] ?? 0;
    targetOffsetRef.current = startOff;
    currentOffsetRef.current = startOff;

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
  }, [windows, staticLayout]);

  // Helper to register a year-row DOM element by its index in YEARS.
  const setRowEl = (i: number) => (el: HTMLDivElement | null) => {
    if (el) rowElsRef.current[i] = el;
  };

  return (
    <section
      ref={sectionRef}
      aria-label="Work experience timeline"
      className={`portfolio-section portfolio-work${entered ? " is-entered" : ""}${reducedMotion ? " is-reduced-motion" : ""}${staticLayout ? " is-static-layout" : ""}`}
    >
      <div className="work-ledger">
        <header className="work-ledger-head">
          <div className="work-ledger-head-left">
            <span className="work-ledger-num">03</span>
            <span className="work-ledger-index">03 / 06 · Work</span>
          </div>
          <div className="work-ledger-head-right">
            <span className="work-ledger-eyebrow" />
            <h2 className="work-ledger-title">Experience</h2>
          </div>
        </header>

        {/* Full résumé: pinned to the top-right of the whole ledger frame
            (absolute, so it's out of the grid flow) and always visible
            while the Work section is on screen — not gated to one stint. */}
        <a
          href="/resume/Daniel_Tan_Resume.pdf"
          target="_blank"
          rel="noreferrer"
          aria-label="Download Daniel Tan's full résumé (PDF, opens in a new tab)"
          className="work-resume is-revealed"
        >
          <span className="work-resume-label">Full résumé</span>
          <span className="work-resume-arrow" aria-hidden>↗</span>
        </a>

        <div className="work-ledger-body">
          <aside className="work-ticker" aria-hidden>
            {/* Year STACK ticker: height-clipped frame with a
                mask-image fade on top + bottom. Inside, an absolute
                column of year rows slides vertically via the
                --ticker-offset CSS var on the stack. The active
                year lands at the frame's vertical centre and is
                rendered in accent orange (the indicator); a single
                small orange dot anchors the left gutter. */}
            <div className="work-ticker-frame">
              <div className="work-ticker-stack" ref={stackRef}>
                {YEARS.map((y, i) => (
                  // Each row contains ONLY the year glyph. Decoration
                  // (the crosshair line + date-range caption) was
                  // removed: it cluttered / overlapped the digits.
                  //
                  // The `is-active` class + per-row opacity are owned
                  // EXCLUSIVELY by the rAF loop, which derives them from
                  // the CURRENT lerped --ticker-offset (the same value
                  // that positions the stack). The static className must
                  // NOT seed `is-active` here: React re-renders on every
                  // setActiveIndex during scroll, and a hardcoded
                  // `is-active` would let reconciliation overwrite the
                  // rAF's per-frame class back to a stale row (the first
                  // stint's year), desyncing the orange highlight from
                  // the year physically at the crosshair. Single source
                  // of truth = the lerped offset, written per frame.
                  <div
                    key={`yr-${y}`}
                    ref={setRowEl(i)}
                    className="work-ticker-row"
                  >
                    <span className="work-ticker-year">{y}</span>
                  </div>
                ))}
              </div>

              {/* Active-year marker: a SINGLE small orange dot in the
                  left gutter, sitting in clear horizontal clearance to
                  the LEFT of the year digits (never overlapping them).
                  The active year rendered in accent orange is the
                  primary indicator; the dot is a quiet anchor. The
                  crosshair LINE-through-the-digits and the date-range
                  caption were removed: the line cut straight through
                  the number and the caption duplicated the full date
                  range already shown in each stint's meta row. */}
              <div className="work-ticker-marker" aria-hidden>
                <span className="work-ticker-marker-dot" />
              </div>
            </div>
          </aside>

          <div className="work-stage">
            {/* Semantic source of truth: an ORDERED LIST of every stint,
                always present in the DOM and the accessibility tree
                regardless of which one the scroll has revealed. Screen
                readers + crawlers read all three (role, company, dates,
                bullets); the scroll pin only governs visual presentation.
                Previously each <article> was aria-hidden unless active,
                which hid two of three jobs from assistive tech. */}
            <ol className="work-stint-list">
              {STINTS.map((s, i) => (
                <WorkStintSpread
                  key={i}
                  stint={s}
                  index={i}
                  isActive={staticLayout || i === activeIndex}
                  isPast={!staticLayout && i < activeIndex}
                />
              ))}
            </ol>
          </div>
        </div>

        <div className="work-ledger-foot">
          <span className="work-ledger-counter">
            STINT ·{" "}
            <span ref={stintCounterRef}>
              01 / {String(STINTS.length).padStart(2, "0")}
            </span>
          </span>
          <div className="work-ledger-bar">
            <div ref={progressBarRef} className="work-ledger-bar-fill" />
          </div>
        </div>
      </div>
    </section>
  );
}

interface WorkStintSpreadProps {
  stint: Stint;
  index: number;
  isActive: boolean;
  isPast: boolean;
}

/**
 * One stint's editorial spread, rendered as a list item (the parent is
 * a semantic <ol>) layered absolutely inside .work-stage for pure
 * cross-fade + 24px-slide transitions. Bullet reveal is gated by the
 * .is-active class only: CSS-staggered so the per-tick path stays free
 * of React.
 *
 * a11y: the spread is ALWAYS in the accessibility tree (no aria-hidden
 * toggle). Non-active stints are merely visually offset (opacity 0 /
 * pointer-events none) but remain readable by screen readers and
 * indexable by crawlers: the section's full work history is never
 * gated behind scroll position.
 */
function WorkStintSpread({
  stint,
  isActive,
  isPast,
}: WorkStintSpreadProps) {
  const stage = isActive || isPast;
  return (
    <li
      className={`work-stint${isActive ? " is-active" : ""}${isPast ? " is-past" : ""}${stage ? " is-on-stage" : ""}`}
    >
      <div className="work-stint-brand">
        <span className="work-stint-brand-dot" aria-hidden />
        <span className="work-stint-brand-text">{stint.brand}</span>
        {stint.current && (
          <span className="work-stint-current">
            <span className="work-stint-current-dot" aria-hidden />
            Currently
          </span>
        )}
      </div>

      <h3 className="work-stint-headline">
        {stint.where}
      </h3>

      <div className="work-stint-meta">
        {stint.role && <span className="work-stint-role">{stint.role}</span>}
        {stint.location && (
          <>
            <span className="work-stint-sep" aria-hidden>
              •
            </span>
            <span className="work-stint-location">{stint.location}</span>
          </>
        )}
        <span className="work-stint-sep" aria-hidden>
          •
        </span>
        <span className="work-stint-when">{stint.when}</span>
      </div>

      <div className="work-stint-pull">
        <div className="work-stint-pull-metric">{stint.pull.metric}</div>
        {stint.pull.caption && (
          <p className="work-stint-pull-caption">{stint.pull.caption}</p>
        )}
      </div>

      <ul className="work-stint-bullets">
        {stint.bullets.map((b, j) => (
          <li
            key={j}
            className="work-stint-bullet"
            style={{ ["--bullet-i" as string]: j }}
          >
            <span className="work-stint-bullet-num">
              {String(j + 1).padStart(2, "0")}
            </span>
            <span className="work-stint-bullet-text">{b}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}
