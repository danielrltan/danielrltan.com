import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./sections.css";
import "./other.css";
import { ScrambleText } from "./ScrambleText";
// Lazy: 3D hobbies scene loads on scroll-approach (idle-prefetched in App.tsx)
// rather than shipping in the first-paint bundle.
const HobbiesScene = lazy(() =>
  import("../other/HobbiesScene").then((m) => ({ default: m.HobbiesScene })),
);
import { OtherPhotoTrains } from "../other/OtherPhotoTrains";

gsap.registerPlugin(ScrollTrigger);

/**
 * "Off the clock": TWO BEATS inside a single pin.
 *
 *   Beat A (pin 0.00 → 0.50): PHOTO TRAIN STACK
 *     Three horizontal rows of photo cards stacked vertically. Each
 *     row scrolls horizontally at its own controlled rate (lerp toward
 *     a scroll-derived target, never directly bound to scrollProgress
 *     (see CLAUDE.md memory rule "Scroll animations must be fixed-
 *     rate"). Adjacent rows scroll opposite directions so the layered
 *     motion reads as parallax. The old "3D rotating drums" design
 *     (PhotoCarousels) was deleted at the user's request: "i dont
 *     really think a big ass photo card is necessary. focus should be
 *     the floating objects."
 *
 *   Beat B (pin 0.55 → 1.00): CURATED HOBBY REEL
 *     The 3D HobbiesScene takes the full viewport. A restrained
 *     editorial label (mono index + display name + 1-line poetic
 *     quote) floats in the bottom-left. A dot strip at the bottom
 *     conveys position through the reel. The old photo plate / index
 *     badge / corner ticks / offset shadow have been removed: the
 *     3D scene is unambiguously the focus.
 *
 * The two beats live in the same pinned section so the user reads
 * them as one chapter. A short handoff window (0.48 → 0.55) crossfades
 * the train stack out and the curated stage in.
 *
 * HobbiesScene stays mounted across the whole pin; it just hides
 * visually during Beat A and reveals at Beat B.
 */

interface Hobby {
  id: string;
  label: string;
  caption: string;       // 1-line poetic note shown under the active label
}

// Order matters: pin progress sweeps through this array in order.
const HOBBIES: Hobby[] = [
  {
    id: "belt",
    label: "Taekwondo",
    caption: "twelve years on the mat, the discipline of a quiet bow before noise.",
  },
  {
    id: "piano",
    label: "Piano",
    caption: "an hour at the keys before anyone else is up.",
  },
  {
    id: "pc",
    label: "Workstation",
    caption: "the desk is the workshop is the lab is the rabbit hole.",
  },
  {
    id: "shoe",
    label: "Fashion",
    caption: "a fit is a sentence. Punctuation matters.",
  },
  {
    id: "keyboard",
    label: "Keyboards",
    caption: "tactile under the fingers, loud in the room. on purpose.",
  },
  {
    id: "cursor",
    label: "Design",
    caption: "obsession over the line weight no one will ever notice.",
  },
  {
    id: "turbo",
    label: "Cars",
    caption: "spool, whistle, dump: the soundtrack of a good morning.",
  },
  {
    id: "yarn",
    label: "Crocheting",
    caption: "a stitch a row a panel, a slow proof that hands still work.",
  },
  {
    id: "luggage",
    label: "Travel",
    caption: "the carry-on is packed by Thursday for a Saturday I haven't booked.",
  },
  {
    id: "ski",
    label: "Skiing",
    caption: "blue light, edges biting, the mountain quiet under it all.",
  },
];

// Twelve photo-train placeholders. Vocabulary inherited from the
// original trains commit (f92a48f) plus a small palette refresh so the
// rows feel cohesive with the rest of the site.
const TRAIN_PHOTOS = [
  { color: "#2a1f1a", label: "Taekwondo" },
  { color: "#1a1714", label: "Piano" },
  { color: "#262120", label: "Keys" },
  { color: "#5a3a1f", label: "Cars" },
  { color: "#a8c4d0", label: "Skiing" },
  { color: "#e87040", label: "Design" },
  { color: "#3d4a52", label: "Travel" },
  { color: "#c08c6c", label: "Crocheting" },
  { color: "#3a2418", label: "Fashion" },
  { color: "#d4a574", label: "Coffee" },
  { color: "#7a4f30", label: "Photography" },
  { color: "#1f1a17", label: "Books" },
];

// Two beats inside the pin. PIN shortened 7400 → 5600: Beat A (the photo
// trains) was eating ~3250px (~3 viewports) of scroll, which read as
// excessive — you kept scrolling over the reel long after you'd seen it.
// Beat A's scrub is now ~1400px (~1.3 viewports), just enough for one
// pass, while Beat B keeps ~2900px of scroll: its windows were re-derived
// so the hobby reel's per-object pacing + snap are unchanged from the
// 7400 tuning (the snap is computed from REEL_START/REEL_END below).
const PIN_DURATION_PX = 5600;

// Beat windows, expressed as fractions of the pin progress (px @5600).
//   [0.00, 0.05]  Beat A header land           (~280px)
//   [0.05, 0.30]  Beat A scrub (trains glide)  (~1400px)
//   [0.30, 0.40]  Beat A → Beat B handoff      (~560px)
//   [0.40, 0.43]  Beat B header land           (~170px)
//   [0.43, 0.95]  Beat B scrub (hobby reel)    (~2910px)
//   [0.95, 1.00]  outro pad                    (~280px)
const BEAT_A_HEAD_END = 0.05;
const BEAT_A_REEL_START = 0.05;
const BEAT_A_REEL_END = 0.30;
const HANDOFF_START = 0.30;
const HANDOFF_END = 0.40;
const HEAD_END = 0.43;      // Beat B header end
const REEL_START = 0.43;    // Beat B reel start
const REEL_END = 0.95;

const TUNE_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("tune") === "other";

// In TUNE_MODE, "gallery" parks Beat A mid-rotation so the trains are
// visible for design tweaking. Default tune mode parks the curated
// reel.
const TUNE_BEAT =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("beat")
    : null;

// Optional tune-mode pin progress in [0, 1]. When set, the section
// runs onUpdate at this fixed progress instead of using ScrollTrigger
// used by verification / Playwright to park at exact pin positions
// without driving Lenis. e.g. ?tune=other&pinp=0.65 → Beat B,
// roughly Workstation slot.
const TUNE_PINP_RAW =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("pinp")
    : null;
const TUNE_PINP = TUNE_PINP_RAW !== null ? Number(TUNE_PINP_RAW) : null;

// Honoured by the prefers-reduced-motion fallback: when set we skip the
// pin/scrub entirely, drop the scroll-jack, and lay the section out as a
// static, fully legible chapter (visible header + accessible hobby list +
// the 3D scene parked on the first hobby: no bob/dolly, no beat
// crossfade, no train slide). Read once at mount; stable for the page
// lifetime. Same pattern as Work / Macintosh. TUNE_MODE overrides so the
// verification harness can still park beats.
const PREFERS_REDUCED_MOTION =
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ----------------------------------------------------------------------
// Active-hobby resolution (the dead-zone fix).
//
// THE BUG: the reel drives a *continuous* `focusRef` (fractional 0..N).
// Previously the active hobby was `floor(focusRef)` and, worse, the
// floating LABEL's opacity was gated by a per-slot crossfade
// (smoothstep(0,0.18,sub) ∧ 1-smoothstep(0.82,1,sub)), so at every slot
// boundary the label faded to ~0. Between two hobbies you got a
// dead-zone: nothing was clearly labelled and no object read as the
// clear hero until you scrolled further onto the next one. It looked
// glitchy/twitchy.
//
// THE FIX: resolve the active index to the NEAREST hobby at all times
// (`round(focusRef)`), keep the label fully solid, and only swap its
// text when the rounded index actually changes. Add HYSTERESIS so the
// active index doesn't flicker right at the .5 boundary between two
// hobbies.
//
// HYSTERESIS_HOLD = 0.6: a boundary between hobby n and n+1 sits at
// focusRef = n + 0.5. While n is active we only promote to n+1 once
// focusRef passes n + 0.6; while n+1 is active we only fall back to n
// once focusRef drops below n + 0.4. That ±0.1 dead-band around every
// .5 crossing means the active index is committed (no twitch) until the
// scroll has deliberately moved past the midpoint toward a neighbour.
const HYSTERESIS_HOLD = 0.6;

// Stable module-level array of hobby IDs — avoids allocating a NEW array
// on every render when passed as a prop (preserves referential identity so
// HobbiesScene memo/prop-equality checks are not defeated every render).
// OLD: O(n) allocation per render. NEW: O(1) — constant identity, computed once.
const HOBBY_IDS = HOBBIES.map((h) => h.id);

/**
 * Resolve the active (integer) hobby index from the continuous focus
 * value, with hysteresis around the .5 boundary so it doesn't flicker.
 *
 * @param f     continuous focus value (0..N-1, may sit anywhere)
 * @param prev  the currently-committed active index
 * @param count number of hobbies
 */
function resolveActiveIndex(f: number, prev: number, count: number): number {
  const maxIdx = count - 1;
  const clampedPrev = Math.max(0, Math.min(maxIdx, prev));
  // Distance from the current commitment. Only switch once we've moved
  // past the hold threshold toward a neighbour, i.e. the nearest
  // integer is a *different* index AND f has crossed prev ± HOLD.
  if (f >= clampedPrev + HYSTERESIS_HOLD) {
    // Moving forward: jump to whichever index f is now nearest to
    // (round), but never below prev+1 (we've already committed to leaving
    // prev), clamped to range.
    return Math.min(maxIdx, Math.max(clampedPrev + 1, Math.round(f)));
  }
  if (f <= clampedPrev - HYSTERESIS_HOLD) {
    return Math.max(0, Math.min(clampedPrev - 1, Math.round(f)));
  }
  // Inside the dead-band around the current index; hold.
  return clampedPrev;
}

export function Other() {
  const sectionRef = useRef<HTMLElement>(null);
  // Active hobby index as a fractional 0..9 value. The integer part is
  // the focused hobby; the fractional part is used by HobbiesScene to
  // smoothly tween camera position between hobby focuses.
  const focusRef = useRef<number>(TUNE_MODE ? 2 : 0);
  // Resolved active (integer) hobby index, with hysteresis: drives BOTH
  // the floating label / dot strip (via React state below) AND the 3D
  // scene's focus-weight target (via this ref, read per-frame). Kept as a
  // ref *in addition to* the React state so HobbiesScene can read the
  // committed hero index every frame without coupling to React renders.
  // This is what makes exactly ONE object the hero at all times. The
  // scene no longer derives its own floor(focusRef) hero, it follows the
  // same hysteresis index the label uses, so label + highlight always
  // agree (no dead-zone where they disagree mid-transition).
  const activeIdxRef = useRef<number>(TUNE_MODE ? 2 : 0);
  // Header reveal: 0..1 for the editorial frame's intro animation.
  const [headProgress, setHeadProgress] = useState(TUNE_MODE ? 1 : 0);
  // Active integer index for the DOM-side React state (controls which
  // label + caption is shown). We don't need to re-render React on
  // every fractional change: only when the integer flips.
  const [activeIndex, setActiveIndex] = useState(TUNE_MODE ? 2 : 0);
  // Beat A train progress 0..1: a REF, not state. It changes on every
  // scroll tick through the whole Beat A scrub, and as state it
  // re-rendered <OtherPhotoTrains/> (108 card nodes) per tick — a big
  // slice of the section-entry jank. The trains' rAF loop reads the
  // ref directly; React never hears about it.
  const beatAProgressRef = useRef(TUNE_BEAT === "gallery" ? 0.5 : 0);
  // True once the pin progress approaches the Beat B handoff: gates the
  // HobbiesScene render loop so the hidden 3D scene doesn't render at
  // full rate behind the opacity-0 layer for all of Beat A (the other
  // big slice of the entry jank). setState with an unchanged boolean
  // bails, so calling it per tick is free.
  const [beatBLive, setBeatBLive] = useState(TUNE_BEAT !== "gallery" && TUNE_MODE);
  const [beatAOpacity, setBeatAOpacity] = useState(
    TUNE_BEAT === "gallery" ? 1 : 0
  );
  // Beat A header reveal: fades up at the start of Beat A.
  const [beatAHead, setBeatAHead] = useState(
    TUNE_BEAT === "gallery" ? 1 : 0
  );
  // Beat B (curated reel) stage opacity: fades in at the handoff,
  // out only at the very end.
  //
  // BUGFIX (beat bleed): this used to initialise to 1 in non-gallery
  // tune mode AND in production. Because `.other-curated` is absolutely
  // positioned on top of the train stack, a starting opacity of 1 meant
  // the 3D HobbiesScene was fully visible from first paint until the
  // first ScrollTrigger onUpdate gated it back to 0, and the user saw the
  // floating interest objects for a few seconds during the photo beat
  // before the transition. The scene MUST start hidden (opacity 0) and
  // only fade in at the handoff window; onUpdate / ?pinp then drives it.
  // (gallery tune mode also wants it hidden, so this is now always 0.)
  const [beatBOpacity, setBeatBOpacity] = useState(0);
  // Per-slot crossfade: used by the floating editorial label to
  // animate in/out as each hobby focuses. Ref since this is a per-
  // frame style write, not a React re-render trigger.
  const captionLayerRef = useRef<HTMLDivElement>(null);

  // Click / keyboard-activate any dot to jump to that hobby. When the
  // pin exists (default motion path) we snap the page scroll to the
  // corresponding pin-progress so the focus + label line up. When the
  // pin is absent (prefers-reduced-motion / TUNE_MODE) we drive the
  // focus directly so the dot strip is still fully operable. Keyboard
  // users can Tab to a dot and Enter to focus that hobby in the 3D
  // scene + swap the floating label, even with no scroll animation.
  // Memoised: reads only stable refs + the stable setActiveIndex setter +
  // module-level constants, so an empty dep list is correct. Stabilising
  // it keeps `handleDotClick` (and any future consumer) referentially
  // stable across renders, removing per-render closure churn.
  const jumpToIndex = useCallback((idx: number) => {
    const el = sectionRef.current;
    if (!el) return;
    const st = ScrollTrigger.getById("other-pin");
    if (st) {
      // Inverse of the reel mapping `fractional = t * (N-1)`: to centre
      // hobby `idx` we need t = idx / (N-1), so the scroll lands focusRef
      // exactly on the hero's integer (round() resolves cleanly to idx).
      const denom = Math.max(1, HOBBIES.length - 1);
      const t = idx / denom;
      const target = REEL_START + t * (REEL_END - REEL_START);
      const scrollY = st.start + target * (st.end - st.start);
      window.scrollTo({ top: scrollY, behavior: "smooth" });
      return;
    }
    // No pin (reduced-motion / tune): focus the hobby in place.
    focusRef.current = idx;
    activeIdxRef.current = idx;
    setActiveIndex(idx);
    if (captionLayerRef.current) {
      captionLayerRef.current.style.setProperty("--cap-opacity", "1");
      captionLayerRef.current.style.setProperty("--cap-drift", "0px");
    }
  }, []);

  // Per-dot click handler. Stable across renders (depends only on the
  // memoised jumpToIndex) so the HOBBIES.map buttons stop allocating a
  // fresh closure per render — pure GC-pressure reduction, no visual change.
  const handleDotClick = useCallback(
    (idx: number) => jumpToIndex(idx),
    [jumpToIndex],
  );

  useEffect(() => {
    if (TUNE_MODE) {
      focusRef.current = 2;
      activeIdxRef.current = 2;
      setHeadProgress(1);
      setActiveIndex(2);
      // Default tune mode (?tune=other with no ?beat / ?pinp) parks the
      // curated reel: reveal Beat B + hide Beat A. (beatBOpacity now
      // defaults to 0 to kill the production beat-bleed, so we opt the
      // reel back in here. ?pinp / ?beat=gallery override this below.)
      if (TUNE_BEAT !== "gallery" && TUNE_PINP === null) {
        setBeatBOpacity(1);
      }
      return;
    }
    const el = sectionRef.current;
    if (!el) return;

    // prefers-reduced-motion: no pin, no scrub, no scroll-jack. Reveal
    // BOTH beats statically (header up, photo train rack visible but not
    // sliding, 3D scene parked on hobby 0). The accessible hobby list +
    // the visible dot strip remain operable; the reel just doesn't
    // auto-advance. The section reads top-to-bottom in one screen.
    if (PREFERS_REDUCED_MOTION) {
      setBeatAHead(1);
      beatAProgressRef.current = 0.5; // neutral train frame
      setBeatAOpacity(1);
      setHeadProgress(1);
      setBeatBOpacity(1);
      setBeatBLive(true); // static layout: 3D scene always live
      focusRef.current = 0;
      activeIdxRef.current = 0;
      setActiveIndex(0);
      if (captionLayerRef.current) {
        captionLayerRef.current.style.setProperty("--cap-opacity", "1");
        captionLayerRef.current.style.setProperty("--cap-drift", "0px");
      }
      return;
    }

    const st = ScrollTrigger.create({
      id: "other-pin",
      trigger: el,
      start: "top top",
      end: `+=${PIN_DURATION_PX}`,
      pin: true,
      pinSpacing: true,
      // Scroll speed limit: smoothed scrub (vs scrub:true / 1:1) eases the
      // beat progression over ~1s, so a fast flick GLIDES through the
      // photo trains + hobby reel instead of teleporting past every object.
      // The scene catches up under its own momentum rather than snapping to
      // the raw scroll position, giving the objects time to read.
      scrub: 1,
      // Per-hobby SNAP LOCK: within the Beat-B hobby reel each object is a
      // hard stop, so the reel SETTLES on every "thing I enjoy" one at a
      // time and you can't flick past them all. Quantising is scoped to
      // the reel window only — Beat A (the continuous photo-train glide)
      // and the outro pad return the value unchanged so they stay free.
      // inertia:false → snap to the hobby nearest where the scroll comes
      // to rest (don't project the flick's momentum forward to a far one),
      // which combined with the smoothed scrub keeps it to ~one step per
      // gesture. directional:false lets it pull back onto the current
      // hobby when you overshoot, so nothing flies by.
      snap: {
        snapTo: (value) => {
          if (value <= REEL_START || value >= REEL_END) return value;
          const t = (value - REEL_START) / (REEL_END - REEL_START);
          const i = Math.round(t * (HOBBIES.length - 1));
          return REEL_START + (i / (HOBBIES.length - 1)) * (REEL_END - REEL_START);
        },
        duration: { min: 0.25, max: 0.55 },
        delay: 0.04,
        ease: "power2.inOut",
        inertia: false,
        directional: false,
      },
      anticipatePin: 1,
      onUpdate: (self) => {
        const p = self.progress;

        // -------- Beat A: photo train stack --------
        // Header is already landed by the entrance trigger (which fades
        // Beat A in over the section's approach, filling the old seam
        // gap), so the pin just holds it up; no per-frame re-land that
        // would snap it back to 0 at progress 0.
        setBeatAHead(1);
        // Train progress 0..1 across [BEAT_A_REEL_START, BEAT_A_REEL_END].
        const aT = Math.max(
          0,
          Math.min(1, (p - BEAT_A_REEL_START) / (BEAT_A_REEL_END - BEAT_A_REEL_START))
        );
        beatAProgressRef.current = aT;
        // Wake the 3D scene slightly before its fade-in so the first
        // visible frame is already warm; sleeps again on scroll-back.
        setBeatBLive(p > HANDOFF_START - 0.05);
        // Train rack opacity: already faded IN by the entrance trigger, so
        // it's fully visible from progress 0 (no re-hide flash at pin
        // engage). Here we only fade it OUT during the Beat A→B handoff.
        const aFadeOut = 1 - smoothstep(HANDOFF_START, HANDOFF_END, p);
        setBeatAOpacity(aFadeOut);

        // -------- Beat B: curated reel --------
        // Header land: staggered beats across [HANDOFF_END, HEAD_END]
        const h = smoothstep(HANDOFF_END, HEAD_END, p);
        setHeadProgress(h);
        // Beat B stage opacity: appears at handoff, holds through the
        // end of the pin.
        const bIn = smoothstep(HANDOFF_START, HANDOFF_END, p);
        setBeatBOpacity(bIn);
        // Reel index: map [REEL_START, REEL_END] -> continuous [0, N-1].
        // NOTE: the continuous focus value now spans the *centres* of the
        // slots: progress 0 → hobby 0 fully centred, progress 1 → hobby
        // N-1 fully centred. That way `round(focusRef)` lands cleanly on a
        // hobby (and the camera/scene tween reaches each hero's authored
        // framing) instead of the old [0..N) ramp that only hit the last
        // hobby's integer at the very end.
        const t = Math.max(0, Math.min(1, (p - REEL_START) / (REEL_END - REEL_START)));
        const fractional = t * (HOBBIES.length - 1);
        focusRef.current = fractional;
        // Resolve the active hero via NEAREST + hysteresis so exactly one
        // hobby is labelled at all times, no dead-zone between two slots.
        const nextIdx = resolveActiveIndex(
          fractional,
          activeIdxRef.current,
          HOBBIES.length,
        );
        activeIdxRef.current = nextIdx;
        setActiveIndex((prev) => (prev === nextIdx ? prev : nextIdx));
        // The label stays SOLID: it is never gated to fade out at a slot
        // boundary (that was the dead-zone). It only swaps its text when
        // the rounded index flips; the CSS opacity transition on
        // `.other-caption` gives a brief, smooth text handoff without ever
        // leaving the viewer with no label.
        if (captionLayerRef.current) {
          captionLayerRef.current.style.setProperty("--cap-opacity", "1");
          captionLayerRef.current.style.setProperty("--cap-drift", "0px");
        }
      },
    });

    // Entrance cross-fade: reveal Beat A as the section RISES into view,
    // BEFORE the pin engages. Window is [top bottom → top top] — exactly
    // the stretch where the preceding Work section is scrolling up and
    // off the top. Fading the trains + header in across it means the seam
    // is a true cross-dissolve (Work slides out, Other fades in) instead
    // of ~1.3 viewports of blank background. By the time the pin takes
    // over at "top top", Beat A is already fully revealed, so the pin's
    // onUpdate (which holds beatAHead=1 / opacity=fadeOut) matches with no
    // flash. Reverses cleanly on scroll-up.
    const entrance = ScrollTrigger.create({
      trigger: el,
      start: "top bottom",
      end: "top top",
      scrub: true,
      onUpdate: (self) => {
        const e = self.progress;
        setBeatAHead(e);
        setBeatAOpacity(e);
      },
    });

    // Refresh after the loading screen lifts: pin position can shift
    // during initial layout. Same pattern as Macintosh + Keypad.
    const html = document.documentElement;
    let lastLoading = html.classList.contains("loading-active");
    const obs = new MutationObserver(() => {
      const now = html.classList.contains("loading-active");
      if (lastLoading && !now) ScrollTrigger.refresh();
      lastLoading = now;
    });
    obs.observe(html, { attributes: true, attributeFilter: ["class"] });
    if (!lastLoading) {
      requestAnimationFrame(() => ScrollTrigger.refresh());
    }

    return () => {
      obs.disconnect();
      st.kill();
      entrance.kill();
    };
  }, []);

  // TUNE_MODE: scroll the section into view + park visuals. Also
  // re-snaps on resize so the verification harness (Playwright) can
  // resize to mobile and still land on this section, not whichever
  // section happens to be at the original 1920w scrollY.
  useEffect(() => {
    if (!TUNE_MODE) return;
    const snap = () => sectionRef.current?.scrollIntoView({ block: "start" });
    setTimeout(snap, 100);
    window.addEventListener("resize", snap);
    if (captionLayerRef.current) {
      captionLayerRef.current.style.setProperty("--cap-opacity", "1");
      captionLayerRef.current.style.setProperty("--cap-drift", "0px");
    }
    return () => window.removeEventListener("resize", snap);
  }, []);

  // TUNE_MODE + ?pinp=<0..1>: drive the pin onUpdate logic at a fixed
  // progress, used by verification to park at exact pin positions
  // without going through Lenis/ScrollTrigger. Replicates the
  // production onUpdate body verbatim.
  useEffect(() => {
    if (!TUNE_MODE || TUNE_PINP === null) return;
    const p = Math.max(0, Math.min(1, TUNE_PINP));
    setBeatAHead(smoothstep(0, BEAT_A_HEAD_END, p));
    const aT = Math.max(
      0,
      Math.min(1, (p - BEAT_A_REEL_START) / (BEAT_A_REEL_END - BEAT_A_REEL_START))
    );
    beatAProgressRef.current = aT;
    setBeatBLive(p > HANDOFF_START - 0.05);
    const aFadeIn = smoothstep(0, 0.10, aT);
    const aFadeOut = 1 - smoothstep(HANDOFF_START, HANDOFF_END, p);
    setBeatAOpacity(Math.min(aFadeIn, aFadeOut));
    const h = smoothstep(HANDOFF_END, HEAD_END, p);
    setHeadProgress(h);
    const bIn = smoothstep(HANDOFF_START, HANDOFF_END, p);
    setBeatBOpacity(bIn);
    const t = Math.max(0, Math.min(1, (p - REEL_START) / (REEL_END - REEL_START)));
    const fractional = t * (HOBBIES.length - 1);
    focusRef.current = fractional;
    // Park-mode parks at an exact progress with no prior committed index,
    // so resolve the active hero straight from NEAREST (round): the
    // hysteresis is only meaningful across a live sweep. Seeding prev with
    // round(fractional) makes resolveActiveIndex return the nearest hobby.
    const idx = resolveActiveIndex(fractional, Math.round(fractional), HOBBIES.length);
    activeIdxRef.current = idx;
    setActiveIndex(idx);
    if (captionLayerRef.current) {
      captionLayerRef.current.style.setProperty("--cap-opacity", "1");
      captionLayerRef.current.style.setProperty("--cap-drift", "0px");
    }
  }, []);

  const active = HOBBIES[activeIndex]!;

  return (
    <section
      ref={sectionRef}
      className="portfolio-section portfolio-other"
      aria-labelledby="other-sr-heading"
    >
      {/* ====================================================================
          Accessible + crawlable interests list. The ten hobbies live ONLY
          as 3D objects in a <canvas> with hover/tap DOM tooltips. Screen
          readers, keyboard-only users, and search crawlers see NOTHING of
          them otherwise. This visually-hidden (but DOM-real + focusable)
          list is the source of truth for those users and for SEO: a real
          heading + a real <ul> of every interest with its one-line note.
          Mirrors the Macintosh / Keypad sr-only pattern. The dot strip
          below carries the same labels and is keyboard-operable for the
          interactive equivalent.
          ==================================================================== */}
      <h2 id="other-sr-heading" className="other-sr-only">
        Off the clock: some things I enjoy
      </h2>
      <ul className="other-sr-only" aria-label="Personal interests">
        {HOBBIES.map((h) => (
          <li key={h.id}>
            {h.label}: {h.caption}
          </li>
        ))}
      </ul>

      {/* ===================== BEAT A: PHOTO TRAIN STACK =====================
          The whole train rack is a DECORATIVE placeholder, flat colour
          cards (no real photos yet), no information a screen reader needs.
          aria-hidden so AT skips straight from the sr-only interests list
          to the curated reel's operable controls. When real photos land
          here, give each card a real <img alt> and drop this attribute. */}
      <div
        className="other-gallery"
        aria-hidden="true"
        style={
          {
            opacity: beatAOpacity,
            pointerEvents: beatAOpacity > 0.5 ? "auto" : "none",
          } as React.CSSProperties
        }
      >
        <header
          className="other-gallery-header"
          style={
            {
              "--gh-eye": String(smoothstep(0, 0.40, beatAHead)),
              "--gh-title": String(smoothstep(0.25, 0.75, beatAHead)),
              "--gh-sub": String(smoothstep(0.55, 1.0, beatAHead)),
            } as React.CSSProperties
          }
        >
          <div className="other-gallery-eyebrow">
            <span className="other-gallery-num">04</span>
            <span className="other-gallery-label">
              <span className="other-gallery-divider" aria-hidden>/</span>
              <span className="other-gallery-tag">Photo reel</span>
            </span>
          </div>
          <h2 className="other-gallery-title">
            <ScrambleText text="Recents" />
          </h2>
        </header>

        {/* Train rack: three horizontal rows, alternating directions. */}
        <div className="other-trains-wrap">
          <OtherPhotoTrains
            photos={TRAIN_PHOTOS}
            progressRef={beatAProgressRef}
          />
        </div>

        {/* Bottom HUD: handoff hint to the curated reel beat. The
            "% SCRUB" progress readout was removed (no UX value on a
            scroll-driven reel). */}
        <div className="other-gallery-foot">
          <div className="other-gallery-next">
            <span>02 / Curated reel</span>
            <span className="other-gallery-next-arrow" aria-hidden>↓</span>
          </div>
        </div>
      </div>

      {/* ===================== BEAT B: CURATED REEL ===================== */}
      <div
        className="other-curated"
        style={
          {
            opacity: beatBOpacity,
            pointerEvents: beatBOpacity > 0.5 ? "auto" : "none",
          } as React.CSSProperties
        }
      >
        {/* Persistent editorial header: kept at the top per design
            spec: "KEEP the section header at the top (04: OFF THE
            CLOCK + Things I love.)". */}
        <header
          className="other-header"
          style={{
            ...({
              "--head-eye": String(smoothstep(0, 0.30, headProgress)),
              "--head-title": String(smoothstep(0.20, 0.60, headProgress)),
              "--head-sub": String(smoothstep(0.50, 1.0, headProgress)),
            } as React.CSSProperties),
          }}
        >
          <div className="other-eyebrow">
            {/* Section index = 04 (Hero 00 · About 01 · Stack 02 · Work
                03 · Off the clock 04). Was incorrectly "02", which
                collided with the global "02: Stack" in the StatusBar
                registry. Now matches StatusBar's SECTION_REGISTRY. */}
            <span className="other-section-num">04</span>
            <span className="other-section-divider" aria-hidden>/</span>
            <span className="other-section-tag">Off the clock</span>
          </div>
          <h2 className="other-title">
            <ScrambleText text="Some interests" />
          </h2>
        </header>

        {/* Full-width 3D scene: no left photo plate, no offset shadow.
            The 3D objects ARE the section now; chrome is reduced to
            the floating editorial label + bottom dot strip. The canvas
            content is decorative; the sr-only interests list above is
            the accessible equivalent, so it's hidden from AT. */}
        <div className="other-scene-wrap" aria-hidden="true">
          <Suspense fallback={null}>
            <HobbiesScene
              focusRef={focusRef}
              activeIdxRef={activeIdxRef}
              hobbyIds={HOBBY_IDS}
              beatBLive={beatBLive}
            />
          </Suspense>
        </div>

        {/* Floating editorial label, bottom-left, restrained. Small
            mono index + display name + 1-line poetic quote. No card
            chrome, no offset plate, no corner ticks. aria-hidden: this
            is a per-slot visual echo of the sr-only interests list, not
            independent content: it would otherwise read as a duplicate
            single-item announcement to AT. */}
        <div ref={captionLayerRef} className="other-caption" aria-hidden="true">
          {/* Inner content is keyed by the active index so a hobby change
              retriggers a brief fade/rise of the NEW text. The OUTER
              `.other-caption` stays solid the whole time: it is never
              gated to fade out at a slot boundary, so a hobby is always
              labelled (the dead-zone is gone). Only the text swaps. */}
          <div key={activeIndex} className="other-caption-inner">
            <div className="other-caption-label">
              <span className="other-caption-no">
                {String(activeIndex + 1).padStart(2, "0")}
              </span>
              <span className="other-caption-divider" aria-hidden>/</span>
              <span className="other-caption-name">{active.label}</span>
            </div>
          </div>
        </div>

        {/* Dot strip: collapses the chip rail into a compact 10-dot
            position indicator AND a real jump-nav. Each dot is a focusable
            <button> (keyboard-operable: Tab to reach, Enter/Space to jump
            to that hobby) with a "Jump to {hobby}" aria-label so the
            icon-only control has an accessible name; active dot carries
            aria-current. Active dot is filled orange; others are a neutral
            ring; a visible focus ring is provided in CSS (.other-dot:
            focus-visible). */}
        <nav className="other-dots" aria-label="Jump to interest">
          {HOBBIES.map((h, i) => {
            const isActive = i === activeIndex;
            return (
              <button
                key={h.id}
                type="button"
                className={`other-dot${isActive ? " is-active" : ""}`}
                onClick={() => handleDotClick(i)}
                aria-current={isActive ? "true" : undefined}
                aria-label={`Jump to ${h.label} (${i + 1} of ${HOBBIES.length})`}
              >
                <span className="other-dot-mark" aria-hidden />
              </button>
            );
          })}
        </nav>
      </div>
    </section>
  );
}
