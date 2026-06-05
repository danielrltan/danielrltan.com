import { lazy, Suspense, useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import "./sections.css";
import "./other.css";
// Lazy: 3D hobbies scene loads on scroll-approach (idle-prefetched in App.tsx)
// rather than shipping in the first-paint bundle.
const HobbiesScene = lazy(() =>
  import("../other/HobbiesScene").then((m) => ({ default: m.HobbiesScene })),
);

gsap.registerPlugin(ScrollTrigger);

/**
 * "Off the clock": a single-beat CURATED HOBBY REEL inside one pin.
 *
 *   The 3D HobbiesScene takes the full viewport. A restrained editorial
 *   label (mono index + display name) floats in the bottom-left. A dot
 *   strip at the bottom conveys position through the reel and doubles as
 *   a keyboard-operable jump-nav.
 *
 * NOTE: this section used to open with a "Beat A" photo-train stack
 * (the "Flashes" photo reel) that crossfaded into the hobby reel. That
 * gallery was placeholder-only (flat colour cards, no real photos) and
 * was removed at the user's request so the page ships without an
 * unfinished section. The reel now fills the whole pin. (The trains
 * component + its CSS still exist on a local branch for future work.)
 *
 * HobbiesScene is lazy-mounted and stays mounted across the whole pin.
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

// Single beat inside the pin. With the photo-train beat removed the reel
// owns the whole pin, so we trim the duration (was 5000 across two beats)
// and let the reel cycle span almost the entire scroll.
const PIN_DURATION_PX = 3200;

// Beat windows, expressed as fractions of the pin progress.
//   [0.00, 0.10]  header land
//   [0.10, 0.94]  reel scrub (hobby reel cycles)
//   [0.94, 1.00]  outro pad
const HEAD_END = 0.10;    // header end
const REEL_START = 0.10;  // reel start
const REEL_END = 0.94;

const TUNE_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("tune") === "other";

// Optional tune-mode pin progress in [0, 1]. When set, the section
// runs onUpdate at this fixed progress instead of using ScrollTrigger
// used by verification / Playwright to park at exact pin positions
// without driving Lenis. e.g. ?tune=other&pinp=0.65 → roughly the
// Workstation slot.
const TUNE_PINP_RAW =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("pinp")
    : null;
const TUNE_PINP = TUNE_PINP_RAW !== null ? Number(TUNE_PINP_RAW) : null;

// Honoured by the prefers-reduced-motion fallback: when set we skip the
// pin/scrub entirely, drop the scroll-jack, and lay the section out as a
// static, fully legible chapter (visible header + accessible hobby list +
// the 3D scene parked on the first hobby: no bob/dolly, no scrub). Read
// once at mount; stable for the page lifetime. Same pattern as Work /
// Macintosh. TUNE_MODE overrides so the verification harness can park.
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
  const jumpToIndex = (idx: number) => {
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
  };

  useEffect(() => {
    if (TUNE_MODE) {
      focusRef.current = 2;
      activeIdxRef.current = 2;
      setHeadProgress(1);
      setActiveIndex(2);
      return;
    }
    const el = sectionRef.current;
    if (!el) return;

    // prefers-reduced-motion: no pin, no scrub, no scroll-jack. Reveal
    // the section statically (header up, 3D scene parked on hobby 0). The
    // accessible hobby list + the visible dot strip remain operable; the
    // reel just doesn't auto-advance. The section reads in one screen.
    if (PREFERS_REDUCED_MOTION) {
      setHeadProgress(1);
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
      scrub: true,
      anticipatePin: 1,
      onUpdate: (self) => {
        const p = self.progress;

        // Header land across [0, HEAD_END].
        setHeadProgress(smoothstep(0, HEAD_END, p));
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
    setHeadProgress(smoothstep(0, HEAD_END, p));
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

      {/* ===================== CURATED REEL ===================== */}
      <div className="other-curated">
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
            <span className="other-section-divider" aria-hidden>·</span>
            <span className="other-section-tag">Off the clock</span>
          </div>
          <h2 className="other-title">
            Some things I enjoy<span className="other-title-period">.</span>
          </h2>
          <p className="other-sub">
            A ten-track reel of the obsessions that fill the gap between
            shipping things.
          </p>
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
              <span className="other-caption-divider" aria-hidden>·</span>
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
                onClick={() => jumpToIndex(i)}
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
