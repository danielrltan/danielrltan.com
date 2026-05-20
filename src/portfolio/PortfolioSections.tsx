import { Hero } from "./Hero";
import { About } from "./About";
import { Skills } from "./Skills";
import { Projects } from "./Projects";
import { Work } from "./Work";
import { Play } from "./Play";
import { Other } from "./Other";
import { Contact } from "./Contact";

/**
 * Vertical stack of scroll-driven content sections. Each section's
 * column is on the right ~50% of the viewport so the fixed 3D room
 * on the left stays visible. Hero is the only exception — empty,
 * room takes the whole viewport.
 *
 * Order: Hero → About → Skills → Projects → Work → Play → Other → Contact.
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
      <Skills />
      <Projects />
      <Work />
      <Play />
      <Other />
      <Contact />
    </main>
  );
}
