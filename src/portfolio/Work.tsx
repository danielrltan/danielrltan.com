import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { requestScrollRefresh } from "./scrollRefresh";
import "./sections.css";
import "./work-timeline.css";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrambleText } from "./ScrambleText";
import { getLenis, scrollToY } from "../scroll";
import {
  DUR,
  EASE_CSS,
  MQ,
  ease,
  matches,
  reducedMotion as reducedMotionPref,
  toMs,
} from "../motion";
import { useMedia } from "../useMedia";
import { useReveal } from "./useReveal";
import { track } from "../analytics";
import { mountSeam, oneShot, smooth, softHold, SEAM, SEAM_MQ } from "../seams";

// ── Tunables (seam overhaul W3, .scratch/seams/SPEC.md §5.3) ────────────────
/**
 * Owner gate G2 (default on): every role starts open on desktop and each header
 * toggles its own row. The accordion no longer rolls with the scroll (the old
 * 1.86vh "work-pin" opened one role per band); the spine does, 1:1 with the
 * wheel. false = the fallback: single-open by click, the current role open at
 * load, still unpinned.
 */
const WORK_ALL_OPEN = true;
/**
 * Spine seam range on .portfolio-work (in flow): it starts where the Projects
 * relay pixel docks on node 0 (SEAM.relayDockAt, the W2 + W3 contract: Work's
 * top at 28% of the viewport) and is full at the end of the stepped hold
 * (Work's bottom at the viewport bottom: the section is 100svh + the hold).
 */
const SPINE_START = `top ${SEAM.relayDockAt * 100}%`;
const SPINE_END = "bottom bottom";
/**
 * STEPPED HOLD (owner 2026-10-07: "the experience section no longer feels
 * focused"). Desktop with a fine pointer: the ledger sits in a 100svh sticky
 * .work-hold and steps through the roles. Each role gets a still beat of
 * DWELL_VH with the other roles dimmed, then the ledger glides to the next
 * role's header (just under the HUD clearance) on a smoothstep over
 * GLIDE_K x the distance (peak speed 1.5 / GLIDE_K x the wheel, no velocity
 * step at either end). The focus passes to the next role mid-glide, and the
 * spine draws through it all, reaching each node at that hand-over, so the
 * wheel always moves something.
 */
const DWELL_VH = 0.35;
const GLIDE_K = 1.2;
const GLIDE_MIN_VH = 0.15;

/** One still beat of the stepped hold: the ledger parked at `y` for role `role`. */
interface Beat {
  /** Hold scroll (px from the hold's start) where the beat starts. */
  s: number;
  /** Ledger offset (px, scrolled up by this much) during the beat. */
  y: number;
  role: number;
  /** Glide to the next beat: [s + dwell, s + dwell + glide]. */
  glide: number;
}
interface StepModel {
  beats: Beat[];
  dwell: number;
  /** Total hold length (px). */
  len: number;
  /** Approach: SPINE_START to the hold start (px). */
  approach: number;
}

/** Read the stepped hold's beats from layout (offsetTop math: translate-proof). */
function measureSteps(ledger: HTMLElement, list: HTMLElement): StepModel {
  const vh = window.innerHeight;
  const over = Math.max(0, ledger.offsetHeight - vh);
  const pad = parseFloat(getComputedStyle(ledger).paddingTop) || 0;
  const ys: Array<{ y: number; role: number }> = [];
  (Array.from(list.children) as HTMLElement[]).forEach((li, i) => {
    const y = Math.min(over, Math.max(0, list.offsetTop + li.offsetTop - pad));
    ys.push({ y: i === 0 ? 0 : y, role: i });
  });
  // The last role's beat must show the ledger's end: if its header beat
  // leaves the bottom below the fold, add a closing beat on the end.
  const last = ys[ys.length - 1];
  if (last && last.y < over - 1) ys.push({ y: over, role: last.role });
  const dwell = DWELL_VH * vh;
  const beats: Beat[] = [];
  let pos = 0;
  ys.forEach((b, j) => {
    const next = ys[j + 1];
    const d = next ? Math.abs(next.y - b.y) : 0;
    const glide = next ? Math.max(GLIDE_MIN_VH * vh, GLIDE_K * d) : 0;
    beats.push({ s: pos, y: b.y, role: b.role, glide });
    pos += dwell + glide;
  });
  return { beats, dwell, len: pos, approach: SEAM.relayDockAt * vh };
}

/** Hold scroll where beat j's role takes the focus: mid-glide into it (0 for the first). */
function switchAt(m: StepModel, j: number): number {
  if (j <= 0) return 0;
  const prev = m.beats[j - 1]!;
  return prev.s + m.dwell + prev.glide / 2;
}

/** Ledger offset, focused role and spine fill at hold scroll h. Pure. */
function stepAt(m: StepModel, f: number[], h: number): { y: number; role: number; fill: number } {
  const { beats, dwell, len } = m;
  if (!beats.length) return { y: 0, role: 0, fill: 0 };
  if (h <= 0) return { y: 0, role: 0, fill: 0 };
  if (h >= len) {
    const b = beats[beats.length - 1]!;
    return { y: b.y, role: b.role, fill: 1 };
  }
  // Fill: reaches each role's node exactly where that role takes the focus
  // (switchAt), linear between, 1 at the hold's end.
  let fill = 1;
  for (let j = 0; j < beats.length; j++) {
    const k0 = switchAt(m, j);
    const k1 = j + 1 < beats.length ? switchAt(m, j + 1) : len;
    if (h >= k1) continue;
    const f0 = f[beats[j]!.role] ?? 0;
    const f1 = j + 1 < beats.length ? (f[beats[j + 1]!.role] ?? 1) : 1;
    fill = f0 + (f1 - f0) * ((h - k0) / Math.max(1, k1 - k0));
    break;
  }
  for (let j = 0; j < beats.length; j++) {
    const b = beats[j]!;
    const next = beats[j + 1];
    const end = next ? next.s : len;
    if (h >= end) continue;
    if (!next || h <= b.s + dwell) return { y: b.y, role: b.role, fill };
    const t = smooth((h - b.s - dwell) / Math.max(1, b.glide));
    return { y: b.y + (next.y - b.y) * t, role: t < 0.5 ? b.role : next.role, fill };
  }
  const b = beats[beats.length - 1]!;
  return { y: b.y, role: b.role, fill: 1 };
}
/**
 * Touch / phone one-shot (spec §5.3, rule §0.8: no scroll-linked writes on
 * touch). When the header's top crosses ONESHOT_LINE, node 0 drops in from
 * -DROP_PX (DROP_MS, --ease-out), then the spine draws 0 -> 1 over DRAW_MS on
 * --ease-in-out, lighting each node as the tip reaches it (the draw leaves
 * as the dot settles, DRAW_LEAD_MS early): 780ms in all.
 */
const ONESHOT_LINE = 0.7;
const DROP_PX = 40;
const DROP_MS = 320;
/**
 * The draw leaves node 0 this long before the drop ends: on --ease-out the dot
 * is within a pixel of home by then, and the overlap keeps the whole one-shot
 * at 780ms nominal, comfortably inside the spec's 900ms even when the
 * crossing is seen a frame or two late.
 */
const DRAW_LEAD_MS = 80;
const DRAW_MS = toMs(DUR.slow);

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

/** Spine geometry, in px relative to the .work-acc list's top edge. */
interface SpineGeo {
  /** Centre of each role's node dot. */
  nodes: number[];
  /** Node fractions along the accent fill: node i lights once the fill passes f[i]. f[0] = 0. */
  f: number[];
}

/**
 * Read the spine geometry: offsetTop math, so the rows' entrance transform
 * never skews it. Called only from the spine seam's measure() (onRefreshInit,
 * the one place it reads layout) and, on the one-shot path, at mount, on each
 * refresh and when the one-shot plays. It also
 * anchors the accent fill on node 0's centre (--work-fill-top): the Projects
 * relay pixel lands on node 0 and the spine draws downward FROM it, so fill 0
 * is node 0 and every f[i] is the fill fraction at which the tip reaches node i.
 */
function measureSpine(list: HTMLElement): SpineGeo {
  const nodes: number[] = [];
  for (const li of Array.from(list.children) as HTMLElement[]) {
    const node = li.querySelector<HTMLElement>(".work-acc-node");
    if (!node) continue;
    // li and .work-acc-node are both position:relative, so each offsetTop is
    // relative to its parent (the list, then the li); the dot sits at 50%.
    nodes.push(li.offsetTop + node.offsetTop + node.offsetHeight / 2);
  }
  const top = nodes[0] ?? 0;
  list.style.setProperty("--work-fill-top", `${top.toFixed(1)}px`);
  const bottom = parseFloat(getComputedStyle(list, "::after").bottom) || 0;
  const len = Math.max(1, list.offsetHeight - top - bottom);
  const f = nodes.map((y, i) => (i === 0 ? 0 : Math.min(1, Math.max(0, (y - top) / len))));
  return { nodes, f };
}

/** A node is lit (and past) once the fill has passed it; a full spine lights them all. */
const litAt = (fill: number, f: number) => fill >= 1 || fill > f;

/**
 * Rows open at load for the current layout: desktop all open (gate G2), phones
 * (MQ.compact) all collapsed (the open Broadridge panel alone was ~1236px tall
 * at 360px wide, so three short tappable rows read better), and the 769-900
 * band (or G2 off) the current role only.
 */
function initialOpen(): boolean[] {
  if (!matches(MQ.narrow) && WORK_ALL_OPEN) return STINTS.map(() => true);
  if (matches(MQ.compact)) return STINTS.map(() => false);
  const first = Math.max(0, STINTS.findIndex((s) => s.current));
  return STINTS.map((_, i) => i === first);
}

/**
 * Work: "The Ledger", an accordion timeline. On desktop with a fine pointer it
 * sits in a stepped hold (STEPPED HOLD above: one still beat per role, the
 * others dimmed); everywhere else it is in natural page flow.
 *
 * Every role is a node on a left spine and is always visible as a header
 * (dot-matrix year + sector + company + dates); an open role drops its detail
 * (role, pull metric, bullets).
 *
 * Seam overhaul (owner brief 2026-10-06: "one workstation, one signal, never
 * stopping"). The 1.86vh "work-pin" that rolled one role open per scroll band,
 * its click glide with the Lenis wheel lock, and the 100vh frame-fit CSS are
 * gone. Work scrolls 1:1 and the SPINE carries the motion instead:
 * - Projects -> Work (seam 3): the Mac's CRT powers off into one orange pixel
 *   that flies on #seam-layer (W2, macRelay.ts) and lands on node 0
 *   ([data-seam-target="work-node-0"]) when Work's top reaches
 *   SEAM.relayDockAt. In that same scroll position node 0 lights and the
 *   accent spine starts drawing down from it ("work-spine": --work-fill = p,
 *   node i lit iff p passes it, each metric re-decodes as its node lights on
 *   the way down). Pure f(p): it rewinds on scroll-up and lands right after a
 *   cut jump. Desktop with a fine pointer only (SEAM_MQ.fine).
 * - Touch, phones and the 769-900 band: a one-shot instead (node 0 drops in,
 *   then the spine draws on from it, 780ms in all), armed by the header crossing 70% and
 *   reset on scrolling back above.
 * - Reduced motion: every panel open, the spine full, every node lit.
 *
 * Rows: desktop starts all open and each header toggles its own row (G2,
 * WORK_ALL_OPEN). Narrow (MQ.narrow: <=900px or a phone on its side) is a
 * single-open tap-to-expand stack that keeps the tapped header under the
 * finger. Any toggle re-measures every trigger after the morph (the page below
 * moves), which also re-reads the spine geometry.
 *
 * Motion (work-timeline.css): rows fade in once on entry (.is-entered), panels
 * morph on --t-morph / --ease-in-out with a faster fade-out on close, and
 * bullets stagger in after the panel is half open and fade out on close.
 */
export function Work() {
  const sectionRef = useRef<HTMLElement>(null);
  const holdRef = useRef<HTMLDivElement>(null);
  const ledgerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  /** The stepped hold's live model (null when Work flows): the focus handler reads it. */
  const stepsRef = useRef<StepModel | null>(null);
  /** The role on its beat (-1 = none). A ref like litRef, and read by the
   *  row's className, so a re-render (a decode, a toggle) keeps it. */
  const focusRef = useRef(-1);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const headRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Live prefers-reduced-motion: an OS toggle swaps the spine seam for its
  // static end state (mountSeam) and opens every panel.
  const reducedMotion = useSyncExternalStore(
    reducedMotionPref.subscribe,
    () => reducedMotionPref.value,
    () => false,
  );
  const [entered, setEntered] = useState(reducedMotion);

  // Narrow (MQ.narrow: <=900px, or a phone on its side): single-open
  // tap-to-expand in place. Live, so a rotation / resize across the cut-over
  // re-seeds the open rows for the new layout.
  const isMobile = useMedia(MQ.narrow);
  /** Desktop multi-open toggles (gate G2). */
  const multi = WORK_ALL_OPEN && !isMobile && !reducedMotion;

  const [open, setOpen] = useState<boolean[]>(initialOpen);
  const layoutRef = useRef(isMobile);

  // Re-measure every trigger once a row's morph has settled: the rows below
  // and every later section moved. One coalesced refresh per burst of taps.
  const morphTimerRef = useRef(0);
  const refreshAfterMorph = () => {
    window.clearTimeout(morphTimerRef.current);
    morphTimerRef.current = window.setTimeout(requestScrollRefresh, toMs(DUR.morph) + 40);
  };
  useEffect(() => () => window.clearTimeout(morphTimerRef.current), []);

  useEffect(() => {
    if (layoutRef.current === isMobile) return;
    layoutRef.current = isMobile;
    setOpen(initialOpen());
    refreshAfterMorph();
  }, [isMobile]);

  // Narrow: the header and each row rise in once as they enter (shared
  // [data-reveal] primitive, 400ms / 12px on stacked layouts). Desktop keeps
  // its section-level .is-entered cascade below.
  useReveal(sectionRef, { enabled: isMobile && !reducedMotion });

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

  // ── Spine: lit nodes ──────────────────────────────────────────────────────
  // Lit state is written by the spine seam / one-shot as classes on each row
  // (.is-lit and .is-past; the Projects relay's joint check reads node 0's
  // row). It lives in a ref, never React state (no re-render per scroll
  // frame), and the row's JSX className reads the same ref, so a re-render (a
  // toggle, a decode) can never wipe a lit row.
  const litRef = useRef<boolean[]>(STINTS.map(() => false));
  const paintLit = () => {
    itemRefs.current.forEach((li, i) => {
      if (!li) return;
      const on = !!litRef.current[i];
      li.classList.toggle("is-lit", on);
      li.classList.toggle("is-past", on);
    });
  };
  const setLit = (on: (i: number) => boolean) => {
    let changed = false;
    for (let i = 0; i < N; i++) {
      const v = on(i);
      if (litRef.current[i] !== v) {
        litRef.current[i] = v;
        changed = true;
      }
    }
    if (changed) paintLit();
  };

  // Metric decode keys: bumping one remounts that row's ScrambleText, which
  // decodes once it is on screen. Driven by the spine seam's `cross` one-shots
  // (down only, silent on cut jumps), so a metric re-decodes as its node
  // lights, the signal arriving.
  const [decodes, setDecodes] = useState<number[]>(() => STINTS.map(() => 0));

  // ── The spine seam ("work-spine") ─────────────────────────────────────────
  useEffect(() => {
    const section = sectionRef.current;
    const list = listRef.current;
    const ledger = ledgerRef.current;
    if (!section || !list || !ledger) return;
    let geo: SpineGeo | null = null;

    // ── Stepped hold writes (scroll mode only) ──
    let lastY = NaN;
    let lastRole = -1;
    const setStep = (y: number, role: number) => {
      const r = Math.round(y * 2) / 2;
      if (r !== lastY) {
        lastY = r;
        ledger.style.translate = r ? `0 ${-r}px` : "";
      }
      if (role !== lastRole) {
        lastRole = role;
        focusRef.current = role;
        itemRefs.current.forEach((li, i) => li?.classList.toggle("is-focus", i === role));
      }
    };
    /** Drop the hold: plain flow (fallback / final / reset / unmount). */
    const unstep = () => {
      const had = section.hasAttribute("data-work-hold");
      stepsRef.current = null;
      section.removeAttribute("data-work-hold");
      section.style.removeProperty("--work-hold");
      list.classList.remove("is-stepped");
      ledger.style.translate = "";
      lastY = NaN;
      lastRole = -1;
      focusRef.current = -1;
      itemRefs.current.forEach((li) => li?.classList.remove("is-focus"));
      // The section shrinks back to its content: re-measure every trigger.
      if (had) requestScrollRefresh();
    };
    const setFill = (v: number | null) => {
      if (v == null) list.style.removeProperty("--work-fill");
      else list.style.setProperty("--work-fill", v.toFixed(4));
    };
    const lightTo = (fill: number) => setLit((i) => !!geo && litAt(fill, geo.f[i] ?? 1));

    // Down-only decode per node. mountSeam keeps these objects, so measure()
    // moves each `at` onto its node's measured fraction in place.
    const cross = STINTS.map((_, i) => ({
      at: i === 0 ? 1e-6 : i / N,
      down: () => setDecodes((d) => d.map((k, j) => (j === i ? k + 1 : k))),
    }));

    // Touch / phone / 769-900: the one-shot drop + draw (time-based, so it
    // never trails native threaded scroll).
    const fallback = () => {
      const head = section.querySelector(".work-ledger-head");
      if (!head) return () => {};
      const dot0 = list.querySelector<HTMLElement>('[data-seam-target="work-node-0"]');
      // Mode classes go on the list: React owns the section's className and
      // rewrites it on .is-entered, which would drop them.
      list.classList.add("is-spine-oneshot");
      // Anchor the hairline and the fill on node 0 now and on every refresh
      // (fonts, a row tap), not only when the one-shot plays: the hairline's
      // top follows --work-fill-top, so a late first measure would hop it
      // down onto node 0 the moment the drop starts.
      const anchor = () => {
        geo = measureSpine(list);
      };
      anchor();
      ScrollTrigger.addEventListener("refreshInit", anchor);
      let fill = 0;
      let raf = 0;
      let timer = 0;
      let drop: Animation | null = null;
      const stop = () => {
        cancelAnimationFrame(raf);
        window.clearTimeout(timer);
        raf = 0;
        timer = 0;
        drop?.cancel();
        drop = null;
      };
      // Time-based tween of the fill (one writer, no CSS transition on it).
      // `at` pins the tween to a schedule (DRAW_LEAD_MS before the drop's end) instead of the
      // moment the timer happens to fire, so a late timer on a busy main
      // thread never stretches the one-shot past its 780ms.
      const draw = (to: 0 | 1, done?: () => void, at?: number) => {
        const from = fill;
        const dur = DRAW_MS * Math.abs(to - from);
        const t0 = at ?? performance.now();
        const tick = (now: number) => {
          const k = dur > 0 ? Math.min(1, Math.max(0, now - t0) / dur) : 1;
          fill = from + (to - from) * ease.inOut(k);
          setFill(fill);
          lightTo(fill);
          if (k < 1) raf = requestAnimationFrame(tick);
          else {
            raf = 0;
            done?.();
          }
        };
        raf = requestAnimationFrame(tick);
      };
      const play = (dir: 1 | -1): Animation | void => {
        stop();
        geo = measureSpine(list);
        if (dir === 1) {
          list.classList.add("is-spine-drawn");
          // Mid-rewind: node 0 is still in place, just draw back down.
          if (fill > 0) return draw(1);
          drop =
            dot0?.animate(
              [
                { translate: `0 ${-DROP_PX}px`, opacity: 0 },
                { translate: "0 0", opacity: 1 },
              ],
              { duration: DROP_MS, easing: EASE_CSS.out },
            ) ?? null;
          const drawAt = performance.now() + DROP_MS - DRAW_LEAD_MS;
          timer = window.setTimeout(() => draw(1, undefined, drawAt), DROP_MS - DRAW_LEAD_MS);
          return drop ?? undefined;
        }
        // Rewind: the spine retracts into node 0, then node 0 lifts away.
        draw(0, () => {
          drop =
            dot0?.animate(
              [
                { translate: "0 0", opacity: 1 },
                { translate: `0 ${-DROP_PX}px`, opacity: 0 },
              ],
              { duration: DROP_MS, easing: EASE_CSS.in, fill: "forwards" },
            ) ?? null;
          if (!drop) list.classList.remove("is-spine-drawn");
          else
            drop.onfinish = () => {
              list.classList.remove("is-spine-drawn");
              drop?.cancel();
              drop = null;
            };
        });
      };
      // Cut jumps and a mount below the line land on the end state, unanimated.
      const snap = (dir: 1 | -1) => {
        stop();
        geo = measureSpine(list);
        fill = dir === 1 ? 1 : 0;
        list.classList.toggle("is-spine-drawn", dir === 1);
        setFill(fill);
        lightTo(fill);
      };
      const undo = oneShot({ el: head, line: ONESHOT_LINE, edge: "top", play, snap });
      return () => {
        ScrollTrigger.removeEventListener("refreshInit", anchor);
        undo();
        stop();
        list.classList.remove("is-spine-oneshot", "is-spine-drawn");
        list.style.removeProperty("--work-fill-top");
      };
    };

    const stopSpine = mountSeam({
      id: "work-spine",
      trigger: () => section,
      start: SPINE_START,
      end: SPINE_END,
      when: SEAM_MQ.fine,
      measure: () => {
        geo = measureSpine(list);
        // The stepped hold: size it (the section grows to 100svh + its
        // length; stack.css keys the sticky on data-work-hold) before
        // ScrollTrigger reads any position (this runs on refreshInit).
        const m = measureSteps(ledger, list);
        stepsRef.current = m;
        section.setAttribute("data-work-hold", "");
        section.style.setProperty("--work-hold", `${m.len.toFixed(1)}px`);
        list.classList.add("is-stepped");
        // Each metric decodes as the fill reaches its node: where its role
        // takes the focus, as a fraction of the whole seam (approach + hold).
        const total = Math.max(1, m.approach + m.len);
        cross.forEach((c, i) => {
          const j = m.beats.findIndex((x) => x.role === i);
          c.at = i === 0 ? 1e-6 : Math.max(1e-6, j >= 0 ? (m.approach + switchAt(m, j) + 1) / total : 1);
        });
      },
      render: (p) => {
        // Scroll mode: each metric stays unprinted until its node lights
        // (work-timeline.css), so its decode is the first time it reads.
        // Before, it sat readable, then scrambled into noise as the node
        // lit: already-read copy boiling.
        list.classList.add("is-spine-scroll");
        const m = stepsRef.current;
        if (!m || !geo) {
          setFill(p);
          lightTo(p);
          return;
        }
        // Approach (relay dock to the hold start): node 0 lit, the ledger
        // still. Then the stepped hold.
        const h = p * (m.approach + m.len) - m.approach;
        const st = stepAt(m, geo.f, h);
        const fill = p <= 0 ? 0 : Math.max(1e-4, st.fill);
        setStep(st.y, st.role);
        setFill(fill);
        lightTo(fill);
      },
      cross,
      final: () => {
        unstep();
        list.classList.remove("is-spine-scroll");
        geo = null;
        list.style.removeProperty("--work-fill-top");
        setFill(1);
        setLit(() => true);
      },
      reset: () => {
        unstep();
        list.classList.remove("is-spine-scroll");
        list.style.removeProperty("--work-fill-top");
        setFill(null);
        setLit(() => false);
      },
      fallback: () => {
        unstep();
        return fallback();
      },
    });

    // The hold trigger ('work-pin'): softHold eases the sticky .work-hold's
    // engage and release edges. Zero length (writes nothing) whenever the
    // section flows (no data-work-hold: the stage is the section's height).
    const stage = holdRef.current;
    const hold = stage ? softHold({ id: "work-pin", section, stage }) : null;

    // Keyboard: a focused row under the clip would be invisible (the browser
    // cannot scroll a clipped stage). Scroll the page to that role's beat.
    const onFocus = (e: FocusEvent) => {
      const m = stepsRef.current;
      const li = (e.target as HTMLElement | null)?.closest?.(".work-acc-item");
      if (!m || !li) return;
      const i = itemRefs.current.indexOf(li as HTMLLIElement);
      const b = m.beats.find((x) => x.role === i);
      if (!b) return;
      const top = section.getBoundingClientRect().top + window.scrollY;
      const y = top + b.s + m.dwell / 2;
      if (Math.abs(y - window.scrollY) > 2) void scrollToY(y, { preset: "nudge" });
    };
    list.addEventListener("focusin", onFocus);

    return () => {
      list.removeEventListener("focusin", onFocus);
      hold?.kill();
      stopSpine();
      unstep();
    };
    // Mounted once: the seam re-gates itself on MQ / reduced-motion flips,
    // and row toggles reach it through the refresh (measure), never a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!a || !open[a.i]) return;
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
  }, [open]);

  const handleActivate = (i: number) => {
    // Reduced motion: every panel is open and static.
    if (reducedMotion) return;
    if (multi) {
      setOpen((o) => o.map((v, k) => (k === i ? !v : v)));
      refreshAfterMorph();
      return;
    }
    if (open[i]) return;
    const head = headRefs.current[i];
    if (isMobile && head) {
      const prev = open.findIndex(Boolean);
      anchorRef.current = { i, prev: prev < 0 ? null : prev, top: head.getBoundingClientRect().top };
    }
    setOpen(STINTS.map((_, k) => k === i));
    refreshAfterMorph();
  };

  const isOpen = (i: number) => reducedMotion || !!open[i];

  return (
    <section
      ref={sectionRef}
      aria-label="Work experience timeline"
      className={`portfolio-section portfolio-work${entered ? " is-entered" : ""}${multi ? " is-multi" : ""}${reducedMotion ? " is-reduced-motion" : ""}`}
    >
      {/* The stepped hold's sticky stage (stack.css, keyed on data-work-hold,
          which the spine seam sets on desktop with a fine pointer). A plain
          block everywhere else. */}
      <div className="work-hold" ref={holdRef}>
      <div className="work-ledger" ref={ledgerRef}>
        <header className="work-ledger-head" data-reveal={isMobile ? "" : undefined}>
          <div className="work-ledger-head-text">
            <div className="work-ledger-head-left">
              <span className="work-ledger-num">03</span>
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
                // Lit state comes from the spine (litRef), so a re-render
                // writes the same classes the seam last painted.
                className={`work-acc-item${open ? " is-open" : ""}${s.current ? " is-current" : ""}${litRef.current[i] ? " is-lit is-past" : ""}${focusRef.current === i ? " is-focus" : ""}`}
              >
                <button
                  ref={(node) => {
                    headRefs.current[i] = node;
                  }}
                  type="button"
                  className="work-acc-head"
                  // On the button, not the <li>: the li's className changes
                  // on open, which would drop the imperative .is-revealed.
                  data-reveal={isMobile ? "" : undefined}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => {
                    if (!open) track("work_expand", { role: s.brand });
                    handleActivate(i);
                  }}
                >
                  <span className="work-acc-node" aria-hidden>
                    {/* The node dot: a real element so the Projects relay
                        (W2) can measure where its pixel lands. */}
                    <span
                      className="work-acc-dot"
                      data-seam-target={i === 0 ? "work-node-0" : undefined}
                    />
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
                            {/* Plain until the spine first lights this node
                                (desktop), then decodes on each lit-going-down
                                crossing; phones and reduced motion keep the
                                plain text. */}
                            <ScrambleText
                              key={decodes[i]}
                              text={s.pull.metric}
                              play={decodes[i] > 0}
                            />
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
      </div>
    </section>
  );
}
