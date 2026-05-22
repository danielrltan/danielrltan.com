import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./sections.css";
import "./macintosh.css";
import { MacintoshScene } from "../macintosh/MacintoshScene";
import { TechStackTicker } from "../macintosh/TechStackTicker";
import { MAC_PROJECTS, type MacProject } from "../macintosh/projects";

gsap.registerPlugin(ScrollTrigger);

/**
 * Skills + Projects merged into one cinematic section.
 *
 * Section is GSAP-pinned (same machinery as Keypad) for ~2 viewports
 * of scroll. The pin progress drives a 5-beat sequence:
 *
 *   0.00 – 0.20  Orbit of skill logos around an empty point. Mac
 *                hovers in upper-left, dormant.
 *   0.20 – 0.42  Mac descends to a plane at the orbit's center,
 *                landing softly.
 *   0.42 – 0.52  CRT lights up with a brief boot sequence.
 *   0.52 – 0.62  Desktop appears: a grid of project tiles inside
 *                the CRT, rendered as an HTML overlay.
 *   0.55 – 0.75  Logos disintegrate (pixel-fade) so the user's
 *                attention is on the screen, not the orbit.
 *   0.75 – 1.00  Mac sits with the desktop visible. Clicking a
 *                project opens a side card.
 *
 * The 5 beats are read by MacintoshScene each frame; the pin's
 * onUpdate callback writes pin progress into a ref so the 3D scene
 * can interpolate smoothly even when scroll is fast.
 */

// Pin duration — 2 viewports of scroll. Matches the existing Keypad
// pin's pacing.
const PIN_DURATION_PX = 1800;

export function Macintosh() {
  const sectionRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(false);
  // Pin progress 0..1 — written by GSAP, read each frame by the 3D
  // scene. Using a ref (not state) so progress updates don't re-render
  // the React tree.
  const pinProgressRef = useRef(0);
  // Project click → expand side card. State so we re-render the card
  // overlay on selection change.
  const [selected, setSelected] = useState<MacProject | null>(null);

  // Lazy-mount the 3D canvas via IO so the GLB / shader compile is
  // deferred until the user approaches. Same pattern as Keypad.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || mounted) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setMounted(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted]);

  // GSAP ScrollTrigger pin.
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
      onUpdate: (self) => {
        pinProgressRef.current = self.progress;
      },
    });

    // Reveal the Mac stage RIGHT WHEN the SectionGate curtain is
    // fully covering the viewport — that way the canvas is in place
    // behind the curtain, and when the curtain slides off the user
    // sees the Mac already rendered. Use a scrollY listener tied to
    // the same vh thresholds the SectionGate uses (1.85vh = curtain
    // fully holds) so the timing stays in lockstep.
    const stage = el.querySelector(".mac-stage") as HTMLElement | null;
    const ticker = el.querySelector(".mac-ticker-slot") as HTMLElement | null;
    // Sync with the room fade-out window in App.tsx
    // (ROOM_FADE_OUT_END_VH = 2.30). Mac elements reveal RIGHT AFTER
    // the room is fully gone, so there's never a moment where the
    // two scenes overlap.
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

    // Refresh when loading-active is removed (same as Keypad — pin
    // positions can shift during initial layout).
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
  }, []);

  return (
    <section ref={sectionRef} className="portfolio-section portfolio-mac">
      {/* Stage is opacity-gated by the section's `data-stage-visible`
          attribute (toggled by GSAP onToggle when the pin engages).
          Before the pin engages, the stage is hidden — otherwise the
          orbiting logos peek out into the About section above as the
          user scrolls through the gap between About and the pin
          start. The visual seam is owned by the SectionGate curtain
          (see src/portfolio/SectionGate.tsx). */}
      <div className="mac-stage" data-stage-visible="false">
        {mounted && (
          <MacintoshScene
            pinProgressRef={pinProgressRef}
            projects={MAC_PROJECTS}
            onSelectProject={setSelected}
          />
        )}
      </div>
      {/* Flat tech-stack scroller — same visibility gate as the
          mac-stage above. Without this the ticker was visible at the
          top of the section while the user was still scrolling through
          About, bleeding into the About viewport. The wrapper div
          is opacity-controlled by the same `data-stage-visible`
          attribute that gates the canvas. */}
      <div className="mac-ticker-slot" data-stage-visible="false">
        <TechStackTicker />
      </div>
      <div className="portfolio-col mac-col">
        <span className="section-marker">02</span>
        <span className="section-index">02 / 06 &middot; Stack + Projects</span>
        <h2>The kit.</h2>
        <p className="mac-blurb">
          Stack on the left, scroll to boot it up. Project tiles open
          on the right.
        </p>
      </div>
      {selected && (
        <>
          <div
            className="mac-detail-backdrop"
            onClick={() => setSelected(null)}
            aria-hidden
          />
          <ProjectDetailCard
            project={selected}
            onClose={() => setSelected(null)}
          />
        </>
      )}
    </section>
  );
}

function ProjectDetailCard({
  project,
  onClose,
}: {
  project: MacProject;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="mac-detail" role="dialog" aria-modal="true">
      <button
        className="mac-detail-close"
        onClick={onClose}
        aria-label="Close"
      >
        ×
      </button>
      <div className="mac-detail-meta">{project.meta}</div>
      <h3 className="mac-detail-title">{project.title}</h3>
      <p className="mac-detail-blurb">{project.blurb}</p>
      <div className="mac-detail-tags">
        {project.tags.map((t) => (
          <span key={t} className="mac-detail-tag">
            {t}
          </span>
        ))}
      </div>
      <div className="mac-detail-links">
        {project.liveHref && (
          <a href={project.liveHref} target="_blank" rel="noreferrer">
            Live &rarr;
          </a>
        )}
        {project.repoHref && (
          <a href={project.repoHref} target="_blank" rel="noreferrer">
            GitHub &rarr;
          </a>
        )}
      </div>
    </div>
  );
}
