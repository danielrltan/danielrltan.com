import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { refreshScrollOnLoaderLift, requestScrollRefresh } from "./scrollRefresh";
import "./sections.css";
import "./work-timeline.css";
import { ScrambleText } from "./ScrambleText";
import { getLenis, scrollToY } from "../scroll";
import {
  BREAKPOINT,
  SCROLL,
  presetDuration,
  reducedMotion as reducedMotionPref,
} from "../motion";
import { track } from "../analytics";

gsap.registerPlugin(ScrollTrigger);

// ── Tunables (motion spec W3) ───────────────────────────────────────────────
/** Desktop pin length per role, in viewport heights (3 roles = 1.86vh). */
const PIN_VH_PER_ROW = 0.62;
/**
 * Band hysteresis, in pin progress. Band k opens only once progress is this
 * far past its boundary, so resting near a boundary never flickers rows.
 */
const BAND_HYSTERESIS = 0.04;
/** Pin progress a menu/footer jump lands on: the centre of row 0's band. */
const JUMP_PROGRESS = 0.17;
/** Click-jump guard: slack past the glide duration before it force-clears. */
const JUMP_GUARD_SLACK_S = 0.25;
/**
 * Click-jump takeover (owner-tunable). The glide is locked against the wheel;
 * only a DELIBERATE scroll takes over. Wheel input this soon after the click is
 * always the click's own tail (trackpad inertia, the end of a flick).
 */
const JUMP_GRACE_MS = 150;
/** After the grace, a wheel delta smaller than this (px) is inertia, not a takeover. */
const JUMP_TAKEOVER_MIN_DELTA = 8;
/**
 * A same-direction wheel event this soon after the previous one, and no larger
 * than it, continues a decaying inertia run (macOS momentum), not a takeover.
 * Momentum events arrive every ~16 ms, but a busy main thread (the morph and
 * the glide run together) delivers them 40-130 ms apart, so the window is
 * generous: a new deliberate swipe is caught by its GROWING deltas, or by the
 * pause before it, or by a change of direction.
 */
const INERTIA_RUN_GAP_MS = 150;
/**
 * Lenis 1.3 keeps reset() and the isLocked setter private in its typings, but
 * both are stable runtime API (reset() is what its own start()/stop() and
 * lock:true tweens use). Narrow access for the click-jump lock only.
 */
type LenisLockControl = { isLocked: boolean; reset(): void };
const lockControl = (l: object | null) => l as unknown as LenisLockControl | null;
/** Keys that scroll the page natively; pressing one during a glide takes over. */
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

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
      "Built an AI-assisted COBOL modernization proof of concept: turned legacy tax-slip status logic into 12 structured YAML rules and a generated Java 21 / Spring Boot service, verified end-to-end against development DB2.",
      "Adapted the existing batch DAO contract into a REST path with dynamic T4A/R1 routing, optimistic concurrency, and per-slip results, so the live application called the new service with no redesign.",
      "Designed a reusable family of extraction and code-generation agents plus an alternate iBatis realization, showing the rules were stack-independent. Integration tests green: 2 run, 0 failures.",
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

const N = STINTS.length;

/** Plain band for pin progress p (no hysteresis). */
const plainBand = (p: number) => Math.min(N - 1, Math.max(0, Math.floor(p * N)));

/**
 * Band index with hysteresis, starting from the last open band. Moving DOWN to
 * band k needs p > k/N + H; moving UP to band k needs p < (k+1)/N - H. Loops, so
 * a fast scroll or a cut that crosses several bands lands in one step.
 */
function bandWithHysteresis(p: number, last: number): number {
  let k = Math.min(N - 1, Math.max(0, last));
  while (k < N - 1 && p > (k + 1) / N + BAND_HYSTERESIS) k++;
  while (k > 0 && p < k / N - BAND_HYSTERESIS) k--;
  return k;
}

/** Spine geometry, all in px relative to the .work-acc list's top edge. */
interface SpineGeo {
  /** Centre of each role's node dot (the dot sits at 50% of .work-acc-node). */
  nodes: number[];
  spineTop: number;
  spineLen: number;
}

/**
 * Read the spine geometry. Only ever called from the ResizeObserver callback,
 * which runs after layout and before paint, so every read here is free (no
 * forced layout) and matches the frame about to be painted.
 */
function measureSpine(list: HTMLElement): SpineGeo {
  const nodes: number[] = [];
  for (const li of Array.from(list.children) as HTMLElement[]) {
    const node = li.querySelector<HTMLElement>(".work-acc-node");
    if (!node) continue;
    // li and .work-acc-node are both position:relative, so each offsetTop is
    // relative to its parent (the list, then the li).
    nodes.push(li.offsetTop + node.offsetTop + node.offsetHeight / 2);
  }
  const after = getComputedStyle(list, "::after");
  const top = parseFloat(after.top) || 0;
  const bottom = parseFloat(after.bottom) || 0;
  return {
    nodes,
    spineTop: top,
    spineLen: Math.max(1, list.offsetHeight - top - bottom),
  };
}

/**
 * Work: "The Ledger", a pinned, scroll-driven accordion timeline (desktop).
 *
 * Every role is a node on a left spine and is always visible as a header
 * (dot-matrix year + sector + company + dates); the open role drops its detail
 * (role, pull metric, bullets). It is a single-open accordion.
 *
 * Desktop (>900px, motion allowed): the section pins for PIN_VH_PER_ROW
 * viewports per role (id "work-pin"). Pin progress picks the open role (with
 * BAND_HYSTERESIS so resting on a boundary never flickers) and drives the
 * accent spine fill, which is tied to the node dots' real geometry. Clicking a
 * role opens it at once and glides the scroll to the centre of its band; the
 * scroll never re-picks a role mid-glide (jumpingRef).
 *
 * Mobile (<=900px) and reduced motion: no pin. Mobile is a tap-to-expand
 * stack that keeps the tapped header under the finger; reduced motion opens
 * every panel for a static, readable résumé.
 *
 * Motion (work-timeline.css): rows rise in once on entry (.is-entered), panels
 * morph on --t-morph / --ease-in-out with a faster fade-out on close, and
 * bullets stagger in after the panel is half open and fade out on close.
 */
export function Work() {
  const sectionRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const headRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Live prefers-reduced-motion: an OS toggle tears the pin down / rebuilds it.
  const reducedMotion = useSyncExternalStore(
    reducedMotionPref.subscribe,
    () => reducedMotionPref.value,
    () => false,
  );
  const [entered, setEntered] = useState(reducedMotion);

  // Narrow (<=900px): no pin, tap-to-expand in place. Read once at mount.
  const [isMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia(`(max-width: ${BREAKPOINT.narrow}px)`).matches,
  );

  // Single-open accordion. Current role open first so the section never reads as
  // a wall of collapsed rows. null = all collapsed.
  const firstOpen = Math.max(
    0,
    STINTS.findIndex((s) => s.current),
  );
  const [openIndex, setOpenIndex] = useState<number | null>(firstOpen);

  // One-shot entrance (.is-entered) once the section scrolls into view.
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

  // ── Desktop pinned timeline ───────────────────────────────────────────────
  const stRef = useRef<ScrollTrigger | null>(null);
  /** The pin's open band (hysteresis state). */
  const lastIdxRef = useRef(firstOpen);
  /** True while a click-jump glides; onUpdate then leaves the open row alone. */
  const jumpingRef = useRef(false);
  const clearJumpRef = useRef<((resync: boolean) => void) | null>(null);
  const progressRef = useRef(0);
  const geoRef = useRef<SpineGeo | null>(null);
  const fillRef = useRef(-1);

  useEffect(() => {
    if (isMobile || reducedMotion) return;
    const el = sectionRef.current;
    const list = listRef.current;
    if (!el || !list) return;

    // Spine fill: the tip sits on the node dot of the plain band at the band's
    // start and reaches the next node (or the spine's end) at the band's end.
    // Scroll-linked, so there is no CSS transition on it. Uses the plain band
    // rather than the hysteresis band so the tip is continuous in scroll even
    // mid-jump.
    // DELIBERATE SPEC DEVIATION (W3.11 says "measure after transitionend"):
    // the geometry is live (ResizeObserver below), so while the accordion
    // morphs the tip rides the node dots as they move, instead of jumping to
    // the new layout at transitionend. The tip can therefore ease back a little
    // during a 420 ms morph while the scroll holds still or moves forward.
    // Written on the list (.work-acc), whose ::after reads it, so each write
    // restyles only the accordion subtree.
    const renderFill = () => {
      const g = geoRef.current;
      if (!g || g.nodes.length === 0) return;
      const p = progressRef.current;
      const b = Math.min(plainBand(p), g.nodes.length - 1);
      const local = Math.min(1, Math.max(0, p * N - b));
      const from = g.nodes[b];
      const to = b + 1 < g.nodes.length ? g.nodes[b + 1] : g.spineTop + g.spineLen;
      const tip = from + local * (to - from);
      const fill = Math.min(1, Math.max(0, (tip - g.spineTop) / g.spineLen));
      if (Math.abs(fill - fillRef.current) < 1e-4) return;
      fillRef.current = fill;
      list.style.setProperty("--work-fill", fill.toFixed(4));
    };

    const applyProgress = (p: number) => {
      progressRef.current = p;
      renderFill();
      if (jumpingRef.current) return;
      const k = bandWithHysteresis(p, lastIdxRef.current);
      if (k !== lastIdxRef.current) {
        lastIdxRef.current = k;
        setOpenIndex(k);
      }
    };

    const st = ScrollTrigger.create({
      id: "work-pin",
      trigger: el,
      start: "top top",
      end: () => "+=" + Math.round(N * window.innerHeight * PIN_VH_PER_ROW),
      pin: true,
      pinSpacing: true,
      invalidateOnRefresh: true,
      onUpdate: (self) => applyProgress(self.progress),
      onRefresh: (self) => applyProgress(self.progress),
    });
    stRef.current = st;
    applyProgress(st.progress);

    // Geometry for the fill. The observer fires on every frame of an accordion
    // morph (the panels resize) and on real resizes / font swaps, always after
    // layout; the final delivery is the settled layout. onUpdate never reads
    // layout.
    const ro = new ResizeObserver(() => {
      geoRef.current = measureSpine(list);
      fillRef.current = -1;
      renderFill();
    });
    ro.observe(list);
    list.querySelectorAll(".work-acc-panel").forEach((p) => ro.observe(p));

    const stopLoaderWatch = refreshScrollOnLoaderLift();
    return () => {
      stopLoaderWatch();
      ro.disconnect();
      clearJumpRef.current?.(false);
      st.kill();
      stRef.current = null;
      geoRef.current = null;
      fillRef.current = -1;
      list.style.removeProperty("--work-fill");
      // A live reduced-motion toggle removes the pin spacer (1.86vh of page):
      // re-measure every downstream trigger. Rebuilding refreshes through
      // refreshScrollOnLoaderLift(); both are coalesced into one rAF refresh.
      requestScrollRefresh();
    };
  }, [isMobile, reducedMotion]);

  // Click-jump (desktop pin): open the row NOW, then glide to its band centre.
  // jumpingRef keeps onUpdate from re-picking rows the glide passes through.
  //
  // The glide is LOCKED against the wheel (Lenis lock:true). Unlocked, the
  // first wheel event of a trackpad inertia tail replaced the glide with a
  // few-px user scroll, and the resync then reverted the clicked row to the
  // scroll band's row ~150 ms later (an open-then-revert double morph). Now:
  //   - wheel within JUMP_GRACE_MS of the click is always ignored (the tail);
  //   - after that, tiny deltas and decaying same-direction runs are inertia;
  //   - anything else, touchstart, or a scroll key is a deliberate TAKEOVER:
  //     the glide is cancelled (lenis.reset()) and the user scrolls from here.
  // It clears on arrival or supersede (the promise), on takeover, or after the
  // glide duration + slack; the hysteresis state is then seeded to the clicked
  // row and re-synced to where we are.
  const startJump = (i: number, st: ScrollTrigger) => {
    clearJumpRef.current?.(false);
    const lenis = getLenis();
    const lock = lockControl(lenis);
    const y = st.start + ((i + 0.5) / N) * (st.end - st.start);
    const from = lenis?.animatedScroll ?? window.scrollY;
    const dur = presetDuration(y - from, window.innerHeight || 1, SCROLL.glide);
    const t0 = performance.now();
    let lastWheelAt = -Infinity;
    let lastDelta = 0;
    let cleared = false;
    // takeover=true: the user's input already owns the scroll (the glide was
    // reset). Otherwise (arrival, supersede, timeout, teardown) release our
    // wheel lock: a superseding tween without lock leaves isLocked set.
    const clear = (resync: boolean, takeover = false) => {
      if (cleared) return;
      cleared = true;
      window.clearTimeout(timer);
      offVirtual();
      window.removeEventListener("touchstart", onTouch);
      window.removeEventListener("keydown", onKey);
      if (clearJumpRef.current === clear) clearJumpRef.current = null;
      if (!takeover && lock?.isLocked) lock.isLocked = false;
      jumpingRef.current = false;
      lastIdxRef.current = i;
      if (!resync || stRef.current !== st) return;
      const k = bandWithHysteresis(st.progress, i);
      if (k !== i) {
        lastIdxRef.current = k;
        setOpenIndex(k);
      }
    };
    const settle = () => clear(true);
    const takeOver = () => {
      // reset() unlocks and stops the glide; inside the virtual-scroll handler
      // Lenis then processes this same event, so the first delta scrolls.
      lock?.reset();
      clear(true, true);
    };
    // Lenis emits virtual-scroll BEFORE its lock check, for wheel and touch.
    const onVirtual = ({ deltaY, event }: { deltaY: number; event: Event }) => {
      if (event.type !== "wheel" || (event as WheelEvent).ctrlKey || deltaY === 0) return;
      const now = performance.now();
      const mag = Math.abs(deltaY);
      const decaying =
        now - lastWheelAt < INERTIA_RUN_GAP_MS &&
        Math.sign(deltaY) === Math.sign(lastDelta) &&
        mag <= Math.abs(lastDelta);
      lastWheelAt = now;
      lastDelta = deltaY;
      if (now - t0 < JUMP_GRACE_MS || mag < JUMP_TAKEOVER_MIN_DELTA || decaying) return;
      takeOver();
    };
    const onTouch = () => takeOver();
    const onKey = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.key)) return;
      // Space on a button / field activates it rather than scrolling.
      const t = e.target as HTMLElement | null;
      if (e.key === " " && t?.closest("button, input, textarea, select, [contenteditable]")) return;
      takeOver();
    };
    const offVirtual = lenis ? lenis.on("virtual-scroll", onVirtual) : () => {};
    const timer = window.setTimeout(settle, (dur + JUMP_GUARD_SLACK_S) * 1000);
    window.addEventListener("touchstart", onTouch, { passive: true });
    window.addEventListener("keydown", onKey);
    clearJumpRef.current = clear;
    jumpingRef.current = true;
    lastIdxRef.current = i;
    void scrollToY(y, { preset: "glide", lock: true, onComplete: settle }).then(settle);
  };

  // ── Mobile tap anchoring ──────────────────────────────────────────────────
  // Opening a row collapses the one above it, which would throw the tapped
  // header up the screen. Record its y before the change, then (before paint)
  // collapse the previous panel instantly and scroll by the difference so the
  // header stays under the finger. Only the new panel animates.
  // DELIBERATE SPEC DEVIATION (W3.16 "skip while a touch fling is active"):
  // compensation always runs. On touch devices a touch during momentum stops
  // the fling and fires no click, so any tap that does reach here lands on a
  // settled page; the skip only ever fired just AFTER a fling and threw the
  // tapped header up by the height of the closing panel (-918 px at 390x844).
  const anchorRef = useRef<{ i: number; prev: number | null; top: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const a = anchorRef.current;
    anchorRef.current = null;
    if (!a || a.i !== openIndex) return;
    const head = headRefs.current[a.i];
    if (!head) return;
    // A previous panel BELOW the tapped row can't move its header: let it
    // morph closed normally.
    const prevItem = a.prev != null && a.prev < a.i ? itemRefs.current[a.prev] : null;
    prevItem?.classList.add("no-anim");
    const d = head.getBoundingClientRect().top - a.top; // forces the no-anim layout
    if (Math.abs(d) >= 0.5) {
      const lenis = getLenis();
      if (lenis) lenis.scrollTo(window.scrollY + d, { immediate: true, force: true });
      else window.scrollBy(0, d);
    }
    if (prevItem) requestAnimationFrame(() => prevItem.classList.remove("no-anim"));
  }, [openIndex]);

  const handleActivate = (i: number) => {
    if (isMobile || reducedMotion) {
      if (i === openIndex) return;
      const head = headRefs.current[i];
      if (isMobile && !reducedMotion && head) {
        anchorRef.current = { i, prev: openIndex, top: head.getBoundingClientRect().top };
      }
      setOpenIndex(i);
      return;
    }
    const st = stRef.current;
    setOpenIndex(i);
    if (st) startJump(i, st);
  };

  const isOpen = (i: number) => reducedMotion || i === openIndex;

  return (
    <section
      ref={sectionRef}
      aria-label="Work experience timeline"
      data-jump-progress={JUMP_PROGRESS}
      className={`portfolio-section portfolio-work${entered ? " is-entered" : ""}${reducedMotion ? " is-reduced-motion" : ""}`}
    >
      <div className="work-ledger">
        <header className="work-ledger-head">
          <div className="work-ledger-head-text">
            <div className="work-ledger-head-left">
              <span className="work-ledger-num">03</span>
              <span className="work-ledger-index">03 / 07 · Work</span>
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

        <ol ref={listRef} className="work-acc">
          {STINTS.map((s, i) => {
            const open = isOpen(i);
            const panelId = `work-panel-${i}`;
            return (
              <li
                key={i}
                ref={(node) => {
                  itemRefs.current[i] = node;
                }}
                style={{ ["--row-i" as string]: i }}
                className={`work-acc-item${open ? " is-open" : ""}${s.current ? " is-current" : ""}${openIndex != null && i < openIndex ? " is-past" : ""}`}
              >
                <button
                  ref={(node) => {
                    headRefs.current[i] = node;
                  }}
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
                    {/* The body carries the bottom padding: padding on the
                        clipped grid item itself survives a 0fr row, so a
                        collapsed panel would keep a residual strip. */}
                    <div className="work-acc-panel-body">
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
                            style={{ ["--i" as string]: j }}
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
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
