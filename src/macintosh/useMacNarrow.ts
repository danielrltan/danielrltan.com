import { MQ } from "../motion";
import { useMedia } from "../useMedia";
/**
 * Macintosh-section narrow-viewport hook. Breakpoint is 900px, the
 * width below which the orbit cinematic + top-right editorial overlay
 * stops working (the side rail collapses to a sliver, the orbit ring
 * has no horizontal room) and we switch to the vertical stacked layout
 * (header on top, flat tech ticker, landed Mac filling the rest).
 *
 * Deliberately separate from the shared `useIsMobile` (768px): that
 * hook also drives Hero / Keypad / RoomHUD, which must keep their own
 * 768px breakpoint. The Mac section needs a slightly wider cutover
 * because the orbit + side rail need more room than a single column of
 * body copy. Keeping a dedicated hook avoids regressing those sections.
 *
 * The breakpoint MUST stay in lockstep with the `@media (max-width:
 * 900px), (orientation: landscape) and (max-height: 500px)` block in macintosh.css; if you change one, change both.
 */
export function useMacNarrow() {
  return useMedia(MQ.narrow);
}
