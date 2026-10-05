import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "../../motion";
import { createPodiumScene, type PodiumEntry } from "./podiumScene";

export interface HonoursEntry extends PodiumEntry {
  blurb?: string;
}

/**
 * The trophy wall's 3D podium (desktop): the canvas stage plus the HTML card
 * for the hovered / selected entry. The scene is built once fonts are ready
 * (its labels are canvas textures in Offbit + Geist) and its entrance plays
 * when the stage is a third on screen. `active` is the section's canvas-mount
 * gate (useSectionCanvasMount): the stage box is always laid out, the WebGL
 * context only exists while active.
 */
export function HonoursPodium({ entries, active }: { entries: readonly HonoursEntry[]; active: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<number | null>(null);

  useEffect(() => {
    const host = stageRef.current;
    if (!host || !active) return;
    let cancelled = false;
    let scene: ReturnType<typeof createPodiumScene> | null = null;
    let io: IntersectionObserver | null = null;
    const fonts = document.fonts
      ? Promise.all([document.fonts.load("700 40px Offbit"), document.fonts.load("600 20px Geist")]).catch(() => [])
      : Promise.resolve([]);
    fonts.then(() => {
      if (cancelled) return;
      scene = createPodiumScene(host, entries, { reduced: reducedMotion.value, onFocus: setFocus });
      io = new IntersectionObserver(
        (es) => {
          if (es.some((e) => e.isIntersecting)) {
            scene?.start();
            io?.disconnect();
          }
        },
        { threshold: 0.33 },
      );
      io.observe(host);
    });
    return () => {
      cancelled = true;
      io?.disconnect();
      scene?.dispose();
      setFocus(null);
    };
  }, [active, entries]);

  const e = focus != null ? entries[focus] : null;
  return (
    <div className="bp-podium">
      <div ref={stageRef} className="bp-podium-stage" />
      <article className={`bp-podium-card${e ? "" : " is-hidden"}`} aria-live="polite">
        {e && (
          <>
            <span className="bp-podium-cat">
              {e.category}
              {e.featured ? " · Headline" : ""}
            </span>
            <h3 className="bp-podium-title">{e.title}</h3>
            {e.metric && <span className="bp-podium-metric">{e.metric}</span>}
            {e.context && <span className="bp-podium-ctx">{e.context}</span>}
            {e.blurb && <p className="bp-podium-blurb">{e.blurb}</p>}
          </>
        )}
      </article>
    </div>
  );
}
