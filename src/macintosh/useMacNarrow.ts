import { useEffect, useState } from "react";

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
 * 900px)` block in macintosh.css; if you change one, change both.
 */
const MAC_NARROW_BREAKPOINT_PX = 900;

export function useMacNarrow() {
  const query = `(max-width: ${MAC_NARROW_BREAKPOINT_PX}px)`;
  const [narrow, setNarrow] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mql.addEventListener("change", handler);
    // Sync in case the width changed between the initial render and the
    // effect running (e.g. an SSR-mismatched first paint or a fast
    // resize during mount).
    setNarrow(mql.matches);
    return () => mql.removeEventListener("change", handler);
  }, [query]);
  return narrow;
}
