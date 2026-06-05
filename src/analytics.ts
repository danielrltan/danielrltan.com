/**
 * Thin wrapper around Umami's `window.umami.track`. Safe to call before
 * the umami script has loaded (and safe under ad-blockers / DNT). The
 * function silently no-ops when the global is missing.
 *
 * Naming convention: `noun_verb` past-tense for state changes
 * (`room_entered`, `os_opened`), and `noun_clicked` for explicit
 * actions (`contact_clicked`). Keep this list pruned: Umami's free
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
  | "intro_started" // user first scroll triggers the intro
  | "room_entered" // intro completes, scene is interactive
  | "room_reset"; // R key resets the room

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
