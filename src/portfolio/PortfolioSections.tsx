import { memo } from "react";
import { Hero } from "./Hero";
import { About } from "./About";
import { Macintosh } from "./Macintosh";
import { Work } from "./Work";
import { Other } from "./Other";
import { BitsAndPieces } from "./BitsAndPieces";
import { Photos } from "./Photos";
import { SectionTransition } from "./SectionTransition";
import { Keypad } from "./Keypad";
import { Footer } from "./Footer";

/**
 * Hero → About → Macintosh → Work → Other(Play) → BitsAndPieces(Honors) →
 * Photos → SectionTransition → Keypad(Contact) → Footer.
 *
 * pointer-events:none on the container so the 3D canvas underneath
 * stays interactive. Individual sections re-enable pointer events on
 * their own elements.
 *
 * THE STACK (section seams, src/seams/stack.css). Every child is an in-flow
 * section root (the registry selectors, ScrollTrigger triggers and jump
 * targets are never sticky). A section that holds is a tall root with an inner
 * `position: sticky` stage (`*-hold` / `.mac-sticky`) instead of a GSAP pin,
 * and two seams overlap neighbours as a moving sheet: Projects rises over a
 * still About (z 0 under z 1), and the footer rides over the stuck keypad.
 * The DOM order here IS the stack order: stack.css pairs neighbours with the
 * adjacent-sibling combinator, so keep About directly before Macintosh and
 * Keypad directly before Footer. Each section switches its part of the stack
 * on with a static `data-seam-stack` attribute. The one fixed cross-section
 * overlay, #seam-layer, is App.tsx's sibling of this <main>.
 */
// memo: takes no props, so App's own state flips (the keypad cursor-hover
// mirror, HUD reveal) no longer re-render every section and its canvases.
export const PortfolioSections = memo(function PortfolioSections() {
  return (
    <main
      style={{
        position: "relative",
        zIndex: 10,
        pointerEvents: "none",
      }}
    >
      <Hero />
      <About />
      <Macintosh />
      <Work />
      <Other />
      <BitsAndPieces />
      <Photos />
      <SectionTransition />
      <Keypad />
      <Footer />
    </main>
  );
});
