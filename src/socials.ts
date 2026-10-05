/**
 * Single source of truth for the four social destinations. Read by the
 * Contact section's accessible list + mobile chips (Keypad.tsx) and by the
 * 3D keycaps (KeypadModel.tsx), so the links can't drift apart.
 */
export interface Social {
  label: string;
  /** Accessible name announced to screen readers. */
  aria: string;
  href: string;
  /** Short host shown under the label on the mobile chips. */
  host: string;
  /**
   * Name of the keycap node in keypad.glb that opens this link. Each social
   * node carries the matching icon material/texture (linkedin → LinkedIn,
   * github → GitHub), so node names map straight through.
   */
  node: string;
}

export const SOCIALS: readonly Social[] = [
  { label: "X", aria: "X (Twitter)", href: "https://x.com/danielrltan", host: "x.com", node: "x" },
  {
    label: "LinkedIn",
    aria: "LinkedIn",
    href: "https://www.linkedin.com/in/danielrltan",
    host: "linkedin.com",
    node: "linkedin",
  },
  {
    label: "GitHub",
    aria: "GitHub",
    href: "https://github.com/danielrltan",
    host: "github.com",
    node: "github",
  },
  {
    label: "Pinterest",
    aria: "Pinterest",
    href: "https://www.pinterest.com/danrlt",
    host: "pinterest.com",
    node: "pinterest",
  },
];
