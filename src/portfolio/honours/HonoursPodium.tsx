import { useEffect, useRef, useState } from "react";
import { reducedMotion } from "../../motion";
import { createPodiumScene, type PodiumEntry, type PodiumScene } from "./podiumScene";

export interface HonoursEntry extends PodiumEntry {
  blurb?: string;
}

/**
 * The scroll build's shared state: the section's seam writes `p` (and pushes
 * it to `scene` when one is live); a scene that mounts late (fonts, the idle
 * gate, a low-tier remount) picks the stored p up on creation.
 */
export interface PodiumBuild {
  p: number;
  scene: PodiumScene | null;
}

/**
 * The trophy wall's 3D podium (desktop): the canvas stage plus the HTML card
 * for the hovered / selected entry. The scene is built once fonts are ready
 * (its labels are canvas textures in Offbit + Geist). It is scroll-built: the
 * section's play -> honours seam drives it through `build` (the old "start the
 * entrance when a third is on screen" observer is gone; the build IS the
 * entrance now). Reduced motion: the settled wall and its card at once.
 * `active` is the section's canvas-mount gate (useSectionCanvasMount + idle):
 * the stage box is always laid out, the WebGL context only exists while active.
 */
export function HonoursPodium({
  entries,
  active,
  build,
}: {
  entries: readonly HonoursEntry[];
  active: boolean;
  build: PodiumBuild;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState<number | null>(null);

  useEffect(() => {
    const host = stageRef.current;
    if (!host || !active) return;
    let cancelled = false;
    let scene: PodiumScene | null = null;
    const fonts = document.fonts
      ? Promise.all([document.fonts.load("700 40px Offbit"), document.fonts.load("600 20px Geist")]).catch(() => [])
      : Promise.resolve([]);
    fonts.then(() => {
      if (cancelled) return;
      const reduced = reducedMotion.value;
      scene = createPodiumScene(host, entries, { reduced, onFocus: setFocus });
      build.scene = scene;
      // Reduced motion: the settled wall and its card, no build. Otherwise the
      // stored scroll progress, applied on the scene's first frame.
      if (reduced) scene.start();
      else scene.setProgress(build.p);
    });
    return () => {
      cancelled = true;
      if (scene && build.scene === scene) build.scene = null;
      scene?.dispose();
      setFocus(null);
    };
  }, [active, entries, build]);

  const e = focus != null ? entries[focus] : null;
  return (
    <div className="bp-podium">
      <div ref={stageRef} className="bp-podium-stage" />
      <article className={`bp-podium-card${e ? "" : " is-hidden"}`} aria-live="polite">
        {e && (
          <>
            <span className="bp-podium-cat">{e.category}</span>
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
