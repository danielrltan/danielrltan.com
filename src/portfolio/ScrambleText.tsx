import { Fragment, useEffect, useRef } from "react";

/**
 * Decode-scramble for the pixel display titles: glyphs flicker through
 * random characters and lock into place left-to-right as the title
 * scrolls into view. Pairs with the OffBit pixel face (the flicker
 * reads as a CRT/firmware boot, which is the whole joke).
 *
 * Mechanics:
 *   - Plays ONCE per mount, triggered by IntersectionObserver (or
 *     suppressed until `play` flips true, for titles whose reveal is
 *     gated elsewhere, e.g. the About wordmark's opacity gate).
 *   - Time-based rAF (NOT scroll-bound), per the project's fixed-rate
 *     animation rule: char i locks at LOCK_BASE_MS + i * LOCK_STEP_MS;
 *     unlocked chars re-roll a random glyph every FLICKER_MS.
 *   - FIXED-WIDTH SLOTS: every character renders in its own inline-block
 *     whose width is pinned to the FINAL glyph's advance for the duration of
 *     the decode. The pixel face is proportional, and the random glyph pool
 *     (W, M, #, %…) runs wider than most letters — as free-flowing text the
 *     scrambled string grew past the column and the title WRAPPED to a second
 *     line for a few frames, then snapped back (the "glitching in line-breaks"
 *     jank). With pinned slots the line boxes are identical to the final
 *     text on every frame: words wrap exactly where the final title wraps and
 *     nothing reflows. Over-wide flicker glyphs are clipped inside their slot.
 *     Slots are released on completion so resize/reflow behaves normally.
 *   - a11y: the animated span is aria-hidden; a visually-hidden twin
 *     carries the real text so screen readers never hear garbage.
 *   - prefers-reduced-motion: renders the final text, no animation.
 */

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%*+";
const LOCK_BASE_MS = 120;
const LOCK_STEP_MS = 42;
const FLICKER_MS = 48;

export function ScrambleText({
  text,
  play = true,
}: {
  text: string;
  /** Gate: hold the plain text until true, then decode on first view. */
  play?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || doneRef.current || !play) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      doneRef.current = true;
      return;
    }

    // One slot per character, in text order (spaces are plain text nodes
    // between word spans so the browser wraps at the same points as the
    // final title).
    const slots = Array.from(
      el.querySelectorAll<HTMLSpanElement>("[data-scr-c]"),
    );
    if (slots.length !== text.replace(/ /g, "").length) return;
    const chars = text.split("").filter((c) => c !== " ");

    let raf = 0;
    let lastFlicker = 0;
    let start = 0;
    let pinned = false;

    const pin = () => {
      // Measure each FINAL glyph's advance while the slot still holds it,
      // then freeze that width for the decode. Done in two passes (measure
      // all, then write all) so no write invalidates a later read.
      const widths = slots.map((s) => s.getBoundingClientRect().width);
      slots.forEach((s, i) => {
        s.style.display = "inline-block";
        s.style.width = `${widths[i]!.toFixed(2)}px`;
        s.style.overflow = "hidden";
        s.style.verticalAlign = "top";
        s.style.textAlign = "center";
      });
      pinned = true;
    };
    const release = () => {
      slots.forEach((s, i) => {
        s.removeAttribute("style");
        s.textContent = chars[i]!;
      });
      pinned = false;
    };

    const tick = (now: number) => {
      if (!start) start = now;
      const elapsed = now - start;
      const lockedCount = Math.max(
        0,
        Math.floor((elapsed - LOCK_BASE_MS) / LOCK_STEP_MS) + 1,
      );
      if (lockedCount >= chars.length) {
        release();
        doneRef.current = true;
        return;
      }
      if (now - lastFlicker >= FLICKER_MS) {
        lastFlicker = now;
        for (let i = 0; i < chars.length; i++) {
          slots[i]!.textContent =
            i < lockedCount
              ? chars[i]!
              : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const startDecode = () => {
      // Pin against the REAL face: if the web font is still loading the
      // fallback metrics would be frozen in, so wait for fonts first.
      const go = () => {
        if (doneRef.current) return;
        pin();
        raf = requestAnimationFrame(tick);
      };
      const fonts = document.fonts;
      if (fonts && fonts.status !== "loaded") {
        void fonts.ready.then(() => requestAnimationFrame(go));
      } else {
        go();
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !doneRef.current && !raf) {
            io.disconnect();
            startDecode();
          }
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
      // If unmounted/re-gated mid-decode, never leave garbage behind.
      if (pinned) release();
      else slots.forEach((s, i) => (s.textContent = chars[i]!));
    };
  }, [text, play]);

  // Words as no-wrap inline spans separated by real space text nodes OUTSIDE
  // the spans, so line breaks fall exactly where they would for plain text
  // (a space inside a nowrap span would suppress the break opportunity).
  const words = text.split(" ");
  return (
    <>
      <span className="sr-only">{text}</span>
      <span ref={ref} aria-hidden="true">
        {words.map((w, wi) => (
          <Fragment key={wi}>
            {wi > 0 ? " " : null}
            <span style={{ whiteSpace: "nowrap" }}>
              {w.split("").map((c, k) => (
                <span key={k} data-scr-c="">
                  {c}
                </span>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </>
  );
}
