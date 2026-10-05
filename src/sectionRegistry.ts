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
  /**
   * For multi-BEAT pinned sections: the id of the section's GSAP pin
   * ScrollTrigger plus a 0..1 progress to land on. When set, a jump to this
   * section scrolls to that fraction of the pin instead of the section's top,
   * so it lands on a specific beat rather than the section's opening beat.
   * Projects uses this to land on the booted, interactive CRT.
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
  { number: "01", label: "About", selector: ".portfolio-about", pinId: "about-pin" },
  // Projects is a multi-beat GSAP-pinned section; a bare element jump lands on
  // the pinned element's CURRENT position, which is pin-START (p≈0, the float
  // beat) coming from above but pin-END (p≈1, the exit-vanish / powered-off
  // state) coming from below — so jumping back up to "Projects" showed a blank,
  // collapsed Mac. Route it through the pin like Play: land on the booted,
  // interactive CRT (0.85 is a snap rest beat, so snap doesn't fight the jump).
  {
    number: "02",
    label: "Projects",
    selector: ".portfolio-mac",
    pinId: "mac-pin",
    jumpProgress: 0.85,
  },
  { number: "03", label: "Work", selector: ".portfolio-work", pinId: "work-pin" },
  // Play is interests-only — the "Recents" photos live in their own Photos
  // section (below), so a jump lands on the section top (the 3D cluster).
  { number: "04", label: "Play", selector: ".other-pin-wrap" },
  { number: "05", label: "Honours", selector: ".portfolio-bp", pinId: "bp-pin" },
  // Recents: the photo trains, a standalone section between Honours and Contact.
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
