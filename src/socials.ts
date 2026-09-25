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
   * Name of the keycap node in /keypad.glb that opens this link. NOTE: in the
   * source GLB the node named "github" carries the LinkedIn icon material and
   * the node "linkedin" carries the GitHub icon (confirmed by walking
   * child.material.name), so those two are deliberately crossed here. The
   * user prefers to keep the node names as-is in Blender.
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
    node: "github",
  },
  {
    label: "GitHub",
    aria: "GitHub",
    href: "https://github.com/danielrltan",
    host: "github.com",
    node: "linkedin",
  },
  {
    label: "Pinterest",
    aria: "Pinterest",
    href: "https://www.pinterest.com/danrlt",
    host: "pinterest.com",
    node: "pinterest",
  },
];
