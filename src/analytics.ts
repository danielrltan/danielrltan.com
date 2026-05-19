/**
 * Thin wrapper around Umami's `window.umami.track`. Safe to call before
 * the umami script has loaded (and safe under ad-blockers / DNT) — the
 * function silently no-ops when the global is missing.
 *
 * Naming convention: `noun_verb` past-tense for state changes
 * (`room_entered`, `os_opened`), and `noun_clicked` for explicit
 * actions (`contact_clicked`). Keep this list pruned — Umami's free
 * tier and the dashboard both reward a small, meaningful event set.
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
  // Lifecycle
  | "intro_started" // user first click on canvas
  | "room_entered" // intro lerp lands, scene is ready
  | "corruption_started" // first wheel event after intro
  | "os_opened" // wipe completes, OS is interactive
  | "os_closed" // user triggers reverse / back-to-room
  | "room_reset" // R key resets the room

  // In-room
  | "desk_seated" // monitor click → camera dolly to desk
  | "monitor_fullscreen" // F key fullscreen from desk
  | "object_dragged" // a draggable rigid body was grabbed
  | "object_thrown" // a draggable was released with momentum
  | "keycap_pressed" // physical key on the room keyboard

  // In-OS
  | "view_changed" // navigated to a different buffer
  | "vim_command_ran" // `:` command submitted
  | "resume_viewed" // resume.tex opened
  | "projects_viewed" // projects.json opened
  | "skills_viewed" // skills.list opened
  | "contact_viewed" // contact.vcf opened
  | "play_viewed" // play.png opened
  | "about_viewed" // about.md opened
  | "splash_viewed" // splash dashboard opened
  | "help_viewed" // help.txt opened

  // External / outbound
  | "contact_clicked" // email / linkedin / github / site
  | "project_link_clicked" // a specific project's devpost / repo
  | "resume_downloaded"; // PDF download triggered

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
