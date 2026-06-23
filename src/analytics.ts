/**
 * Thin wrapper around Umami's `window.umami.track`. Safe to call before
 * the umami script has loaded (and safe under ad-blockers / DNT). The
 * function silently no-ops when the global is missing.
 *
 * Naming convention: a small set of meaningful event NAMES, each carrying
 * `data` props for the specifics (e.g. one `outbound_link` event with
 * `{ url, context }` rather than a separate event per link). This keeps the
 * Umami dashboard readable while still covering every interaction — the names
 * are the columns, the data props are the breakdowns.
 */

declare global {
  interface Window {
    umami?: {
      track:
        | ((event: string, data?: Record<string, unknown>) => void)
        | ((cb: (props: Record<string, unknown>) => Record<string, unknown>) => void);
    };
  }
}

export type AnalyticsEvent =
  | "intro_started" // user first scroll triggers the intro
  | "room_entered" // intro completes, scene is interactive
  | "room_reset" // R key resets the room
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
  const u = window.umami;
  if (!u || typeof u.track !== "function") return;
  try {
    (u.track as (e: string, d?: Record<string, unknown>) => void)(event, data);
  } catch {
    // umami isn't ready yet, or the request was blocked. Silent no-op.
  }
}
