import { useEffect, useRef } from "react";

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
 *   - Width jitter during the flicker is expected and part of the
 *     effect; titles are left-aligned so only the right edge breathes.
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

    let raf = 0;
    let lastFlicker = 0;
    let start = 0;

    const tick = (now: number) => {
      if (!start) start = now;
      const elapsed = now - start;
      const lockedCount = Math.max(
        0,
        Math.floor((elapsed - LOCK_BASE_MS) / LOCK_STEP_MS) + 1,
      );
      if (lockedCount >= text.length) {
        el.textContent = text;
        doneRef.current = true;
        return;
      }
      if (now - lastFlicker >= FLICKER_MS) {
        lastFlicker = now;
        let out = text.slice(0, lockedCount);
        for (let i = lockedCount; i < text.length; i++) {
          const ch = text[i]!;
          out +=
            ch === " "
              ? " "
              : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]!;
        }
        el.textContent = out;
      }
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !doneRef.current && !raf) {
            io.disconnect();
            raf = requestAnimationFrame(tick);
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
      el.textContent = text;
    };
  }, [text, play]);

  return (
    <>
      <span className="sr-only">{text}</span>
      <span ref={ref} aria-hidden="true">
        {text}
      </span>
    </>
  );
}
