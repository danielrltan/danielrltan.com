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
  /** Selector to identify the section in the DOM. Always an IN-FLOW element, never a sticky one. */
  selector: string;
  /**
   * For sections that HOLD (a sticky stage over a span of scroll): the id of
   * the section's hold trigger (src/seams/softHold.ts: a NON-pinning
   * ScrollTrigger over the sticky span; the ids are the ones the old GSAP pins
   * used, which also still resolve while a section has not migrated) plus a
   * 0..1 progress to land on. When set, a jump to this section scrolls to that
   * fraction of the hold instead of the section's top, so it lands on a
   * specific beat rather than the section's opening beat.
   *
   * jumpToSection() (src/scroll.ts) resolves the landing progress as
   * `data-jump-progress` on the SECTION ELEMENT first, then this registry
   * `jumpProgress`: the attribute wins, so an owner can move the landing beat
   * in the same change as their beat map. A `pinId` whose ScrollTrigger isn't
   * registered (yet), or no progress at all, falls back to the element top.
   */
  pinId?: string;
  jumpProgress?: number;
}

// Canonical section labels — the owner's short names for the index, used by the
// dial readout AND the spill menu (both read this registry). Keep these EXACT;
// do NOT expand them to the longer section-eyebrow phrasings.
export const SECTION_REGISTRY: SectionEntry[] = [
  { number: "00", label: "Hero", selector: ".portfolio-section--hero" },
  // About no longer holds: it stays still under the rising Projects sheet
  // (seam about -> projects), so a jump lands on its doc top, the parked,
  // finished dashboard.
  { number: "01", label: "About", selector: ".portfolio-about" },
  // Projects holds on the Mac. A bare element jump would land on the hold's
  // opening beat; the section's data-jump-progress (Macintosh.tsx) lands on
  // the booted, interactive CRT instead.
  { number: "02", label: "Projects", selector: ".portfolio-mac", pinId: "mac-pin" },
  // Work is natural height (no hold): a jump lands on its top.
  { number: "03", label: "Work", selector: ".portfolio-work" },
  // Play is interests-only — the "Recents" photos live in their own Photos
  // section (below), so a jump lands on the section top (the 3D cluster).
  { number: "04", label: "Play", selector: ".other-pin-wrap" },
  { number: "05", label: "Honours", selector: ".portfolio-bp", pinId: "bp-pin" },
  // Recents: the photo plane, a standalone section between Honours and Contact.
  { number: "06", label: "Recents", selector: ".portfolio-photos", pinId: "photos-pin" },
  { number: "07", label: "Contact", selector: ".keypad-section", pinId: "keypad-pin" },
];

/** Resolve each registry entry to its live DOM element. */
export function findSectionElements(): Array<{
  entry: SectionEntry;
  el: Element | null;
}> {
  return SECTION_REGISTRY.map((entry) => ({
    entry,
    el: document.querySelector(entry.selector),
  }));
}
