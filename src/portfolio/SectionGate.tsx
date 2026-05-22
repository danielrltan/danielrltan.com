import { useEffect, useState } from "react";
import "./section-gate.css";

/**
 * Full-viewport scroll-driven "curtain" that fills the gap between
 * the About room scene and the Macintosh section, hiding the
 * transition seam between two heavy 3D scenes with a deliberate
 * typographic moment.
 *
 * Behaviour (anchored to viewport units, not scrollProgress, so
 * section-height changes don't shift the window):
 *
 *   < ENTER_START_VH   : invisible, no transform.
 *   ENTER_START..ENTER_END :
 *     The curtain slides UP from below the fold. By ENTER_END it
 *     fully covers the viewport.
 *   ENTER_END..HOLD_END :
 *     Fully visible — short dwell so the user reads the big
 *     section title.
 *   HOLD_END..EXIT_END :
 *     Slides UP and out the top. By EXIT_END it's gone, the
 *     Macintosh scene is fully visible behind.
 *   > EXIT_END         : invisible.
 *
 * The HUD (z-index 9999) and section content keep their hit testing
 * — the curtain is pointer-events:none and sits at z-index 6.
 */

const ENTER_START_VH = 1.55;
const ENTER_END_VH = 1.85;
const HOLD_END_VH = 1.95;
const EXIT_END_VH = 2.20;

type Phase = "before" | "entering" | "hold" | "exiting" | "after";

interface GateState {
  /** Visual transform progress for the curtain panel itself (0..1..0). */
  panelY: number;
  /** Opacity of the curtain's contents (title text). */
  contentOpacity: number;
  phase: Phase;
}

function compute(vhRatio: number): GateState {
  if (vhRatio < ENTER_START_VH) {
    return { panelY: 1, contentOpacity: 0, phase: "before" };
  }
  if (vhRatio < ENTER_END_VH) {
    const t = (vhRatio - ENTER_START_VH) / (ENTER_END_VH - ENTER_START_VH);
    // easeOutCubic — curtain DECELERATES into place.
    const eased = 1 - Math.pow(1 - t, 3);
    return { panelY: 1 - eased, contentOpacity: eased, phase: "entering" };
  }
  if (vhRatio < HOLD_END_VH) {
    return { panelY: 0, contentOpacity: 1, phase: "hold" };
  }
  if (vhRatio < EXIT_END_VH) {
    const t = (vhRatio - HOLD_END_VH) / (EXIT_END_VH - HOLD_END_VH);
    // easeInCubic — accelerates out the top.
    const eased = Math.pow(t, 3);
    return { panelY: -eased, contentOpacity: 1 - t, phase: "exiting" };
  }
  return { panelY: -1, contentOpacity: 0, phase: "after" };
}

export function SectionGate() {
  const [state, setState] = useState<GateState>(() =>
    compute(typeof window === "undefined" ? 0 : window.scrollY / Math.max(1, window.innerHeight)),
  );

  useEffect(() => {
    let raf = 0;
    const update = () => {
      const vhRatio = window.scrollY / Math.max(1, window.innerHeight);
      setState((prev) => {
        const next = compute(vhRatio);
        // Cheap shallow compare — only re-render when something
        // perceptibly changed.
        if (
          Math.abs(prev.panelY - next.panelY) < 0.001 &&
          Math.abs(prev.contentOpacity - next.contentOpacity) < 0.005 &&
          prev.phase === next.phase
        ) {
          return prev;
        }
        return next;
      });
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  if (state.phase === "before" || state.phase === "after") return null;

  return (
    <div
      aria-hidden
      className="section-gate"
      style={{
        transform: `translate3d(0, ${state.panelY * 100}%, 0)`,
      }}
    >
      <div
        className="section-gate-inner"
        style={{ opacity: state.contentOpacity }}
      >
        <div className="section-gate-grid">
          <span className="section-gate-eyebrow">02 / 06</span>
          <h2 className="section-gate-title">
            The <em>stack</em>.
          </h2>
          <span className="section-gate-meta">
            React · TypeScript · Three.js · Blender · Python · FastAPI &middot;
            and one tiny Macintosh
          </span>
        </div>
        <div className="section-gate-rule" aria-hidden />
      </div>
    </div>
  );
}
