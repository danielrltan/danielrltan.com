import { lazy, Suspense, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { refreshScrollOnLoaderLift } from "./scrollRefresh";
import { softHold } from "../seams";
import { mountMacRelay } from "./macRelay";
import { isTuneMode } from "../tuneMode";
import "./sections.css";
import "./macintosh.css";
import { ScrambleText } from "./ScrambleText";
import type { ScreenRect } from "../macintosh/MacintoshScene";
// Lazy: this scene (its own WebGL canvas + drei/three deps) sits far down the
// scroll, so its chunk loads on approach instead of in the first-paint bundle.
// App.tsx idle-prefetches the same module so it's cached before scroll-in.
const MacintoshScene = lazy(() =>
  import("../macintosh/MacintoshScene").then((m) => ({
    default: m.MacintoshScene,
  })),
);
import { TechStackTicker } from "../macintosh/TechStackTicker";
import { MAC_PROJECTS, liveLinkLabel, type MacProject } from "../macintosh/projects";
import { track } from "../analytics";
import { useMacNarrow } from "../macintosh/useMacNarrow";
import { useSectionCanvasMount } from "../useSectionCanvasMount";
import { useReveal } from "./useReveal";
import { scrollToY } from "../scroll";
import {
  MAC_BEATS,
  MAC_CINE_END_DEFAULT,
  macJumpProgress,
  macLandedC,
  type MacCine,
} from "../macintosh/macBeats";

gsap.registerPlugin(ScrollTrigger);

// Honour the OS "reduce motion" preference. When set we skip the hold +
// the scroll-driven orbit/dolly/boot cinematic entirely and park
// the Mac in its LANDED state (STATIC_LANDED_C) so users who opt out of
// motion still see the booted CRT + clickable tiles immediately: same
// graceful-degradation path the narrow layout already takes.
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", handler);
    setReduced(mql.matches);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return reduced;
}

/**
 * Stack + Projects section: the sheet that slides up over About, then holds.
 *
 * Seam overhaul (2026-10-06, spec .scratch/seams/SPEC.md §5.2-5.3; owner
 * brief "one workstation, one signal, never stopping"). The GSAP pin, its
 * landed magnet and the timed exit blink/shrink are gone:
 * - Layout (src/seams/stack.css, desktop only): the section is 100svh +
 *   --seam-mac-hold tall and in normal flow; the inner .mac-sticky holds the
 *   stage. With About's flag set too, a -100svh margin makes the section an
 *   opaque sheet that rises 1:1 over the still About room (the curtain).
 * - softHold ('mac-pin', a NON-pinning hold trigger) eases the sticky's
 *   engage and release (C1 edges) and is what jumpToSection lands inside.
 * - One plain ScrollTrigger ('mac-cine') writes c, the cine distance in vh
 *   since the sheet's top edge entered, into cineRef; MacintoshScene reads it
 *   every frame (beat map in src/macintosh/macBeats.ts). The orbit pre-rolls
 *   on the rising sheet, the Mac lands mid-hold, and at the hold end the CRT
 *   picture powers off by scroll and hands its last dot to the relay pixel
 *   (./macRelay.ts) that carries it onto the first Work node.
 * Lenis is the one smoother on wheel input (touch gets a single follower
 * inside the scene). No snap: a rest anywhere stays where the reader left it.
 */

// Static-landed path (narrow / reduced motion): park on the landed pose (the
// middle of the landed dwell), NOT the hold end, which is the powered-off
// picture.
const STATIC_LANDED_C = macLandedC(MAC_CINE_END_DEFAULT);
// Click-to-zoom CTA glide cap (seconds; distance-scaled below it).
const CTA_MAX_DURATION_S = 1.2;

// ?tune=mac skips the scroll binding so OrbitControls inside MacintoshScene
// can drive the camera freely for re-framing.
const TUNE_MODE = isTuneMode("mac");

// ?pin=<c> parks the cine at a fixed c (cine vh, 0..3; see macBeats.ts)
// WITHOUT binding it to scroll: useful for QA-ing a specific beat (e.g.
// ?pin=0.8 for the orbit, ?pin=2.4 for the landed CRT, ?pin=2.75 for the
// power-off dot). The orbit + Mac choreography STILL animate (they just read
// this static value), so what you see is exactly what the user sees at that
// scroll depth. Ignored outside [0, 3].
const PIN_FREEZE: number | null = (() => {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("pin");
  if (raw == null) return null;
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v < 0 || v > 3) return null;
  return v;
})();

export function Macintosh() {
  const sectionRef = useRef<HTMLElement>(null);
  // The editorial "Projects" header overlaps the Mac as the camera dollies in;
  // fade it out across the descent so it's gone by the time the CRT fills the
  // frame (owner-flagged: it sat over the zoomed screen and read as a glitch).
  const headerRef = useRef<HTMLDivElement>(null);
  // Mount the Mac <Canvas> only as the section approaches; release the WebGL
  // context once it's well out of view (the weak-GPU freeze fix). The reliable
  // mount-on-approach gate (generous margin + hysteresis) avoids the old IO
  // gate's "scrolled past before it spun up" bug. .mac-stage is position:absolute
  // so mounting/unmounting the canvas never changes layout under the hold. The GLB
  // is module-scope preloaded so a remount on scroll-back is instant.
  // mountVh 3.5 (vs the 1.75 default): mount the Mac scene a couple extra
  // viewports earlier — while the user is still in the About section
  // above it (which has NO canvas of its own, so this adds no concurrent WebGL
  // context) — so the CRT textures + scene have time to spin up BEFORE arrival.
  // Without the longer lead the section read blank/empty on scroll-in
  // (owner-flagged). The scene chunk + mac.glb are eagerly idle-warmed in
  // App.tsx, so the early mount finds them cached and is cheap. unmountVh:5
  // keeps the release band above the wider mount band (hysteresis).
  const macMounted = useSectionCanvasMount(sectionRef, {
    mountVh: 3.5,
    unmountVh: 5,
  });
  // The cine state (c, the hold end, the live gate) the scene reads every
  // frame. Written from ScrollTrigger callbacks only; never React state.
  const cineRef = useRef<MacCine>({
    c: TUNE_MODE ? STATIC_LANDED_C : PIN_FREEZE != null ? PIN_FREEZE : 0,
    end: MAC_CINE_END_DEFAULT,
    live: true,
    wake: null,
  });
  // The open project. Selecting one (3D tile click OR the accessible
  // project buttons) dollies the camera INTO the CRT and swaps the
  // screen to the project DETAIL view. There is no longer a side
  // drawer; the CRT IS the detail view. Clearing it (ESC / BACK) pulls
  // the camera back out to the tile grid.
  const [selected, setSelected] = useState<MacProject | null>(null);
  // Which on-CRT control the pointer is over ("back"|"link"), driving the
  // CANVAS-painted hover feedback. The DOM hotspots are invisible hover/click
  // detectors; painting the hover on the canvas keeps it aligned with the
  // bulged button (a flat DOM glow drifted off it — owner-flagged).
  const [hoveredControl, setHoveredControl] = useState<"back" | "link" | null>(
    null,
  );
  // MOBILE ACCORDION: which project's inline detail is expanded on the
  // narrow/landed path. Replaces the old open -> detail -> Back flow with a
  // tap-to-expand dropdown per project (user request: "just make it
  // dropdowns"). First project open by default so the list isn't a wall of
  // collapsed rows; single-open (opening one collapses the rest), and
  // re-tapping the open row closes it. Desktop's 3D CRT selection is separate
  // (it uses `selected`); this never touches it.
  const [openMobileId, setOpenMobileId] = useState<string | null>(
    MAC_PROJECTS[0]?.id ?? null,
  );
  const toggleMobileProject = (id: string) =>
    setOpenMobileId((cur) => (cur === id ? null : id));
  // On-screen rect of the CRT screen face, projected by the 3D scene each
  // throttled tick. Positions the real clickable close + live controls
  // EXACTLY over their painted faces now that the detail-zoom lands
  // dead-on/square. Desktop only; null when no project is open / not
  // zoomed. Stored as a ref-mirror in state only when it changes enough
  // to matter (the scene already throttles to ~30Hz).
  const [screenRect, setScreenRect] = useState<ScreenRect | null>(null);
  // The element that had focus when the project was opened, so we can
  // restore focus to it on close WITHOUT scrolling the held page
  // (preventScroll). Clicking a 3D tile leaves focus on <body>.
  const openerFocusRef = useRef<HTMLElement | null>(null);
  // Real DOM "BACK" button rendered over the CRT (desktop) while a
  // project is open: focused on open so keyboard users land on a control
  // inside the (canvas-invisible) detail view, and ESC-reachable.
  const backBtnRef = useRef<HTMLButtonElement>(null);

  // Apply a projected screen rect from the 3D scene, but only re-render
  // when it changes enough to matter: the scene emits ~30Hz; once the
  // detail-zoom settles the values are static, so this collapses the
  // churn to near-zero while a project is open.
  const handleScreenRect = (next: ScreenRect | null) => {
    setScreenRect((prev) => {
      if (next === null) return prev === null ? prev : null;
      if (
        prev &&
        Math.abs(prev.x - next.x) < 0.5 &&
        Math.abs(prev.y - next.y) < 0.5 &&
        Math.abs(prev.w - next.w) < 0.5 &&
        Math.abs(prev.h - next.h) < 0.5 &&
        Math.abs(prev.vis - next.vis) < 0.01 &&
        // Also propagate a changed linkWFrac (the painter reports the CTA width
        // a tick AFTER the rect first appears, so the FIRST rect captured
        // linkWFrac=0; without this the position settles and the real width is
        // never picked up → the link hotspot stayed at the fallback width).
        prev.linkWFrac === next.linkWFrac
      ) {
        return prev;
      }
      return next;
    });
  };

  // Centralised open: remember the opener for focus restore, then set
  // the project. Used by BOTH the sr-only buttons and (via the prop)
  // the 3D tile raycast.
  const openProject = (p: MacProject) => {
    // Seam 3: from the power-off on, the CRT belongs to the relay (it powers
    // off by scroll and its last dot flies to Work). A detail opened there
    // would re-light the screen under the flying pixel: refuse it.
    if (!staticLanded && pastPowerOff()) return;
    track("project_open", { project: p.title });
    openerFocusRef.current = document.activeElement as HTMLElement | null;
    setSelected(p);
    // NARROW: the detail renders ON the CRT, which sits ABOVE the tap
    // list in the stacked layout — often scrolled out of view when the
    // user taps a row. Without this, a successful tap looked like
    // "nothing happened, the list just vanished" (the reported broken
    // OPEN buttons, together with the pointer-events fix in the CSS).
    if (staticLanded) {
      const stage = sectionRef.current?.querySelector<HTMLElement>(".mac-stage");
      if (stage) {
        // Centre the stage: glide preset (reduced motion cuts, in scrollToY).
        const r = stage.getBoundingClientRect();
        const y = window.scrollY + r.top + r.height / 2 - window.innerHeight / 2;
        void scrollToY(y, { preset: "glide" });
      }
    }
  };
  // Centralised close: clear the project, then restore focus to the
  // opener with preventScroll. THE JITTER FIX: a bare prevFocus.focus()
  // on an sr-only (off-screen, clipped) project button forces the
  // browser to SCROLL the page to reveal it; on a held (sticky) section
  // that jolts the stage → the reported open/ESC jitter. preventScroll
  // restores focus without moving the scroll position.
  const closeProject = () => {
    if (selected) track("project_close", { project: selected.title });
    setSelected(null);
    setScreenRect(null);
    setHoveredControl(null);
    const prev = openerFocusRef.current;
    openerFocusRef.current = null;
    if (prev && typeof prev.focus === "function") {
      prev.focus({ preventScroll: true });
    }
  };

  // Seam 3 (projects -> work): the scroll-bound power-off and the relay
  // pixel always play from the tile grid. Scrolling into the power-off with
  // a detail open closes it (focus back to its opener, ESC listener gone),
  // so no lit detail sits under the pixel and nothing outlives the section.
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const closeRef = useRef(closeProject);
  closeRef.current = closeProject;
  function pastPowerOff() {
    const { c, end } = cineRef.current;
    return c >= end - MAC_BEATS.powerOffLead;
  }

  // ESC closes the open project (camera pulls back to the tile grid).
  // Also move focus onto the on-CRT BACK button when a project opens so
  // keyboard users have a control inside the detail view: focused with
  // preventScroll so opening never scrolls the held page either.
  useEffect(() => {
    if (!selected) return;
    // Defer so the button is mounted before we focus it.
    const id = requestAnimationFrame(() => {
      backBtnRef.current?.focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("keydown", onKey);
    };
    // closeProject is stable enough for this effect; selected drives it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  // ≤900px: skip the hold + orbit choreography. The section becomes
  // a normal-flow vertical stack (header → ticker → landed Mac) and the
  // 3D scene reads a fixed landed c instead of scroll (stack.css gates the
  // hold to the same complement of MQ.narrow, so layout and behaviour agree).
  const narrow = useMacNarrow();
  // Reduced-motion users get the same "no cinematic, land it now" path
  // as narrow viewports: plain 100svh flow, the static landed frame.
  const reducedMotion = usePrefersReducedMotion();
  // Either condition lands the Mac without scroll choreography.
  const staticLanded = narrow || reducedMotion;
  // Narrow: header, ticker and project list rise in once as they enter (shared
  // [data-reveal] primitive; 400ms / 12px on stacked layouts). Desktop keeps
  // its scroll-bound cinematic.
  useReveal(sectionRef, { enabled: narrow && !reducedMotion });
  const revealAttr = narrow ? "" : undefined;

  useEffect(() => {
    if (!TUNE_MODE && PIN_FREEZE == null) return;
    setTimeout(() => {
      sectionRef.current?.scrollIntoView({ block: "start" });
    }, 100);
  }, []);

  // The hold, the cine driver and the stage reveal. Skipped on the static
  // path (narrow / reduced motion: no hold exists, stack.css is gated off)
  // and in the dev freeze/tune modes. Re-runs when the path flips, so
  // crossing the breakpoint creates or tears everything down cleanly.
  // Set once the triggers have been created, so a later re-creation
  // (breakpoint round trip) knows to re-sort the trigger list.
  const createdRef = useRef(false);
  useEffect(() => {
    if (TUNE_MODE || PIN_FREEZE != null || staticLanded) return;
    const el = sectionRef.current;
    const sticky = el?.querySelector<HTMLElement>(".mac-sticky");
    if (!el || !sticky) return;
    const cine = cineRef.current;

    // Soft hold over [s0, s1] = the sticky span (id 'mac-pin': the registry
    // and data-jump-progress resolve against it; measureGeom treats it as a
    // pin). C1 engage as the sheet finishes covering About, C1 release as
    // the powered-off Mac leaves.
    const hold = softHold({ id: "mac-pin", section: el, stage: sticky });
    // Seam 3: the powered-off CRT's last dot becomes a pixel on #seam-layer
    // that lands on Work's first node (desktop, fine pointer; ./macRelay.ts).
    const stopRelay = mountMacRelay({ hold, sticky });

    // "Projects" header fade across the landing so it has cleared before the
    // CRT zoom fills the frame. Written to a CSS var (no transition on it):
    // the .is-detail-open fade owns .mac-col's own opacity, so the two never
    // fight.
    const syncHeader = (c: number) => {
      const h = headerRef.current;
      if (!h) return;
      const f = Math.min(
        1,
        Math.max(0, (c - MAC_BEATS.headFadeStart) / (MAC_BEATS.headFadeEnd - MAC_BEATS.headFadeStart)),
      );
      const v = (1 - f).toFixed(3);
      if (h.style.getPropertyValue("--mac-head-fade") !== v) {
        h.style.setProperty("--mac-head-fade", v);
      }
    };
    // Menu / footer jumps land on the landed pose. The hold length is a CSS
    // token (gate G1), so the fraction is derived from layout, not hard-coded.
    const syncJump = () => {
      const v = macJumpProgress(cine.end).toFixed(3);
      if (el.getAttribute("data-jump-progress") !== v) el.setAttribute("data-jump-progress", v);
    };
    // The cine driver: c = scroll since the section top crossed the viewport
    // bottom, in vh. The trigger runs on until the section bottom reaches the
    // viewport top (the sticky stage's bottom edge leaving), so it also owns
    // the scene's `live` gate; c itself clamps at the hold end (1 + H).
    const syncCine = (self: ScrollTrigger) => {
      const vh = window.innerHeight || 1;
      const len = Math.max(0, self.end - self.start);
      const end = Math.max(1, (len - vh) / vh);
      const c = Math.min(end, Math.max(0, (self.progress * len) / vh));
      cine.c = c;
      cine.end = end;
      if (selectedRef.current && pastPowerOff()) closeRef.current();
      const live = self.progress < 1;
      if (live !== cine.live) {
        cine.live = live;
        if (live) cine.wake?.();
      }
      syncHeader(c);
    };
    const st = ScrollTrigger.create({
      id: "mac-cine",
      trigger: el,
      start: "top bottom",
      end: "bottom top",
      invalidateOnRefresh: true,
      onUpdate: syncCine,
      onEnter: syncCine,
      onLeave: syncCine,
      onEnterBack: syncCine,
      onLeaveBack: syncCine,
      // onUpdate does not fire when a refresh moves progress (a resize
      // changes the svh hold, so the same scrollY maps to a new c). Also
      // seeds c for a trigger created mid-page.
      onRefresh: (self) => {
        syncCine(self);
        syncJump();
      },
    });

    // Click-to-zoom: the floating Mac dispatches `mac-zoom-request` (see the
    // 3D hitbox in MacintoshScene). Glide to the landed/booted CRT so a
    // pointer user can dive straight in without scrolling through the orbit.
    // Symmetric ease-in-out, duration scaled to distance (glide preset,
    // capped at CTA_MAX_DURATION_S). Normal scrolling still works; this is an
    // additive shortcut. The hold starts at c = 1.
    const onMacZoom = () => {
      const vh = window.innerHeight;
      void scrollToY(hold.st.start + (macLandedC(cine.end) - 1) * vh, {
        preset: "glide",
        mode: "smooth",
        maxDuration: CTA_MAX_DURATION_S,
      });
    };
    window.addEventListener("mac-zoom-request", onMacZoom);

    // Reveal the Mac stage once the SECTION is about to arrive, and keep it on
    // for everything below (section-relative). Same semantics as the old
    // absolute gate: on from the trigger start onward, off only when
    // scrolling back above it. Nothing needs hiding below the section because
    // the stage is clipped to its own box, and staying on means a cut INTO
    // Projects from further down (footer jump, menu, JumpToTop) never lands
    // on a CRT still fading up from opacity 0.
    const stage = el.querySelector(".mac-stage") as HTMLElement | null;
    const setStageVisible = (v: boolean) =>
      stage?.setAttribute("data-stage-visible", String(v));
    // STAGE_LEAD_VH: reveal a full viewport BEFORE the section's top reaches
    // the viewport bottom, so the stage's opacity fade (macintosh.css,
    // --t-med) finishes off screen even on a fast flick at short viewports.
    const STAGE_LEAD_VH = 1.0;
    const stageST = ScrollTrigger.create({
      trigger: el,
      start: () => `top bottom+=${Math.round(window.innerHeight * STAGE_LEAD_VH)}`,
      // "max": the range runs to the bottom of the page. Only the start edge
      // matters; onEnter/onLeaveBack below fire on it (GSAP fires onEnter
      // even when one update jumps from above the start straight to the end).
      end: "max",
      invalidateOnRefresh: true,
      onEnter: () => setStageVisible(true),
      onLeaveBack: () => setStageVisible(false),
      // Callbacks don't fire for state changes made during a refresh (layout
      // shift, resize, loader lift), so re-seed from progress there too.
      onRefresh: (s) => setStageVisible(s.progress > 0),
    });
    // Seed (refresh-at-offset, e.g. a mid-page reload).
    setStageVisible(stageST.progress > 0 || !!stageST.isActive);

    // Re-creation after a breakpoint round trip (wide -> narrow -> wide, or a
    // reduced-motion toggle): these triggers are appended AFTER the ones for
    // the sections below, so restore document order (scroll.ts domOrder),
    // then re-measure. First mount is already in DOM order, so it skips this.
    if (createdRef.current) {
      ScrollTrigger.sort();
      ScrollTrigger.refresh();
    }
    createdRef.current = true;

    // Refresh once loading-active drops: section positions shift during
    // initial layout.
    const stopLoaderWatch = refreshScrollOnLoaderLift();

    return () => {
      stopLoaderWatch();
      stageST.kill();
      st.kill();
      stopRelay();
      hold.kill();
      cine.live = true;
      // Crossing into the static-landed path must not strand a mid-fade
      // header (the var is only written while the cine exists).
      headerRef.current?.style.removeProperty("--mac-head-fade");
      window.removeEventListener("mac-zoom-request", onMacZoom);
    };
  }, [staticLanded]);

  // When we drop into the static-landed path (narrow OR reduced-motion),
  // park c on the landed pose so the 3D scene shows the booted CRT +
  // clickable tiles even though scroll never drives it.
  useEffect(() => {
    if (staticLanded && PIN_FREEZE == null && !TUNE_MODE) {
      cineRef.current.c = STATIC_LANDED_C;
      cineRef.current.end = MAC_CINE_END_DEFAULT;
      cineRef.current.live = true;
    }
    // Reduced motion on a WIDE viewport shows the landed, zoomed CRT with the
    // header still in the absolute top-right rail, where it sits over the
    // screen corner. Match the scroll path's landed frame (header faded).
    // Narrow keeps its in-flow header.
    const h = headerRef.current;
    if (h && staticLanded && !narrow) h.style.setProperty("--mac-head-fade", "0");
    else if (h && staticLanded) h.style.removeProperty("--mac-head-fade");
  }, [staticLanded, narrow]);

  // In PIN_FREEZE dev mode, lift the stage to fixed-viewport so we
  // can verify the Mac pose without fighting Lenis to scroll into
  // the (absolute-positioned) stage's slot. Pure dev affordance:
  // production paths (no ?pin=) take the normal absolute layout.
  const stageStyle: React.CSSProperties | undefined =
    PIN_FREEZE != null
      ? { position: "fixed", inset: 0, zIndex: 50 }
      : undefined;

  return (
    <section
      ref={sectionRef}
      className="portfolio-section portfolio-mac"
      // Seam layout flag: activates this section's stack.css rules (the hold,
      // the sheet, and the curtain margin once About's flag is set too).
      data-seam-stack=""
      // Menu / footer jumps land on the landed CRT (scroll.ts jumpToSection,
      // against the 'mac-pin' hold trigger). 0.797 at the shipped hold; the
      // cine driver rewrites it from layout on every refresh (gate G1).
      data-jump-progress={macJumpProgress(MAC_CINE_END_DEFAULT).toFixed(3)}
    >
      {/* The sticky stage (src/seams/stack.css makes it `position: sticky`
          on desktop; softHold eases its engage/release with `translate`).
          It holds everything that must stay put on screen while the hold
          runs: the canvas, the corner header and the CRT hotspots, which are
          placed in canvas px. The sr-only nav and the a11y detail stay
          OUTSIDE it: a translated ancestor would become the containing block
          of their position:fixed focus popups. On the narrow stacked layout
          it is display:contents, so its children keep their flex order. */}
      <div className="mac-sticky">
        {/* Stage opacity is gated by `data-stage-visible` so the canvas
            doesn't paint before the section approaches (set by the
            section-relative ScrollTrigger above, or forced on for the
            static-landed narrow/reduced-motion path). */}
        <div
          className="mac-stage"
          data-stage-visible={
            TUNE_MODE || PIN_FREEZE != null || staticLanded ? "true" : "false"
          }
          style={stageStyle}
          // The canvas content is decorative: the sr-only list above is
          // the accessible equivalent. So hide the visual stage from AT.
          aria-hidden="true"
        >
          {macMounted && (
            <Suspense fallback={null}>
              <MacintoshScene
                cineRef={cineRef}
                projects={MAC_PROJECTS}
                onSelectProject={openProject}
                selected={selected}
                onScreenRect={staticLanded ? undefined : handleScreenRect}
                hoveredControl={hoveredControl}
              />
            </Suspense>
          )}
        </div>
        {/* Editorial header fades out while a project detail is open:
            the camera dollies into the CRT and the header was left
            floating over the black screen edge in the top-right corner —
            barely legible, read as a glitch (user). */}
        <div
          ref={headerRef}
          className={`portfolio-col mac-col${selected ? " is-detail-open" : ""}`}
        >
          {/* data-reveal on the children, not .mac-col: its className
              changes with the detail view, which would drop .is-revealed. */}
          <span className="section-marker" data-reveal={revealAttr}>
            02
          </span>
          {/* No "02 / 07 · Projects" index line: the 02 marker and the title
              already say it, and the section dial shows "02 Projects" (owner:
              no redundant copy). */}
          <h2 data-reveal={revealAttr}>
            <ScrambleText text="Projects" />
          </h2>
        </div>

        {/* On-CRT controls overlay: DESKTOP ONLY. A real DOM layer
            positioned over the CRT screen so the canvas-drawn affordances
            are actually clickable. The CRT paints the visual "VIEW LIVE →"
            button + the "‹ BACK" hint; these transparent DOM elements sit on
            top at the matching spots so a pointer user clicks a genuine
            <a>/<button> after the camera dollies into the screen.

            NOT rendered on the narrow/touch path: there's no dolly-into-CRT
            on mobile, so invisible hotspots can't reliably track the painted
            labels; the mobile accordion above carries the live/source links. */}
        {selected && !staticLanded && screenRect && screenRect.vis > 0.4 && (() => {
          // Map the painted controls' canvas fractions onto the screen's
          // live on-screen rect so the real clickable hotspots sit EXACTLY
          // over their faces (the zoom is now dead-on/square, so this is
          // reliable). Fractions mirror CRT_LAYOUT + the painter in
          // MacintoshScene: title-bar height 0.135·h, content inset
          // 0.06·w, close box ~0.42·barH square top-left, live button
          // 0.085·h tall pinned bottom-left of the panel.
          const { x, y, w, h } = screenRect;
          const pad = 0.06 * w;
          const barH = 0.135 * h;
          // "← BACK" button rect (mirrors CRT_LAYOUT.backWFrac / backHFrac in the
          // painter) so the clickable hotspot + its CSS hover glow cover the whole
          // painted button.
          const backW = 0.16 * w;
          const backH = 0.56 * barH;
          const btnH = 0.085 * h;
          // BULGE COMPENSATION: the CRT shader barrel-distorts its sample
          // space (k=0.12), so painted content near the edges appears
          // pulled ~1-2% toward the screen centre relative to this flat
          // rect. Nudge each hotspot the same direction so it stays
          // centred on its painted face: close box (top-left) shifts
          // right+down, link button (bottom-left) shifts right+up.
          const bx = 0.007 * w;
          const by = 0.010 * h;
          const closeStyle: React.CSSProperties = {
            left: x + pad + bx,
            top: y + (barH - backH) / 2 + by,
            width: backW,
            height: Math.max(backH, 30),
          };
          const linkStyle: React.CSSProperties = {
            left: x + pad + bx,
            top: y + h - pad - btnH - by,
            height: Math.max(btnH, 34),
            // Match the painted CTA width exactly: the painter reports the live
            // button's width as a fraction of the screen face (linkWFrac), since it
            // varies by label. A fixed fraction overshot it by ~120px (the empty
            // box right of "VIEW DEV POST" the owner flagged); +6px forgiveness.
            width:
              (screenRect.linkWFrac && screenRect.linkWFrac > 0
                ? screenRect.linkWFrac
                : 0.26) *
                w +
              6,
          };
          return (
            <div className="mac-crt-controls" aria-hidden="true">
              <button
                ref={backBtnRef}
                type="button"
                className="mac-crt-close"
                style={closeStyle}
                onClick={closeProject}
                onPointerEnter={() => setHoveredControl("back")}
                onPointerLeave={() => setHoveredControl(null)}
                aria-label="Close project"
              />
              {(selected.liveHref || selected.repoHref) && (
                <a
                  className="mac-crt-link"
                  style={linkStyle}
                  href={(selected.liveHref || selected.repoHref)!}
                  target="_blank"
                  rel="noreferrer"
                  onPointerEnter={() => setHoveredControl("link")}
                  onPointerLeave={() => setHoveredControl(null)}
                  onClick={() =>
                    track("project_link", {
                      project: selected.title,
                      type: selected.liveHref ? "live" : "repo",
                    })
                  }
                >
                  {selected.liveHref ? liveLinkLabel(selected.liveHref) : "Source"}
                </a>
              )}
            </div>
          );
        })()}
      </div>
      <div className="mac-ticker-slot" data-reveal={revealAttr}>
        <TechStackTicker />
      </div>

      {/* MOBILE PROJECT ACCORDION (narrow only). The CRT tiles are a <canvas>
          texture clicked via a 3D raycast plane — invisible to AT and gone on a
          phone (the canvas never mounts ≤768px). So the narrow/landed path is a
          real, accessible list of projects where each row is a DISCLOSURE
          button (aria-expanded) that drops its detail open INLINE beneath it —
          no separate detail view, no Back button (user: "just make it
          dropdowns"). Mirrors the Work accordion's motion. Desktop's
          orbit/dolly cinematic owns selection there and hides this entirely. */}
      {staticLanded && (
        <ul
          className="mac-project-list mac-project-acc"
          aria-label="Projects"
          data-reveal={revealAttr}
        >
          {MAC_PROJECTS.map((p) => {
            const open = openMobileId === p.id;
            const panelId = `mac-acc-panel-${p.id}`;
            return (
              <li
                key={p.id}
                className={`mac-acc-item${open ? " is-open" : ""}`}
              >
                <button
                  type="button"
                  className="mac-project-btn mac-acc-head"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggleMobileProject(p.id)}
                >
                  <span
                    className="mac-project-swatch"
                    style={
                      p.image
                        ? {
                            backgroundImage: `url(${p.image})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }
                        : { background: p.color }
                    }
                    aria-hidden="true"
                  />
                  <span className="mac-project-text">
                    <span className="mac-project-meta">
                      {p.meta.split(" · ")[0]}
                    </span>
                    <span className="mac-project-title">{p.title}</span>
                  </span>
                  <span className="mac-acc-chevron" aria-hidden="true">
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                      <path
                        d="M6 9l5 5 5-5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="square"
                      />
                    </svg>
                  </span>
                </button>
                <div id={panelId} className="mac-acc-panel" role="region">
                  <div className="mac-acc-panel-inner">
                    <p className="mac-acc-blurb">{p.blurb}</p>
                    {p.tags.length > 0 && (
                      <ul className="mac-detail-tags">
                        {p.tags.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    )}
                    {p.liveHref && (
                      <a
                        className="mac-acc-link"
                        href={p.liveHref}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() =>
                          track("project_link", {
                            project: p.title,
                            type: "live",
                          })
                        }
                      >
                        {liveLinkLabel(p.liveHref)}{" "}
                        <span aria-hidden="true">→</span>
                      </a>
                    )}
                    {p.repoHref && (
                      <a
                        className="mac-acc-link"
                        href={p.repoHref}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() =>
                          track("project_link", {
                            project: p.title,
                            type: "repo",
                          })
                        }
                      >
                        Source <span aria-hidden="true">→</span>
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {/* Accessible, crawlable project list. The CRT tiles are painted into a
          <canvas> texture and clicked via a 3D raycast plane, so screen readers,
          keyboard users, and crawlers see none of the actual work. This
          visually-hidden (but DOM-real + focusable) list is their source of
          truth: each item LEADS with a real <a href> to the project's live
          Devpost/GitHub URL (crawlable, reachable with no JS), plus a <button>
          carrying the SAME onSelect the 3D tile fires so Tab → Enter opens the
          3D detail. Rendered AFTER the section <h2> so heading order is h2 → h3.
          Mirrors the Keypad section's sr-only social list. */}
      <nav className="sr-only" aria-label="Projects">
        <h3>Selected projects</h3>
        <ul>
          {MAC_PROJECTS.map((p) => {
            const href = p.liveHref || p.repoHref;
            return (
              <li key={p.id}>
                {href ? (
                  <a href={href}>
                    {p.title}: {p.meta}
                  </a>
                ) : (
                  <span>
                    {p.title}: {p.meta}
                  </span>
                )}{" "}
                <button type="button" onClick={() => openProject(p)}>
                  Open {p.title} detail
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      {/* Detail region. The open project is drawn into the CRT <canvas>
          texture, which is invisible to assistive tech, so the project's
          title / meta / blurb / tags + the REAL clickable live/repo link
          live here as DOM: visually hidden (the CRT is the visual surface)
          but DOM-real + focusable, surfaced only on keyboard focus.
          aria-live announces the open. On mobile the accordion above is the
          visible + accessible project detail and `selected` is never set
          there, so this stays empty. */}
      <div
        className="mac-detail-a11y"
        role="region"
        aria-live="polite"
        aria-label={selected ? `${selected.title}: project detail` : undefined}
      >
        {selected && (
          <article>
            {selected.image && (
              <img
                className="mac-detail-thumb"
                src={selected.image}
                alt=""
                aria-hidden="true"
                loading="lazy"
              />
            )}
            <p className="mac-detail-meta">{selected.meta}</p>
            <h3>{selected.title}</h3>
            <p className="mac-detail-blurb">{selected.blurb}</p>
            {selected.tags.length > 0 && (
              <ul className="mac-detail-tags">
                {selected.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}
            {selected.liveHref && (
              <a
                className="mac-detail-link"
                href={selected.liveHref}
                target="_blank"
                rel="noreferrer"
                onClick={() =>
                  track("project_link", {
                    project: selected.title,
                    type: "live",
                  })
                }
              >
                {liveLinkLabel(selected.liveHref)} <span aria-hidden="true">→</span>
              </a>
            )}
            {selected.repoHref && (
              <a
                className="mac-detail-link"
                href={selected.repoHref}
                target="_blank"
                rel="noreferrer"
                onClick={() =>
                  track("project_link", {
                    project: selected.title,
                    type: "repo",
                  })
                }
              >
                Source <span aria-hidden="true">→</span>
              </a>
            )}
          </article>
        )}
      </div>

    </section>
  );
}

