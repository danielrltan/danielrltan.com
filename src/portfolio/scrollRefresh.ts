import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Coalesce a BURST of ScrollTrigger.refresh() requests into ONE refresh on the
 * next frame.
 *
 * Six sections (About, Macintosh, Work, Other, Photos, Keypad) each install a
 * MutationObserver on <html class> that called ScrollTrigger.refresh() when the
 * `loading-active` scrim drops. Because refresh() is GLOBAL (it re-measures every
 * trigger on the page), those six fired ~6 full-document revert+remeasure
 * reflows on the hero's single most fragile frame — the loader-lift — which is a
 * real jank spike on weak machines. They all observe the SAME class mutation, so
 * they fire in the same microtask; routing them here collapses the whole burst to
 * a single refresh on the next animation frame.
 *
 * Safe to use anywhere a refresh was already rAF-deferred (which all the
 * loader-lift + pin-recreate callers were).
 */
let pending = false;
export function requestScrollRefresh() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    ScrollTrigger.refresh();
  });
}
