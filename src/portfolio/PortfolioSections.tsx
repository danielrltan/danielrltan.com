import { Hero } from "./Hero";
import { About } from "./About";
import { Projects } from "./Projects";
import { Experience } from "./Experience";
import { Contact } from "./Contact";

/**
 * Vertical stack of scroll-driven content sections. Each section's
 * column is on the right ~50% of the viewport so the fixed 3D room
 * on the left stays visible. The hero section is the only exception:
 * its content sits centered over the (full-width) room.
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
      <Projects />
      <Experience />
      <Contact />
    </main>
  );
}
