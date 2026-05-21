import { useEffect, useRef, useState } from "react";
import { KeypadScene } from "../keypad/KeypadScene";
import "./keypad.css";

/**
 * Bottom-of-page section replacing the old Contact card. Pure 3D —
 * no visible heading, no copy. The keypad surfaces 4 socials (X,
 * LinkedIn, GitHub, Pinterest); the dial spins on click for fun
 * (each click adds to the velocity, so rapid clicks let it spin
 * arbitrarily fast); the cursor pools rice grains in a soft fluid
 * blob behind it.
 *
 * Scroll-driven reveal:
 *   The keypad drops into view from above as the section scrolls
 *   into the viewport. This makes the entrance feel like the device
 *   is sliding out from underneath the previous section rather than
 *   a "new canvas" cut. `sectionProgressRef` is updated each rAF
 *   from the section's bounding rect; KeypadScene reads it to drive
 *   the model's Y translation (still lerp-toward-target per the
 *   project's fixed-rate scroll-animation rule).
 *
 * Accessibility / SEO:
 *   The visual surface is 3D-only, but the section also renders a
 *   visually-hidden but DOM-real h2 + <ul> of <a> tags so screen
 *   readers, keyboard users, and crawlers still see the links. This
 *   matters for the recruiter / corporate-firewall reading paths
 *   the portfolio is targeted at.
 *
 * The Canvas is lazy-mounted via IntersectionObserver — keeps the
 * second WebGL context idle until the section approaches the
 * viewport. Once mounted it stays mounted; remount-on-exit creates
 * jank on quick back-scrolls.
 */
// Tune mode short-circuits the IntersectionObserver gate + auto-
// scrolls the page to the keypad section so the user can immediately
// drag the model around.
const TUNE_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("tune") === "keypad";

export function Keypad() {
  const sectionRef = useRef<HTMLElement>(null);
  const [mounted, setMounted] = useState(TUNE_MODE);
  // 0 when the section's top is at viewport bottom (just appearing),
  // 1 when the section's top reaches viewport top (fully entered).
  // Drives the drop-in animation inside KeypadScene.
  const sectionProgressRef = useRef(TUNE_MODE ? 1 : 0);

  useEffect(() => {
    if (TUNE_MODE) {
      // Park the page on the keypad section immediately so the user
      // can interact without scrolling around.
      const scroll = () => {
        sectionRef.current?.scrollIntoView({ block: "start" });
      };
      // Defer one tick so layout has settled.
      setTimeout(scroll, 50);
      return;
    }
    const el = sectionRef.current;
    if (!el || mounted) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setMounted(true);
            io.disconnect();
            return;
          }
        }
      },
      { rootMargin: "100% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [mounted]);

  // Section scroll progress — debounced via rAF so we don't measure
  // on every scroll event. Updated on scroll + resize. Kept on a ref
  // (not state) so it doesn't trigger React re-renders; KeypadScene
  // reads it on each animation frame.
  useEffect(() => {
    let raf = 0;
    const measure = () => {
      const el = sectionRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // r.top = vh → just entering view → progress 0
      // r.top = 0  → section top at viewport top → progress 1
      const p = 1 - r.top / vh;
      sectionProgressRef.current = Math.max(0, Math.min(1, p));
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Scroll lock via `document.body.style.overflow = 'hidden'`. This
  // is the RIGHT mechanism because the browser refuses to scroll a
  // body whose overflow is hidden, but it does so without firing
  // scroll events — so there's no feedback loop and no visible
  // jitter. Past tries that DIDN'T work:
  //   - preventDefault on wheel/touchmove: missed keyboard,
  //     scrollbar drag, trackpad momentum.
  //   - scrollTo from a scroll listener: feedback loop spasming.
  //   - position:sticky with section taller than viewport: didn't
  //     block scroll, user blew past the keypad.
  //
  // Lock fires once when sectionProgress crosses 0.85 (just before
  // drop-in completes), holds for LOCK_MS, then releases. Resets
  // when the user scrolls back well above the section.
  useEffect(() => {
    if (TUNE_MODE) return;
    let raf = 0;
    let hasLocked = false;
    let unlockTimer: number | undefined;
    const LOCK_MS = 800;
    const LOCK_THRESHOLD = 0.85;
    const RESET_THRESHOLD = 0.3;

    // Width of the scrollbar, in CSS px. We'll pad-right by this
    // much while locked so the page doesn't jump horizontally when
    // the scrollbar disappears.
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;

    const release = () => {
      document.body.style.overflow = "";
      document.body.style.paddingRight = "";
      unlockTimer = undefined;
    };

    const engageLock = () => {
      hasLocked = true;
      document.body.style.overflow = "hidden";
      if (scrollbarWidth > 0) {
        document.body.style.paddingRight = `${scrollbarWidth}px`;
      }
      unlockTimer = window.setTimeout(release, LOCK_MS);
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const p = sectionProgressRef.current;
      if (!hasLocked && p >= LOCK_THRESHOLD) {
        engageLock();
      } else if (hasLocked && p < RESET_THRESHOLD) {
        hasLocked = false;
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      if (unlockTimer != null) clearTimeout(unlockTimer);
      release();
    };
  }, []);

  return (
    <section ref={sectionRef} className="portfolio-section keypad-section">
      {/* Hidden semantic content for AT / keyboard / SEO. */}
      <div className="sr-only">
        <h2>Find me elsewhere</h2>
        <ul>
          <li>
            <a href="https://x.com/danielrltan">X (Twitter)</a>
          </li>
          <li>
            <a href="https://www.linkedin.com/in/danielrltan">LinkedIn</a>
          </li>
          <li>
            <a href="https://github.com/danielrltan">GitHub</a>
          </li>
          <li>
            <a href="https://www.pinterest.com/danielrltan">Pinterest</a>
          </li>
        </ul>
      </div>

      <div className="keypad-stage">
        {mounted ? (
          <KeypadScene sectionProgressRef={sectionProgressRef} />
        ) : (
          <div className="keypad-placeholder" />
        )}
      </div>
    </section>
  );
}
