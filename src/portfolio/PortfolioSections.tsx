import { Hero } from "./Hero";
import { About } from "./About";
import { Macintosh } from "./Macintosh";
import { Work } from "./Work";
import { Other } from "./Other";
import { BitsAndPieces } from "./BitsAndPieces";
import { Keypad } from "./Keypad";
import { Footer } from "./Footer";

/**
 * Vertical stack of scroll-driven content sections + footer.
 * Each section is its own object in the curiosity-cabinet design.
 *
 * Order: Hero → About → Macintosh (Stack+Projects) → Work →
 *        Other (Hobbies) → BitsAndPieces → Keypad (Contact) → Footer.
 *
 * SectionTransition (the marquee bridge) was removed — it was a
 * full-width pixel-font marquee positioned just above Keypad, and
 * its 35vh height + relative position was overlapping the pinned
 * Keypad section as the user scrolled (the marquee scrolled into
 * view while the keypad was still pinned, drawing a horizontal
 * band across the live keypad). The Keypad's own contact card
 * ("Let's connect / hello@danielrltan.com") already carries the
 * social-CTA the marquee was teasing, so removing the bridge
 * doesn't lose any information.
 */
export function PortfolioSections() {
  return (
    <main
      style={{
        position: "relative",
        zIndex: 10,
        // pointer-events:none on the container so the 3D canvas under
        // it stays interactive in its left-half region. Individual
        // section content re-enables pointer events on its own elements.
        pointerEvents: "none",
      }}
    >
      <Hero />
      <About />
      <Macintosh />
      <Work />
      <Other />
      <BitsAndPieces />
      <Keypad />
      <Footer />
    </main>
  );
}
