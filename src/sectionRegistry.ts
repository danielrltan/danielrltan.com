/**
 * Shared section registry — the single source of truth for the page's
 * section list, used by BOTH the StatusBar (active-section readout + the
 * resting nav card) and the CrtChannelMenu (the "channel guide" the card
 * opens into). Lifted out of StatusBar.tsx so the menu can import it
 * without reaching into a component module.
 *
 * Keep the order in lockstep with PortfolioSections.tsx render order.
 */

export interface SectionEntry {
  number: string;
  label: string;
  /** Selector to identify the section in the DOM. */
  selector: string;
}

export const SECTION_REGISTRY: SectionEntry[] = [
  { number: "00", label: "Hero", selector: ".portfolio-section--hero" },
  { number: "01", label: "About", selector: ".portfolio-section:not([class*='--'])" },
  { number: "02", label: "Stack", selector: ".portfolio-mac" },
  { number: "03", label: "Work", selector: ".portfolio-work" },
  { number: "04", label: "Play", selector: ".portfolio-other" },
  { number: "05", label: "Bits and pieces", selector: ".portfolio-bp" },
  { number: "06", label: "Contact", selector: ".keypad-section" },
];

/**
 * Resolve each registry entry to its live DOM element. The About entry
 * (index 1) is the first generic `.portfolio-section` with no modifier
 * class; a selector-based match would clash with the other sections'
 * own classes, so it's special-cased.
 */
export function findSectionElements(): Array<{
  entry: SectionEntry;
  el: Element | null;
}> {
  return SECTION_REGISTRY.map((entry, i) => {
    if (i === 1) {
      const all = Array.from(document.querySelectorAll(".portfolio-section"));
      const generic = all.filter(
        (e) =>
          !e.classList.contains("portfolio-section--hero") &&
          !e.classList.contains("portfolio-mac") &&
          !e.classList.contains("portfolio-work") &&
          !e.classList.contains("portfolio-other") &&
          !e.classList.contains("portfolio-bp") &&
          !e.classList.contains("keypad-section"),
      );
      return { entry, el: generic[0] ?? null };
    }
    return { entry, el: document.querySelector(entry.selector) };
  });
}
