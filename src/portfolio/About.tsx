import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { requestScrollRefresh, refreshScrollOnLoaderLift } from "./scrollRefresh";
import "./sections.css";
import "./about.css";
import { ScrambleText } from "./ScrambleText";
import { track } from "../analytics";
import { MQ, SEAM_MQ, ease, reducedMotion as reducedMotionPref } from "../motion";
import { mountSeam } from "../seams/seam";
import { useMedia } from "../useMedia";
import { heroHandoff } from "../hero/heroState";
import { useReveal } from "./useReveal";
import { scrollToY } from "../scroll";

gsap.registerPlugin(ScrollTrigger);

/**
 * About: the BENTO DASHBOARD, held still under the Projects sheet.
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
 * DESKTOP: the rest of the bento (portrait, Currently, Exploring, Studying,
 * Reach, Location) builds ALL AT ONCE, no stagger (owner 2026-10-06: the
 * one-by-one boot across the pin "looks cluttered"). It fires on the hero's
 * cue (the iris about a third open), so the panels build where they can be
 * seen; the non-pinning `about-rest` trigger also reveals them as a fallback
 * (a load, refresh or jump past the hero). Reveals are imperative
 * class toggles (zero React renders per scroll frame) and LATCH: coming back
 * up from the Mac shows the finished dashboard, never a blank sheet.
 *
 * SEAM (owner brief 2026-10-06: section boundaries never stop the page). About
 * no longer pins. On the desk layout the section is 200svh with a sticky inner
 * .about-hold (src/seams/stack.css, keyed on this section's data-seam-stack),
 * so the parked room simply stays still from the hero hand-off on, and the
 * Projects sheet rises 1:1 over it (the Mac side lives in Macintosh.tsx). Two
 * seams ride that curtain here: `about-projects` stops painting the hold and
 * pauses the room bob once the sheet covers it, and `about-arrow` turns the
 * owner's "my room in real life!" arrow on its tail to point down at the
 * arriving Mac (gate G3).
 *
 * NARROW (MQ.narrow: ≤900px, or a phone on its side) has no hold and no
 * curtain (mirrors Work): a pinned, internally-scrolling stage was a nested
 * scroll-trap inside the page pin. The bento collapses to a compact column
 * that flows + scrolls with the page; each cell rises in once as it enters
 * (useReveal, 400ms / 12px), and the room render is neither rendered nor
 * decoded (about.css hides it there anyway).
 *
 * prefers-reduced-motion: every cell is force-revealed (no transforms), so
 * the dashboard is fully readable without the choreography. No hold either:
 * the section is plain 100vh flow (stack.css gates the hold on motion).
 */

/**
 * "My room in real life!" callout: a hand-drawn arrow, rasterised onto a
 * pixel grid so it speaks the same Offbit pixel language as the wordmarks.
 * The 0 deg pose is built at module load: a long, shallow quadratic curve that leaves the
 * label heading left and sags slightly to a tip just above the room's
 * top-right wall, stamped 3 cells thick, plus two barbs swept back from the
 * tip along the curve's final direction. Unit squares, drawn crispEdges, so
 * it stays sharp at any size.
 *
 * The cells are split into ordered SEGMENTS (each cell belongs to the first
 * segment that stamps it): the shaft from tail to tip, then both barbs
 * together from the tip outward. about.css shows them one after another, so
 * the arrow draws itself in after the bento has built (.is-drawn).
 */
function rasterArrow(deg: number): string[] {
  // The pose turned by `deg` on its tail (screen sense, negative = counter-
  // clockwise), rotated in curve space BEFORE the cells snap, so every pose
  // is grid-aligned pixel art (CSS-rotating the 0 deg pose turned its unit
  // squares into a sawtooth ribbon). The pivot is the first stamp's origin
  // (56, 6): the stamp's centre (57.5, 7.5) is the tail cell's centre.
  const rad = (deg * Math.PI) / 180, sn = Math.sin(rad), cs = Math.cos(rad);
  const turn = (x: number, y: number) =>
    deg ? [56 + (x - 56) * cs - (y - 6) * sn, 6 + (x - 56) * sn + (y - 6) * cs] : [x, y];
  const seen = new Set<string>();
  const segs: string[][] = [];
  const T = 3; // stroke thickness in cells
  const dot = (seg: number, px: number, py: number) => {
    const [x, y] = turn(px, py);
    for (let i = 0; i < T; i++) for (let j = 0; j < T; j++) {
      const c = `${Math.round(x) + i},${Math.round(y) + j}`;
      if (seen.has(c)) continue;
      seen.add(c);
      (segs[seg] ??= []).push(c);
    }
  };
  const SHAFT = 14, HEAD = 4; // segment counts
  const [x0, y0, cx, cy, x1, y1] = [56, 6, 34, 6, 2, 15]; // start, control, tip
  for (let i = 0; i <= 640; i++) {
    const t = i / 640, u = 1 - t;
    dot(Math.min(SHAFT - 1, Math.floor(t * SHAFT)), u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1);
  }
  // Arrowhead: two straight barbs swept back from the tip, ±40° off the
  // curve's final direction.
  const len = Math.hypot(cx - x1, cy - y1), bx = (cx - x1) / len, by = (cy - y1) / len;
  for (let i = 0; i <= 13; i++) {
    for (const a of [0.7, -0.7]) {
      const ax = bx * Math.cos(a) - by * Math.sin(a), ay = bx * Math.sin(a) + by * Math.cos(a);
      dot(SHAFT + Math.min(HEAD - 1, Math.floor((i / 14) * HEAD)), x1 + ax * i, y1 + ay * i);
    }
  }
  // Fixed slots (one per draw step, --i): a turned pose never shifts the
  // owner's draw order, even if one of its segments stamps nothing new.
  return Array.from({ length: SHAFT + HEAD }, (_, k) =>
    (segs[k] ?? []).map((c) => { const [x, y] = c.split(","); return `M${x} ${y}h1v1h-1z`; }).join(""));
}
const ROOM_ARROW_SEGS = rasterArrow(0);

/** Turned poses for the swivel, cached per 0.2 deg (finer than one cell of
 *  travel at the tip, so the turn reads continuous; only the cells step). */
const ARROW_POSE_STEP = 5; // poses per degree
const arrowPoses = new Map<number, string[]>();
function arrowPose(key: number) {
  let segs = arrowPoses.get(key);
  if (!segs) arrowPoses.set(key, (segs = key ? rasterArrow(key / ARROW_POSE_STEP) : ROOM_ARROW_SEGS));
  return segs;
}

/** Owner gate G3 (seam overhaul, default ON): while the Projects sheet rises
 *  over the still room, the "my room in real life!" arrow turns on its tail
 *  to point down at the arriving Mac, and swings back on scroll-up. No words
 *  are added. false = the static arrow. */
const ARROW_SWIVEL = true;
/** The arrow's turn when the sheet edge is 0.1vh below it (deg; negative =
 *  counter-clockwise on screen). The head starts out pointing left at the
 *  room; the Mac arrives down and to the left of the arrow's tail, so a
 *  ~50 deg turn aims the head at the Mac (judged at 1440x900 and 1280x720). */
const ARROW_TURN_DEG = -50;

/** The rest of the bento, revealed together after the arrival trio. */
const BENTO_REST = ["portrait", "now", "explore", "study", "reach", "loc"]
  .map((key) => `.card.c-${key}`)
  .join(", ");

/** Arrival trio selectors, in reveal (stagger) order. */
const ARRIVAL = [".about-banner", ".card.c-name", ".card.c-render"];

/** Latch one element revealed, staggered by `order` (--reveal-order). */
function reveal(el: Element | null | undefined, order: number) {
  if (!el || el.classList.contains("is-revealed")) return;
  (el as HTMLElement).style.setProperty("--reveal-order", String(order));
  el.classList.add("is-revealed");
}

/** Draw the room callout's arrow in (latched; about.css times it to start
 *  once the cells revealed alongside it have built). Stamps the latch time
 *  and announces it (DRAWN_EVENT), so the arrow swivel can wait for the
 *  owner's draw to finish before it turns the arrow. */
const DRAWN_EVENT = "about-callout-drawn";
function drawCallout(root: Element) {
  const c = root.querySelector<HTMLElement>(".about-room-callout");
  if (!c || c.classList.contains("is-drawn")) return;
  c.dataset.drawnAt = String(performance.now());
  c.classList.add("is-drawn");
  c.dispatchEvent(new Event(DRAWN_EVENT));
}

/** Lowest painted point of the arrow's pose turned by `deg`, viewBox units
 *  below the viewBox top (cell bottoms: the pixels' real extent). */
function arrowBottomAt(deg: number) {
  let max = 0;
  for (const d of arrowPose(Math.round(deg * ARROW_POSE_STEP))) {
    for (const m of d.matchAll(/M(-?\d+) (-?\d+)/g)) max = Math.max(max, Number(m[2]) + 1);
  }
  return max;
}
/** About.css draw-in length: --draw-wait + 140ms + (last --i) x --draw-step. */
function drawDurationMs(callout: Element, steps: number) {
  const cs = getComputedStyle(callout);
  const ms = (v: string) => {
    const t = v.trim();
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return 0;
    return /ms$/.test(t) ? n : /s$/.test(t) ? n * 1000 : n;
  };
  return ms(cs.getPropertyValue("--draw-wait")) + 140 + Math.max(0, steps - 1) * ms(cs.getPropertyValue("--draw-step"));
}

/** Cells the narrow layout reveals on enter (incl. the room cell on tablets;
 *  it is not rendered on roomless phones). */
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
  /* The room render is skipped only on roomless layouts (MQ.roomless: ≤600,
     or a phone on its side), so phones never request it; tablets (601-900)
     keep it as the first stacked cell, where the hero's iris opens onto it. */
  const roomless = useMedia(MQ.roomless);
  /* The ONLY React state left in the reveal: the header decode cue. */
  const cue = useSyncExternalStore(
    heroHandoff.subscribe,
    () => heroHandoff.cue,
    () => false,
  );

  useEffect(() => reducedMotionPref.subscribe(setReducedMotion), []);

  /* Warm the room render's decode so its first paint (under the parked,
     covered stage) never lands on a scroll frame. Roomless phones never
     render the room. */
  useEffect(() => {
    if (roomless) return;
    roomRef.current?.decode?.().catch(() => {});
  }, [roomless]);

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
    drawCallout(el);
  }, [mobile, reducedMotion, roomless]);

  /* Room callout: desktop draws it with the bento (revealRest below). Narrow
     has no bento build, so it draws on the hero's cue (the fade onto the
     room). Also catches a callout that mounts late (a resize that gains the
     room) after its trigger already passed. */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || roomless || !cue) return;
    if (mobile || el.querySelector(".card.c-portrait.is-revealed")) drawCallout(el);
  }, [mobile, roomless, cue]);

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

    // NARROW: no hold at all (stack.css gates the sticky .about-hold to the
    // desk layout). A pinned or held bento on a phone was a nested
    // scroll-trap; on narrow the bento is a plain stacked column that scrolls
    // with the page, and the cells rise in on enter (useReveal above).
    if (mobile) {
      // A breakpoint flip changes this section's height (200svh held on desk,
      // auto when stacked): refresh so every trigger BELOW recomputes its start.
      const html = document.documentElement;
      if (!html.classList.contains("loading-active")) {
        requestScrollRefresh();
      }
      return;
    }

    // The rest of the bento builds in one go (order 0 = no cascade). Latched:
    // reveal() skips cells that are already revealed.
    let done = false;
    const revealRest = () => {
      if (done) return;
      done = true;
      el.querySelectorAll(BENTO_REST).forEach((c) => reveal(c, 0));
      drawCallout(el);
    };
    if (heroHandoff.cue) revealRest();
    const unsubCue = heroHandoff.subscribe(() => {
      if (heroHandoff.cue) revealRest();
    });

    // Fallback for a visitor who lands at or past About's top without the
    // cue (a load, refresh or jump past the hero). This used to ride the
    // about-pin's update/refresh; About no longer pins (seam overhaul,
    // 2026-10-06: it holds still in its sticky .about-hold while the Projects
    // sheet rises over it), so a NON-pinning trigger from About's top to the
    // page end does the same job. Never on about-arrive's onEnter (top 92%):
    // that would build the panels under the opaque hero, out of sight.
    const st = ScrollTrigger.create({
      id: "about-rest",
      trigger: el,
      start: "top top",
      end: "max",
      onUpdate: revealRest,
      onRefresh: (self) => {
        // A refresh at rest above it (progress 0, the hero still on screen)
        // must not build the panels out of sight; the cue does that.
        if (self.progress > 0) revealRest();
      },
    });
    // Desk <-> narrow flips change this section's height: refresh once the
    // loader is gone so every trigger below re-reads its start.
    const stopLoaderWatch = refreshScrollOnLoaderLift();
    return () => {
      unsubCue();
      stopLoaderWatch();
      st.kill();
    };
  }, [mobile]);

  /* about -> projects, About side (seam overhaul; the Mac side is
     Macintosh.tsx). The Projects sheet rises 1:1 over the still room; once it
     covers About completely (the sheet's top at the viewport top), the hold
     stops painting and the room bob pauses (html[data-about-covered],
     about.css). Desk only: elsewhere nothing covers About. A class-like
     toggle, not a per-frame write. Driven by the sheet, an in-flow trigger. */
  useEffect(() => {
    const el = sectionRef.current;
    const hold = el?.querySelector<HTMLElement>(".about-hold");
    if (!el || !hold) return;
    const html = document.documentElement;
    let covered: boolean | null = null;
    const setCovered = (on: boolean) => {
      if (on === covered) return;
      covered = on;
      hold.style.visibility = on ? "hidden" : "";
      html.toggleAttribute("data-about-covered", on);
    };
    return mountSeam({
      id: "about-projects",
      trigger: () => document.querySelector(".portfolio-mac"),
      start: "top bottom",
      end: "top top",
      render: (p) => setCovered(p >= 0.999),
      final: () => setCovered(false),
      reset: () => setCovered(false),
    });
  }, []);

  /* Keyboard focus under the curtain (desk only: nothing covers About
     elsewhere). About's links stay where they are while the Projects sheet
     slides over them, so Tab could land on one the sheet hides (an obscured
     focus ring, WCAG 2.4.11). Retract the sheet instead: scroll back to
     About's top, where the sheet sits just below the viewport. Not `inert`:
     the visible top half must stay usable with a mouse. */
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || mobile) return;
    const onFocus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      const mac = document.querySelector(".portfolio-mac");
      if (!t || !mac || typeof t.getBoundingClientRect !== "function") return;
      const sheetTop = mac.getBoundingClientRect().top;
      if (sheetTop >= window.innerHeight || t.getBoundingClientRect().bottom <= sheetTop) return;
      void scrollToY(el.getBoundingClientRect().top + window.scrollY, { preset: "nudge" });
    };
    el.addEventListener("focusin", onFocus);
    return () => el.removeEventListener("focusin", onFocus);
  }, [mobile]);

  /* The arrow swivel (gate G3): the sheet's rise turns the room callout's
     arrow on its tail, from the room to the arriving Mac. Fine pointers on
     the desk layout only (a scroll-linked turn on touch lags threaded
     scroll). The turn is re-rasterised, not CSS-rotated: each angle's pose
     is the same curve turned on its tail before its cells snap to the grid
     (rasterArrow), swapped into the same draw paths. The angle stays
     continuous; only the cells step. Ends when the sheet edge is 0.1vh below
     the arrow's TURNED head, so the head is aimed before the sheet reaches
     it.

     The owner's draw comes first (775d518 / 07efda5: the arrow draws itself
     from the label onto the room, time-based after the bento builds). At any
     brisk scroll the curtain starts before that draw has finished, so the
     turn is gated on it: k = 0 until .is-drawn + the full draw time has
     elapsed, and the arrow draws pointing at the room. If the draw finishes
     with the sheet already partway up, k eases 0 -> 1 in a one-shot 300ms
     catch-up to the scroll's angle; from then on it is the pure f(p) turn
     again (reverses exactly). The ONE documented exception to pure f(p) in
     this seam. */
  useEffect(() => {
    const el = sectionRef.current;
    const arrow = el?.querySelector<SVGSVGElement>(".about-room-callout-arrow");
    const callout = el?.querySelector<HTMLElement>(".about-room-callout");
    const stage = el?.querySelector<HTMLElement>(".about-stage");
    const banner = el?.querySelector<HTMLElement>(".about-banner");
    if (!ARROW_SWIVEL || !el || !arrow || !callout || !stage || !banner) return;
    // The arrow's TURNED bottom, px below the hold's top. Layout offsets only
    // (offsetTop ignores the park translate, the iris pull-back scale and the
    // banner's reveal lift), so it reads the same at any scroll position.
    let line = 0;
    let lastP = 0;
    const gate = { k: 0 };
    let tween: gsap.core.Tween | null = null;
    let timer = 0;
    // Writes the turned pose's cells into the owner's 18 draw paths (same
    // order, same --i): no CSS rotate, so the cells stay on the pixel grid.
    const paths = [...arrow.querySelectorAll<SVGPathElement>("path")];
    let shown = 0;
    const write = (deg: number) => {
      const key = Math.round(deg * ARROW_POSE_STEP);
      if (key === shown) return;
      shown = key;
      const segs = arrowPose(key);
      paths.forEach((path, i) => path.setAttribute("d", segs[i] ?? ""));
    };
    const render = () => write(ARROW_TURN_DEG * ease.inOutCubic(lastP) * gate.k);
    const open = () => {
      if (gate.k === 1 || tween) return;
      if (lastP <= 0 || reducedMotionPref.value) {
        gate.k = 1;
        render();
        return;
      }
      tween = gsap.to(gate, { k: 1, duration: 0.3, ease: "power2.inOut", onUpdate: render, onComplete: () => { tween = null; } });
    };
    const arm = () => {
      if (!callout.classList.contains("is-drawn")) return;
      const at = Number(callout.dataset.drawnAt) || 0;
      const left = at + drawDurationMs(callout, ROOM_ARROW_SEGS.length) - performance.now();
      window.clearTimeout(timer);
      if (left <= 0) open();
      else timer = window.setTimeout(open, left + 16);
    };
    arm();
    callout.addEventListener(DRAWN_EVENT, arm);
    const stop = mountSeam({
      id: "about-arrow",
      when: SEAM_MQ.fine,
      trigger: () => document.querySelector(".portfolio-mac"),
      start: "top bottom",
      end: () => {
        const mac = document.querySelector(".portfolio-mac");
        const top = mac ? mac.getBoundingClientRect().top + window.scrollY : 0;
        const vh = window.innerHeight;
        // The sheet's top at (line + 0.1vh) on screen; never before the start.
        return Math.max(top - vh + 1, top - line - 0.1 * vh);
      },
      measure: () => {
        const cs = getComputedStyle(arrow);
        const w = parseFloat(cs.width) || arrow.getBoundingClientRect().width;
        // viewBox 62 wide; the head swings DOWN as it turns, so the bottom
        // that the sheet must not reach is the turned one.
        const bottom = (w / 62) * Math.max(24, arrowBottomAt(ARROW_TURN_DEG));
        line = stage.offsetTop + banner.offsetTop + (parseFloat(cs.top) || 0) + bottom;
      },
      render: (p) => {
        lastP = p;
        if (!tween) render();
      },
      final: () => {
        lastP = 0;
        write(0);
      },
      reset: () => {
        lastP = 0;
        write(0);
      },
    });
    return () => {
      stop();
      callout.removeEventListener(DRAWN_EVENT, arm);
      window.clearTimeout(timer);
      tween?.kill();
    };
  }, [roomless]);

  return (
    <section
      ref={sectionRef}
      className="portfolio-section portfolio-about"
      /* Seam layout flag (src/seams/stack.css): on the desk layout the
         section is 200svh and .about-hold sticks, so About sits still under
         the rising Projects sheet. Static: only this file sets it. */
      data-seam-stack=""
    >
      {/* The sticky inner wrapper (stack.css). The section root stays in
          flow: it is the registry selector, the jump target and every
          trigger's element; nothing ever measures the stuck hold. */}
      <div className="about-hold">
      <div className="about-stage">
        {/* TOP CHROME: wayfinding crumb + status. The big "ABOUT" wordmark
            is aria-hidden chrome; the real <h2> below carries the heading
            for assistive tech / SEO. */}
        <header className="about-banner" aria-hidden="true">
          <div className="about-banner-meta">
            <span className="about-crumb-idx">01</span>
            {/* Desktop crumb: "01 danielrltan.com" (owner removed the orange
                dash between them). Narrow keeps only the number tag. */}
            <span className="about-banner-domain">danielrltan.com</span>
          </div>
          <p className="about-banner-title">
            <ScrambleText text="About" play={cue} />
          </p>
          {/* "My room in real life!": a pixel hand-drawn arrow from the top-right
              corner down onto the room. Only where the room renders. */}
          {!roomless && (
            <div className="about-room-callout">
              <span className="about-room-callout-text">my room in real life!</span>
              <svg className="about-room-callout-arrow" viewBox="0 0 62 24" shapeRendering="crispEdges">
                {ROOM_ARROW_SEGS.map((d, i) => (
                  <path key={i} d={d} style={{ "--i": i } as React.CSSProperties} />
                ))}
              </svg>
            </div>
          )}
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
          {!roomless && (
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
      </div>
    </section>
  );
}
