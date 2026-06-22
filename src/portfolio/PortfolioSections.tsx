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
 */
export function PortfolioSections() {
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
}
