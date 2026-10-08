/**
 * Named events for the in-house analytics (public/rum.js, poddle NOTES 233):
 * track() queues [event, data] on window.rumEvents; rum.js sends the queue with
 * its next beacon to the owner's collector on poddleball.com, which counts each
 * event per day as name + detail (the data's values in key order, URLs without
 * their query). Read on /stats. Safe before rum.js has loaded (the queue waits)
 * and when it never loads (headless runs, blocked requests): a silent no-op.
 *
 * Naming convention: a small set of meaningful event NAMES, each carrying
 * `data` props for the specifics (e.g. one `outbound_link` event with
 * `{ url, context }` rather than a separate event per link). This keeps the
 * Events list readable while still covering every interaction — the names
 * are the rows, the data props are the breakdowns.
 */

declare global {
  interface Window {
    rumEvents?: [string, Record<string, unknown> | undefined][];
  }
}

export type AnalyticsEvent =
  | "room_entered" // HUD revealed: the visitor scrolled past the hero (legacy name)
  // Navigation
  | "section_view" // a section scrolled into view — { section }
  | "nav_open" // channel/spill menu opened — { via }
  | "nav_close" // channel/spill menu closed — { via }
  | "nav_jump" // jumped to a section — { section, source }
  | "jump_to_top" // jump-to-top control
  // Projects (Macintosh)
  | "project_open" // opened a project detail — { project }
  | "project_close" // closed a project detail — { via }
  | "project_link" // clicked a project's live/repo link — { project, type }
  // Work
  | "work_expand" // expanded a work role — { role }
  // Play / Hobbies
  | "hobby_focus" // focused a hobby object (first time) — { hobby }
  // Contact / Keypad
  | "keypad_press" // pressed a 3D keypad cap — { key }
  // Outbound / conversions (used site-wide)
  | "outbound_link" // external link — { url, context }
  | "contact_email" // mailto click — { context }
  | "resume_download"; // résumé/CV download — { context }

export function track(
  event: AnalyticsEvent,
  data?: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  try {
    const q = (window.rumEvents ??= []);
    if (q.length < 1000) q.push([event, data]);
  } catch {
    // never worth breaking the page for
  }
}
