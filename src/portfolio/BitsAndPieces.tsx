import { useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./sections.css";
import "./bits-and-pieces.css";
import { ScrambleText } from "./ScrambleText";
import { useReveal } from "./useReveal";
import { ease, matches, MQ, reducedMotion } from "../motion";
import { useMedia } from "../useMedia";
import { useSectionCanvasMount } from "../useSectionCanvasMount";
import { HonoursPodium, type PodiumBuild } from "./honours/HonoursPodium";
import { useIdleGate } from "./honours/useIdleGate";
import { refreshScrollOnLoaderLift, requestScrollRefresh } from "./scrollRefresh";
import { oneShot, seamBus, smooth, softHold, useSeam } from "../seams";

gsap.registerPlugin(ScrollTrigger);

/**
 * Bits and Pieces (Honours, "The trophy wall").
 *
 * Desktop (> MQ.narrow): the 3D podium + tower. It is SCROLL-BUILT (seam
 * play -> honours, owner brief 2026-10-06 "one workstation, one signal, never
 * stopping"): from the section top at 85% of the viewport to flush, the podium
 * extrudes, the cups pop and the slabs drop as a pure function of scroll, the
 * three stats count up while they are on screen (from their entry at the
 * viewport bottom to mid-dwell), and the honour card appears when the wall is
 * complete. Then a short soft dwell (--seam-bp-hold, 0.5vh) holds on the
 * finished wall: the section is 150svh with an inner sticky `.bp-hold`
 * (src/seams/stack.css), eased in and out by softHold. Scrolling up un-builds.
 *
 * Narrow (the stacked ledger / grid): the tiles reveal once in a cascade out
 * from the centre tile; the stats count up once (time-based) on their reveal.
 *
 * Header and stats use the shared `[data-reveal]` primitive (useReveal +
 * sections.css): a batch-staggered rise, latched once. Counts write
 * textContent directly, so the section never re-renders after mount.
 */

/** Count-up duration (ms): exempt "character" timing (spec §1.3). */
const COUNT_UP_MS = 1100;
/**
 * Ghost marquee travel as a fraction of the strip's width over the section's
 * full pass through the viewport (spec W5.6: 0.10, was 0.36). Tune here.
 */
const GHOST_TRAVEL = 0.1;
/*
 * Podium build and dwell. Owner, 2026-10-05: people scrolled straight past the
 * trophy wall, so it got a 0.8vh dwell pin to let a ~2 s time-based entrance
 * play in view. The seam overhaul (2026-10-06) builds the wall FROM the scroll
 * instead: the build spans the section top 85% -> 0 (0.85vh), so whoever
 * reaches the wall has watched it go up, at any speed, and only a 0.5vh soft
 * dwell (--seam-bp-hold, a CSS token; no JS duplicates it) is left to rest on
 * the finished wall. 0.85 + 0.5 vh in frame vs the old 0.67 + 0.8. (0.3vh was
 * the first cut; its short soft edges played as a stop-and-go hiccup at a
 * normal wheel, so it took the spec's gate G7 fallback.)
 */
/** Idle-mount cap for the podium (ms); see useIdleGate. */
const PODIUM_IDLE_MS = 1200;

type Category =
  | "Launch"
  | "Hackathon"
  | "Competition"
  | "Grant"
  | "Leadership"
  | "Scholarship";

interface Entry {
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
const ENTRIES: Entry[] = [
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
const TOTAL_GRANTS_USD = 16500;
const TOTAL_WINS = ENTRIES.filter(
  (e) => e.category === "Hackathon" || e.category === "Competition",
).length;
const TOTAL_LEADERSHIP = ENTRIES.filter((e) => e.category === "Leadership").length;

function formatMoney(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${n}`;
}

type CountFormat = "money" | "int";
const FORMATS: Record<CountFormat, (n: number) => string> = {
  money: formatMoney,
  int: (n) => `${n}`,
};

/**
 * Per-card tile. The reveal class is written imperatively by useReveal on the
 * [data-reveal] node, so the className here must stay reveal-free (a re-render
 * would otherwise drop `.is-revealed`).
 */
function BpTile({ entry }: { entry: Entry }) {
  // Single accessible label per card so a screen reader announces the
  // whole accomplishment as one unit ("Hackathon. Hack The 6ix.
  // Finalist, Top finalist · 400+.") rather than four disconnected
  // fragments. Visual sub-elements are aria-hidden below.
  const label = [
    entry.category,
    entry.title,
    entry.metric,
    entry.context,
    entry.blurb,
  ]
    .filter(Boolean)
    .join(". ");

  return (
    <li
      data-reveal=""
      className={[
        "bp-tile",
        `bp-tile--${entry.category.toLowerCase()}`,
        entry.featured ? "bp-tile--featured" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <article className="bp-tile-inner" aria-label={label}>
        <span className="bp-tile-cat" aria-hidden>
          {entry.category}
        </span>
        <h3 className="bp-tile-title" aria-hidden>
          {entry.title}
        </h3>
        {entry.metric && (
          <span className="bp-tile-metric" aria-hidden>
            {entry.metric}
          </span>
        )}
        {entry.context && (
          <span className="bp-tile-context" aria-hidden>
            {entry.context}
          </span>
        )}
        {entry.blurb && (
          <p className="bp-tile-blurb" aria-hidden>
            {entry.blurb}
          </p>
        )}
      </article>
    </li>
  );
}

/**
 * Count-up digits. Rendered once at 0 (final value under reduced motion);
 * narrow: runCountUps() animates the text node when the stats reveal;
 * desktop: the play -> honours seam writes it from the build's progress. The animating
 * digits are aria-hidden: a live count-up would spam the SR with intermediate
 * numbers. The static final value is exposed via aria-label on the stat.
 */
function CountUp({ to, format = "int" }: { to: number; format?: CountFormat }) {
  const initial = reducedMotion.value ? to : 0;
  return (
    <span aria-hidden data-count-to={to} data-count-format={format}>
      {FORMATS[format](initial)}
    </span>
  );
}

/** Animate every [data-count-to] under `root` from 0 (time-based, ease-out
 *  cubic), writing textContent only when the formatted string changes. */
function runCountUps(root: Element): () => void {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-count-to]")).map(
    (el) => ({
      el,
      to: Number(el.dataset.countTo) || 0,
      fmt: FORMATS[el.dataset.countFormat as CountFormat] ?? FORMATS.int,
      last: el.textContent ?? "",
    }),
  );
  const write = (t: number) => {
    for (const n of nodes) {
      const text = n.fmt(Math.round(n.to * t));
      if (text !== n.last) {
        n.last = text;
        n.el.textContent = text;
      }
    }
  };
  if (reducedMotion.value) {
    write(1);
    return () => {};
  }
  let raf = 0;
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - start) / COUNT_UP_MS));
    write(ease.outCubic(t));
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** Write every [data-count-to] under `root` at fraction t of its final value. */
function writeCounts(root: Element | null, t: number): void {
  if (!root) return;
  for (const el of root.querySelectorAll<HTMLElement>("[data-count-to]")) {
    const to = Number(el.dataset.countTo) || 0;
    const fmt = FORMATS[el.dataset.countFormat as CountFormat] ?? FORMATS.int;
    const text = fmt(Math.round(to * t));
    if (el.textContent !== text) el.textContent = text;
  }
}

/**
 * Narrow tiles: rank each tile by its distance from the centre tile (the one
 * nearest the middle of the grid's box), in layout px so it holds for the
 * one-column ledger on phones and the three-up grid at 769-900 alike. Written
 * as --reveal-order (bits-and-pieces.css turns it into the reveal delay).
 */
function rankTilesFromCentre(tiles: HTMLElement[]): void {
  const c = tiles.map((t) => ({ t, x: t.offsetLeft + t.offsetWidth / 2, y: t.offsetTop + t.offsetHeight / 2 }));
  if (!c.length) return;
  const xs = c.map((k) => k.x);
  const ys = c.map((k) => k.y);
  const mx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const my = (Math.min(...ys) + Math.max(...ys)) / 2;
  const centre = c.reduce((a, b) => (Math.hypot(b.x - mx, b.y - my) < Math.hypot(a.x - mx, a.y - my) ? b : a));
  c.map((k, i) => ({ k, i, d: Math.hypot(k.x - centre.x, k.y - centre.y) }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .forEach(({ k }, rank) => k.t.style.setProperty("--reveal-order", String(rank)));
}

export function BitsAndPieces() {
  const sectionRef = useRef<HTMLElement>(null);
  const holdRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  // Desktop: the 3D podium + tower (owner pick from the trophy lab). Narrow
  // (<=900, or a phone on its side): the card grid, whose text stays readable
  // where the 3D labels would be a few px tall.
  const narrow = useMedia(MQ.narrow);
  const narrowRef = useRef(narrow);
  narrowRef.current = narrow;
  // The WebGL context only exists near the section (useSectionCanvasMount),
  // and is stood up in an idle period, not inside the loader lift or a scroll
  // frame; the scroll build applies its stored progress whenever it lands.
  const podiumActive = useIdleGate(useSectionCanvasMount(sectionRef), PODIUM_IDLE_MS);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const stopCountRef = useRef<() => void>(() => {});
  // The scroll build's state, shared with the podium (HonoursPodium).
  const [build] = useState<PodiumBuild>(() => ({ p: 0, scene: null }));

  // Shared reveal primitive over the header and stats. Narrow only: the
  // stats' reveal starts the one-shot count-up (desktop counts from scroll,
  // below). The tiles are left out: they cascade from the centre (below).
  const onReveal = useCallback((el: Element) => {
    if (narrowRef.current && el.classList.contains("bp-stats")) {
      stopCountRef.current();
      stopCountRef.current = runCountUps(el);
    }
  }, []);
  // Podium layout: the stats sit 34px off the bottom of a 100svh stage, below
  // the default -15% reveal line, so reveal against the whole viewport there.
  useReveal(sectionRef, {
    onReveal,
    rootMargin: narrow ? undefined : "0px",
    selector: "[data-reveal]:not(.bp-tile)",
  });
  useEffect(() => () => stopCountRef.current(), []);

  // SEAM play -> honours (spec §5.5, Honours side): the podium builds with
  // the section's arrival, top 85% -> flush. render(p) is pure: the build
  // progress, the debug bus, and the stats at round(final * smooth(seg(p))).
  // The card latch (p >= 0.98 on, < 0.90 off) lives in the scene. Narrow has
  // no podium: the no-op fallback keeps the gate-off path from writing final
  // stats ahead of the narrow one-shot count-up. Reduced motion: final(), the
  // finished wall and the final stats.
  const setBuild = (p: number) => {
    build.p = p;
    build.scene?.setProgress(p);
    seamBus.podiumP = p;
  };
  useSeam(
    narrow
      ? null
      : {
          id: "play-honours",
          trigger: () => sectionRef.current,
          start: "top 85%",
          end: "top top",
          render: (p) => setBuild(p),
          final: () => setBuild(1),
          fallback: () => () => {},
        },
    [narrow],
  );

  // The stats count while the reader can SEE them. They sit at the bottom of
  // the 100svh stage, below the fold for most of the build, so a count tied
  // to the build p (0.2 -> 0.95) had all but finished before they surfaced:
  // the reader saw only the last ~3%. This range runs from the stats' top
  // crossing the viewport bottom to the middle of the dwell. Still a pure
  // function of scroll (reverses, lands right after a cut jump). Offsets are
  // read inside .bp-hold (stats vs hold), so the sticky's own position and
  // softHold's translate cancel out.
  useSeam(
    narrow
      ? null
      : {
          id: "play-honours-count",
          trigger: () => sectionRef.current,
          start: () => {
            const el = sectionRef.current;
            const hold = holdRef.current;
            const stats = el?.querySelector(".bp-stats");
            if (!el || !hold || !stats) return 0;
            const secTop = el.getBoundingClientRect().top + window.scrollY;
            const off = stats.getBoundingClientRect().top - hold.getBoundingClientRect().top;
            return secTop + off - window.innerHeight;
          },
          end: (st) => {
            const el = sectionRef.current;
            if (!el) return st.start + 1;
            const secTop = el.getBoundingClientRect().top + window.scrollY;
            const holdLen = Math.max(0, el.offsetHeight - window.innerHeight);
            return Math.max(st.start + 1, secTop + 0.5 * holdLen);
          },
          render: (p) => writeCounts(sectionRef.current, smooth(p)),
          final: () => writeCounts(sectionRef.current, 1),
          fallback: () => () => {},
        },
    [narrow],
  );

  // Ghost marquee (narrow only: the podium layout hides the strip): slides
  // the giant category strip sideways with the section's pass through the
  // viewport. Driven by ScrollTrigger (the site's single scroll clock, already
  // Lenis-smoothed: no scrub, no second smoother) through a gsap.quickSetter;
  // no window scroll listener, no per-frame layout reads. The strip width is
  // cached on every ScrollTrigger refresh. Rounded to device pixels, not to a
  // coarse grid (the old 12px quantisation juddered in Lenis's deceleration
  // tail). Skipped (strip stays at rest) under reduced motion, on coarse
  // pointers, and on compact screens, where the strip is trimmed/hidden in CSS.
  useEffect(() => {
    const el = sectionRef.current;
    const strip = marqueeRef.current;
    if (!narrow || !el || !strip) return;
    const coarsePointer =
      window.matchMedia?.("(hover: none), (pointer: coarse)").matches ?? false;
    // Compact = a phone, upright or on its side (shared query; CSS trims the
    // strip on the same query).
    if (reducedMotion.value || coarsePointer || matches(MQ.compact)) return;

    const setX = gsap.quickSetter(strip, "x", "px") as (v: number) => void;
    let stripW = strip.scrollWidth;
    let lastX = NaN;
    const apply = (progress: number) => {
      const dpr = window.devicePixelRatio || 1;
      const x = Math.round(-progress * GHOST_TRAVEL * stripW * dpr) / dpr;
      if (x !== lastX) {
        lastX = x;
        setX(x);
      }
    };
    const st = ScrollTrigger.create({
      trigger: el,
      start: "top bottom",
      end: "bottom top",
      onRefresh: (self) => {
        stripW = strip.scrollWidth;
        apply(self.progress);
      },
      onUpdate: (self) => apply(self.progress),
    });
    apply(st.progress);
    return () => {
      st.kill();
      gsap.set(strip, { clearProps: "transform" });
    };
  }, [narrow]);

  // Podium layout only: the soft dwell on the finished wall. The section is
  // 100svh + --seam-bp-hold and `.bp-hold` sticks inside it (stack.css, keyed
  // on this section's data-seam-stack flag); softHold eases the engage and the
  // release (C1, no snap) and keeps the 'bp-pin' id as a NON-pinning hold
  // trigger for the registry jump. Narrow keeps the stacked grid in plain
  // flow (no holds on phones).
  useEffect(() => {
    const el = sectionRef.current;
    const stage = holdRef.current;
    if (narrow) {
      // A desktop -> narrow flip drops the hold (the section shrinks back to
      // its content); refresh so the sections below re-measure.
      if (!document.documentElement.classList.contains("loading-active")) {
        requestScrollRefresh();
      }
      return;
    }
    if (!el || !stage) return;
    const hold = softHold({ id: "bp-pin", section: el, stage });
    const stopLoaderWatch = refreshScrollOnLoaderLift();
    return () => {
      stopLoaderWatch();
      hold.kill();
    };
  }, [narrow]);

  // Narrow tiles: ONE reveal for the whole grid, cascading out from the
  // centre tile by distance rank (spec §5.5 phone variant), latched once like
  // every reveal on the site. Time-based and threshold-armed (oneShot), never
  // a scroll-linked write. A mount or a cut jump below the line lands revealed
  // with no animation. Reduced motion: revealed at mount (the root is never
  // armed, so they render in place anyway).
  useEffect(() => {
    const grid = gridRef.current;
    if (!narrow || !grid) return;
    const tiles = () => Array.from(grid.querySelectorAll<HTMLElement>(".bp-tile"));
    const reveal = (animate: boolean) => {
      const all = tiles();
      rankTilesFromCentre(all);
      if (animate) {
        all.forEach((t) => t.classList.add("is-revealed"));
        return;
      }
      all.forEach((t) => {
        t.style.transition = "none";
        t.classList.add("is-revealed");
      });
      void grid.offsetHeight; // commit the end state before the transition returns
      all.forEach((t) => (t.style.transition = ""));
    };
    if (reducedMotion.value) {
      reveal(false);
      return;
    }
    return oneShot({
      el: grid,
      line: 0.75,
      play: (dir) => {
        if (dir === 1) reveal(true);
      },
      snap: (dir) => {
        if (dir === 1) reveal(false);
      },
    });
  }, [narrow]);

  const layout = (
    <div className="bp-layout">
      <header className="bp-head" data-reveal="">
        {narrow ? (
          <>
            <span className="section-marker bp-marker">05</span>
          </>
        ) : (
          // Podium layout: just the 05 (owner removed the orange dash
          // after it, and the "05 / 07 · Honours" text before that).
          <div className="bp-idx">
            <span className="bp-idx-n">05</span>
          </div>
        )}
        <h2 className="bp-title">
          <ScrambleText text="The trophy wall" />
        </h2>
        {narrow && <p className="bp-blurb">Awards and leadership.</p>}
      </header>

      {/* Summary metrics as a definition list: the animated digits
          are aria-hidden (see CountUp), so each stat carries a static
          aria-label with the final value for assistive tech. */}
      <dl className="bp-stats" data-reveal="">
        <div
          className="bp-stat"
          aria-label={`${formatMoney(TOTAL_GRANTS_USD)} in awards and funding`}
        >
          <dd className="bp-stat-num">
            <CountUp to={TOTAL_GRANTS_USD} format="money" />
          </dd>
          <dt className="bp-stat-label">in awards &amp; funding</dt>
        </div>
        <div className="bp-stat-rule" aria-hidden />
        <div
          className="bp-stat"
          aria-label={`${TOTAL_WINS} competition placements`}
        >
          <dd className="bp-stat-num">
            <CountUp to={TOTAL_WINS} />
          </dd>
          <dt className="bp-stat-label">competition placements</dt>
        </div>
        <div className="bp-stat-rule" aria-hidden />
        <div
          className="bp-stat"
          aria-label={`${TOTAL_LEADERSHIP} leadership roles`}
        >
          <dd className="bp-stat-num">
            <CountUp to={TOTAL_LEADERSHIP} />
          </dd>
          <dt className="bp-stat-label">leadership roles</dt>
        </div>
      </dl>

      {narrow ? (
        <ul ref={gridRef} className="bp-grid" aria-label="Awards, grants, scholarships and leadership roles">
          {ENTRIES.map((e, i) => (
            <BpTile key={i} entry={e} />
          ))}
        </ul>
      ) : (
        <>
          <HonoursPodium entries={ENTRIES} active={podiumActive} build={build} />
          {/* The whole list, as text, for screen readers and crawlers (the
              podium's labels live in canvas textures). */}
          <ul className="sr-only" aria-label="Awards, grants, scholarships and leadership roles">
            {ENTRIES.map((e, i) => (
              <li key={i}>
                {[e.category, e.title, e.metric, e.context, e.blurb].filter(Boolean).join(". ")}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  return (
    <section
      ref={sectionRef}
      className={`portfolio-section portfolio-bp${narrow ? "" : " is-podium"}`}
      // Seam layout contract flag (src/seams/stack.css): this section's hold
      // internals are in place. stack.css applies it on desktop with motion
      // only, so narrow and reduced motion stay plain flow.
      data-seam-stack=""
      // A menu/footer jump lands at the hold START, where the build has just
      // completed (p = 1): the reader arrives on the finished wall with its
      // card, from above or below.
      data-jump-progress={narrow ? undefined : "0"}
    >
      <div className="bp-marquee" aria-hidden>
        <div ref={marqueeRef} className="bp-marquee-strip">
          {Array.from({ length: 3 }).map((_, k) => (
            <span key={k}>
              LAUNCH / HACKATHON / COMPETITION / GRANT / LEADERSHIP /
              SCHOLARSHIP /{" "}
            </span>
          ))}
        </div>
      </div>

      {narrow ? (
        layout
      ) : (
        // The sticky stage of the dwell (stack.css); everything the podium
        // layout shows (head, canvas, stats, card) rides in it.
        <div ref={holdRef} className="bp-hold">
          {layout}
        </div>
      )}
    </section>
  );
}
