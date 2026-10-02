import { MQ } from "./motion";
import { useMedia } from "./useMedia";

/**
 * Phone layout: <=768px wide, or a short landscape screen (a phone on its side).
 * CSS mirrors this as `@media (max-width: 768px), (orientation: landscape) and (max-height: 500px)`.
 */
export function useIsMobile() {
  return useMedia(MQ.compact);
}
