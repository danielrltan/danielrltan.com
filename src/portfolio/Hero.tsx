import "./sections.css";
import { useScrollProgress } from "../useScrollProgress";

/** Hero is now just the room. The brand mark in RoomHUD (top-left)
 *  carries the identity — duplicating it with a giant title was loud
 *  and redundant. Only a small scroll hint lives here, and it fades
 *  out the moment the user actually starts scrolling. */
const FADE_START = 0.003;
const FADE_DONE = 0.03;

export function Hero() {
  const progress = useScrollProgress();
  const t = Math.max(
    0,
    Math.min(1, (progress - FADE_START) / (FADE_DONE - FADE_START)),
  );
  const opacity = 1 - t;
  return (
    <section className="portfolio-section portfolio-section--hero">
      <div className="scroll-hint" style={{ opacity }}>
        scroll &darr;
      </div>
    </section>
  );
}
