import { lazy, Suspense, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
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
import { useMacNarrow } from "../macintosh/useMacNarrow";

gsap.registerPlugin(ScrollTrigger);

// Honour the OS "reduce motion" preference. When set we skip the GSAP
// pin + the scroll-driven orbit/dolly/boot cinematic entirely and park
// the Mac in its LANDED state (pinProgress = 1) so users who opt out of
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
 * Stack + Projects section. GSAP-pinned for ~2 viewports; pin progress
 * drives the Mac's descent + CRT boot + desktop reveal inside
 * MacintoshScene. Pin progress writes into a ref so the 3D scene can
 * interpolate smoothly on fast scroll.
 */

// Three-beat choreography needs breathing room: STACK (0.00→0.22),
// ORBIT (0.22→0.55), LAND+EXPLORE (0.55→1.00).
// Bumped 1800 → 2600 → 6200px, then trimmed to 5400: at 6200 the
// entry beat (floating cards) demanded ~1360px of scroll before
// anything committed, which read as the section refusing the wheel
// (user: stubborn at first, too much to give it). 5400 keeps the
// scroll-lock property — a single hard flick still can't clear the
// pin, the nearest-beat snap still settles every rest on a composed
// pose — while shaving ~13% off every beat's scroll cost (entry beat
// ~1360 → ~1190px).
const PIN_DURATION_PX = 5400;

// ?tune=mac skips the pin so OrbitControls inside MacintoshScene can
// drive the camera freely for re-framing.
const TUNE_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("tune") === "mac";

// ?pin=<0..1> parks pinProgress at a fixed value WITHOUT pinning the
// section: useful for QA-ing a specific beat (e.g. ?pin=0.10 to see
// the float pose, ?pin=0.85 to see the landed CRT) without having to
// scroll through the full pin window. Differs from ?tune=mac in that
// the orbit + Mac choreography STILL animates (it just reads from
// this static value), so what you see is exactly what the user sees
// at that scroll depth. Ignored if not in [0,1]; falls through to
// real scroll-driven progress.
const PIN_FREEZE: number | null = (() => {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("pin");
  if (raw == null) return null;
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v < 0 || v > 1) return null;
  return v;
})();

export function Macintosh() {
  const sectionRef = useRef<HTMLElement>(null);
  // Canvas mounts unconditionally: IO-gated mount lost the first
  // pass when the section was scrolled past before the canvas spun up
  // (Keypad hit the same bug). The GLB is preloaded at module scope.
  const pinProgressRef = useRef(
    TUNE_MODE ? 1 : PIN_FREEZE != null ? PIN_FREEZE : 0,
  );
  // The open project. Selecting one (3D tile click OR the accessible
  // project buttons) dollies the camera INTO the CRT and swaps the
  // screen to the project DETAIL view. There is no longer a side
  // drawer; the CRT IS the detail view. Clearing it (ESC / BACK) pulls
  // the camera back out to the tile grid.
  const [selected, setSelected] = useState<MacProject | null>(null);
  // On-screen rect of the CRT screen face, projected by the 3D scene each
  // throttled tick. Positions the real clickable close + live controls
  // EXACTLY over their painted faces now that the detail-zoom lands
  // dead-on/square. Desktop only; null when no project is open / not
  // zoomed. Stored as a ref-mirror in state only when it changes enough
  // to matter (the scene already throttles to ~30Hz).
  const [screenRect, setScreenRect] = useState<ScreenRect | null>(null);
  // The element that had focus when the project was opened, so we can
  // restore focus to it on close WITHOUT scrolling the pinned page
  // (preventScroll). Clicking a 3D tile leaves focus on <body>.
  const openerFocusRef = useRef<HTMLElement | null>(null);
  // Real DOM "BACK" button rendered over the CRT (desktop) while a
  // project is open: focused on open so keyboard users land on a control
  // inside the (canvas-invisible) detail view, and ESC-reachable.
  const backBtnRef = useRef<HTMLButtonElement>(null);
  // Narrow/touch path's VISIBLE back button (inside the detail panel).
  // Focused on open instead of backBtnRef when the desktop CRT hotspot
  // isn't rendered, so the focus lands on a real, on-screen control.
  const narrowBackBtnRef = useRef<HTMLButtonElement>(null);

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
        Math.abs(prev.vis - next.vis) < 0.01
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
    openerFocusRef.current = document.activeElement as HTMLElement | null;
    setSelected(p);
    // NARROW: the detail renders ON the CRT, which sits ABOVE the tap
    // list in the stacked layout — often scrolled out of view when the
    // user taps a row. Without this, a successful tap looked like
    // "nothing happened, the list just vanished" (the reported broken
    // OPEN buttons, together with the pointer-events fix in the CSS).
    if (staticLanded) {
      const stage = sectionRef.current?.querySelector(".mac-stage");
      const reduce = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      stage?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "center",
      });
    }
  };
  // Centralised close: clear the project, then restore focus to the
  // opener with preventScroll. THE JITTER FIX: a bare prevFocus.focus()
  // on an sr-only (off-screen, clipped) project button forces the
  // browser to SCROLL the page to reveal it; on a GSAP-pinned section
  // that jolts the pin → the reported open/ESC jitter. preventScroll
  // restores focus without moving the scroll position.
  const closeProject = () => {
    setSelected(null);
    setScreenRect(null);
    const prev = openerFocusRef.current;
    openerFocusRef.current = null;
    if (prev && typeof prev.focus === "function") {
      prev.focus({ preventScroll: true });
    }
  };

  // ESC closes the open project (camera pulls back to the tile grid).
  // Also move focus onto the on-CRT BACK button when a project opens so
  // keyboard users have a control inside the detail view: focused with
  // preventScroll so opening never scrolls the pinned page either.
  useEffect(() => {
    if (!selected) return;
    // Defer so the button is mounted before we focus it. On the narrow
    // path the desktop CRT hotspot isn't rendered: focus the VISIBLE
    // in-panel back button instead so keyboard/AT focus lands on a real,
    // on-screen control rather than nothing.
    const id = requestAnimationFrame(() => {
      const target = narrowBackBtnRef.current ?? backBtnRef.current;
      target?.focus({ preventScroll: true });
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
  // ≤900px: skip the GSAP pin + orbit choreography. The section becomes
  // a normal-flow vertical stack (header → ticker → landed Mac) and the
  // 3D scene reads a fixed landed progress instead of scroll. Keeping
  // the pin alive here would lock scroll over an unpinnable auto-height
  // flex column and re-introduce the blank-canvas bug.
  const narrow = useMacNarrow();
  // Reduced-motion users get the same "no cinematic, land it now" path
  // as narrow viewports: the scene reads progress=1 and the pin never
  // engages.
  const reducedMotion = usePrefersReducedMotion();
  // Either condition lands the Mac without scroll choreography.
  const staticLanded = narrow || reducedMotion;

  useEffect(() => {
    if (!TUNE_MODE && PIN_FREEZE == null) return;
    setTimeout(() => {
      sectionRef.current?.scrollIntoView({ block: "start" });
    }, 100);
  }, []);

  // GSAP ScrollTrigger pin. Skipped at narrow widths (stacked layout)
  // and in the dev freeze/tune modes. Re-runs when `narrow` flips so
  // crossing the breakpoint creates or tears down the pin cleanly.
  useEffect(() => {
    if (TUNE_MODE || PIN_FREEZE != null || staticLanded) return;
    const el = sectionRef.current;
    if (!el) return;
    const st = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: `+=${PIN_DURATION_PX}`,
      pin: true,
      pinSpacing: true,
      // Rate-limit: numeric scrub (~1s catch-up lerp) instead of scrub:true
      // (instant 1:1) so a flick eases through the boot/orbit/land cinematic
      // instead of teleporting; the snap below still settles on release.
      scrub: 1,
      anticipatePin: 1,
      // Snap & settle on the NEAREST beat. Beats: STACK 0.00→0.22,
      // ORBIT 0.22→0.55, LAND+EXPLORE 0.55→1.00 (0.9 = booted CRT with
      // a buffer before release). The previous binary snap
      // (`value < 0.18 ? 0 : 0.9`) teleported ~4500px the moment a
      // settle landed past 18% of the pin — skipping the entire
      // stack/orbit/boot cinematic and dumping the user on the project
      // tiles (user: "broken, it just jumps to the photo part").
      // Snapping to the nearest beat keeps the scroll-lock intent (the
      // 6200px pin still can't be cleared in one flick, and every
      // settle lands on a meaningful pose) without ever leaping more
      // than ~one beat. Snap still fires only after wheel/touch
      // velocity drops, so a deliberate sustained scroll plays the
      // full cinematic and carries on through the release.
      snap: {
        snapTo: [0, 0.22, 0.55, 0.9],
        duration: { min: 0.3, max: 0.8 },
        delay: 0.04,
        ease: "power2.inOut",
      },
      onUpdate: (self) => {
        pinProgressRef.current = self.progress;
      },
    });

    // Reveal the Mac stage right after the room fade-out window in
    // App.tsx (ROOM_FADE_OUT_END_VH) so the two scenes never overlap.
    const stage = el.querySelector(".mac-stage") as HTMLElement | null;
    const ticker = el.querySelector(".mac-ticker-slot") as HTMLElement | null;
    const STAGE_REVEAL_VH = 2.25;
    let raf = 0;
    let lastVisible = false;
    const updateStageVisibility = () => {
      const vh = window.innerHeight || 1;
      const ratio = window.scrollY / vh;
      const visible = ratio >= STAGE_REVEAL_VH;
      if (visible !== lastVisible) {
        lastVisible = visible;
        if (stage) {
          stage.setAttribute("data-stage-visible", visible ? "true" : "false");
        }
        if (ticker) {
          ticker.setAttribute("data-stage-visible", visible ? "true" : "false");
        }
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateStageVisibility);
    };
    updateStageVisibility();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });

    // Refresh once loading-active drops: pin positions shift during
    // initial layout.
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
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [staticLanded]);

  // When we drop into the static-landed path (narrow OR reduced-motion),
  // park the pin progress at the landed value so the 3D scene shows the
  // booted CRT + clickable tiles even though scroll never drives it.
  useEffect(() => {
    if (staticLanded && PIN_FREEZE == null && !TUNE_MODE) {
      pinProgressRef.current = 1;
    }
  }, [staticLanded]);

  // In PIN_FREEZE dev mode, lift the stage to fixed-viewport so we
  // can verify the Mac pose without fighting Lenis to scroll into
  // the (absolute-positioned) stage's slot. Pure dev affordance:
  // production paths (no ?pin=) take the normal absolute layout.
  const stageStyle: React.CSSProperties | undefined =
    PIN_FREEZE != null
      ? { position: "fixed", inset: 0, zIndex: 50 }
      : undefined;

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-mac">
      {/* Accessible, crawlable project list. The CRT tiles are painted
          into a <canvas> texture and clicked via a 3D raycast plane, so
          screen readers, keyboard users, and search crawlers see NOTHING
          of the actual work. This visually-hidden (but DOM-real and
          focusable) list is the source of truth for those users: a real
          <button> per project carrying the SAME onSelect the 3D tile
          fires, so Tab → Enter opens a project with no pointer needed.
          Mirrors the Keypad section's sr-only social list. */}
      <nav className="sr-only" aria-label="Projects">
        <h3>Selected projects</h3>
        <ul>
          {MAC_PROJECTS.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => openProject(p)}>
                {p.title}: {p.meta}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Stage opacity is gated by `data-stage-visible` so the canvas
          doesn't peek into the About section above before the pin
          engages (set true by the scrollY listener above, or forced on
          for the static-landed narrow/reduced-motion path). */}
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
        <Suspense fallback={null}>
          <MacintoshScene
            pinProgressRef={pinProgressRef}
            projects={MAC_PROJECTS}
            onSelectProject={openProject}
            selected={selected}
            onCloseProject={closeProject}
            onScreenRect={staticLanded ? undefined : handleScreenRect}
          />
        </Suspense>
      </div>
      <div
        className="mac-ticker-slot"
        data-stage-visible={
          TUNE_MODE || PIN_FREEZE != null || staticLanded ? "true" : "false"
        }
      >
        <TechStackTicker />
      </div>

      {/* MOBILE TAP PATH (narrow only). The CRT tiles are a <canvas>
          texture clicked via a 3D raycast plane; on a phone each tile is
          a small, hover-less, fiddly hit area, and the canvas is invisible
          to AT. So on the narrow/landed path we render a REAL, VISIBLE list
          of large project buttons beneath the Mac: each ≥44px, carrying the
          SAME openProject the 3D tile fires, with a touch active-state (no
          hover dependency). This is the primary, reliable way to open a
          project on touch; the 3D raycast stays as a secondary nicety. The
          desktop orbit/dolly path hides this entirely (display:none) so the
          cinematic is untouched. Hidden once a project is open so it doesn't
          compete with the in-CRT detail view + control bar. */}
      {staticLanded && !selected && (
        <ul className="mac-project-list" aria-label="Projects">
          {MAC_PROJECTS.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="mac-project-btn"
                onClick={() => openProject(p)}
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
                <span className="mac-project-open" aria-hidden="true">
                  Open
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {/* Editorial header fades out while a project detail is open:
          the camera dollies into the CRT and the header was left
          floating over the black screen edge in the top-right corner —
          barely legible, read as a glitch (user). */}
      <div
        className={`portfolio-col mac-col${selected ? " is-detail-open" : ""}`}
      >
        <span className="section-marker">02</span>
        <span className="section-index">02 / 06 &middot; Stack + Projects</span>
        <h2>
          <ScrambleText text="Projects" />
        </h2>
      </div>
      {/* Detail region. The open project is drawn into the CRT <canvas>
          texture, which is invisible to assistive tech, so the project's
          title / meta / blurb / tags + the REAL clickable live/repo link
          live here as DOM. aria-live announces the open.

          DESKTOP: visually hidden (the CRT is the visual surface) but
          DOM-real + focusable: surfaced only on keyboard focus.

          NARROW/TOUCH: made VISIBLE (see .mac-detail-a11y[data-narrow] in
          the CSS). On a phone the in-CRT canvas text is small and the
          camera does NOT dolly into the screen, so this real DOM panel is
          the legible, readable presentation of the work; the CRT just
          shows the matching framed view behind it. The BACK + live/source
          controls render as large ≥44px buttons here on narrow. */}
      <div
        className="mac-detail-a11y"
        data-narrow={staticLanded ? "true" : undefined}
        role="region"
        aria-live="polite"
        aria-label={selected ? `${selected.title}: project detail` : undefined}
      >
        {selected && (
          <article>
            {/* Visible-on-narrow BACK control, leading the panel so the
                primary "get out" action is the first thing a thumb meets.
                On desktop this whole panel is clipped, so the BACK button
                that keyboard/pointer users actually hit is the transparent
                CRT hotspot below; here it's a real, large, labelled
                control for touch. */}
            {staticLanded && (
              <button
                ref={narrowBackBtnRef}
                type="button"
                className="mac-detail-back"
                onClick={closeProject}
              >
                <span aria-hidden="true">‹</span> Back to projects
              </button>
            )}
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
              >
                Source <span aria-hidden="true">→</span>
              </a>
            )}
          </article>
        )}
      </div>

      {/* On-CRT controls overlay: DESKTOP ONLY. A real DOM layer
          positioned over the CRT screen so the canvas-drawn affordances
          are actually clickable. The CRT paints the visual "VIEW LIVE →"
          button + the "‹ BACK" hint; these transparent DOM elements sit on
          top at the matching spots so a pointer user clicks a genuine
          <a>/<button> after the camera dollies into the screen.

          NOT rendered on the narrow/touch path: there's no dolly-into-CRT
          on mobile, so invisible hotspots can't reliably track the painted
          labels. Narrow instead gets the VISIBLE, large BACK + live/source
          controls inside the .mac-detail-a11y[data-narrow] panel above. */}
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
        const closeSz = 0.42 * barH;
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
          top: y + (barH - closeSz) / 2 + by,
          width: Math.max(closeSz, 30),
          height: Math.max(closeSz, 30),
        };
        const linkStyle: React.CSSProperties = {
          left: x + pad + bx,
          top: y + h - pad - btnH - by,
          height: Math.max(btnH, 34),
          minWidth: 132,
        };
        return (
          <div className="mac-crt-controls" aria-hidden="true">
            <button
              ref={backBtnRef}
              type="button"
              className="mac-crt-close"
              style={closeStyle}
              onClick={closeProject}
              aria-label="Close project"
            />
            {(selected.liveHref || selected.repoHref) && (
              <a
                className="mac-crt-link"
                style={linkStyle}
                href={(selected.liveHref || selected.repoHref)!}
                target="_blank"
                rel="noreferrer"
              >
                {selected.liveHref ? liveLinkLabel(selected.liveHref) : "Source"}
              </a>
            )}
          </div>
        );
      })()}
    </section>
  );
}

