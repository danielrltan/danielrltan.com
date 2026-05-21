import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Mark <html> as loading-active BEFORE React mounts. Without this,
// there's a one-frame window between (a) the inline `#boot-screen`
// being removed by AssemblyController on mount, and (b) the cover
// dome inside the canvas painting orange — during which the App
// wrapper's wrapper-bg (cool grey) shows through, reading as a
// white flash. With the class set synchronously, the CSS keeps the
// wrapper orange until climaxDone fires.
document.documentElement.classList.add("loading-active");

// Reset scroll BEFORE React mounts and before any of our scroll
// listeners (useScrollProgress, ScrollTrigger, Lenis) read the
// initial position. Doing this inside a useEffect (the previous
// location, in App.tsx) was too late: by the time React mounted,
// the browser had already restored the user's prior scroll position,
// useScrollProgress had emitted its initial 0-update with that
// non-zero scrollY, and any Lenis initialization down the tree would
// later sync to whatever the browser left in the scroller. Setting
// `scrollRestoration = "manual"` here also covers the very first
// load of a session — when scrollRestoration is set in a useEffect,
// the FIRST refresh of the session still gets the browser's
// auto-restore because the manual flag doesn't exist yet at that
// point in the navigation lifecycle.
// Lock `history.scrollRestoration` to "manual" so the browser NEVER
// auto-restores the user's prior scroll position on refresh. GSAP
// ScrollTrigger (used in src/portfolio/Keypad.tsx) flips this property
// to "auto" during its internal `_clearScrollMemory` / refresh cycles
// — and whichever value happens to be the LAST one set wins for the
// next reload. Setting it once at boot isn't enough; we override the
// property's setter so any attempt to flip it to "auto" is silently
// coerced back to "manual". GSAP doesn't actually depend on the value
// it sets (it's a side effect of trying to suppress browser
// auto-restore during measurement); we want "manual" pinned, so this
// is safe.
if ("scrollRestoration" in history) {
  const proto = Object.getPrototypeOf(history);
  const desc = Object.getOwnPropertyDescriptor(proto, "scrollRestoration");
  if (desc?.get && desc?.set) {
    const origSet = desc.set.bind(history);
    Object.defineProperty(history, "scrollRestoration", {
      get: desc.get.bind(history),
      set() {
        origSet("manual");
      },
      configurable: true,
    });
  }
  history.scrollRestoration = "manual";
}
window.scrollTo(0, 0);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
