import { useEffect, useRef, type RefObject } from "react";
import { BREAKPOINT, reducedMotion } from "../motion";

/**
 * Shared one-shot entrance primitive for the back-half sections (spec W5.1).
 *
 * Every element under `rootRef` matching `selector` (default `[data-reveal]`)
 * starts in the primitive's hidden pose (sections.css) and latches
 * `.is-revealed` the first time it crosses the reveal line. The CSS owns the
 * motion: opacity + a `--reveal-lift` rise over `--reveal-dur`/`--reveal-ease`,
 * delayed by `min(--i, --stagger-max) * --stagger`.
 *
 * - ONE IntersectionObserver for the whole root. Per callback BATCH, the newly
 *   intersecting elements are sorted by untransformed layout position
 *   (offsetTop, then offsetLeft, summed up the offsetParent chain, so the
 *   in-flight translate never skews the order) and `--i` is the index WITHIN
 *   the batch. Every row that crosses the line together therefore starts at
 *   0 ms, whatever its global position. Each element is unobserved once
 *   revealed, so `observe()` runs exactly once per element.
 * - Classes are written imperatively (no React state, no per-render ref
 *   callbacks), so a parent re-render can never drop `.is-revealed`: callers
 *   must NOT put reveal state into the className they render.
 * - Reduced motion or <= BREAKPOINT.mobile: everything is revealed at mount
 *   (sections.css also parks the primitive static there, so nothing fades).
 * - `onReveal(el)` fires once per element when it is revealed. In the
 *   mobile immediate mode it still fires on real intersection (so e.g. a
 *   count-up plays when seen, not at mount); under reduced motion it fires at
 *   mount.
 */
export interface UseRevealOptions {
  selector?: string;
  rootMargin?: string;
  onReveal?: (el: Element) => void;
}

/** Untransformed document position: sum offsetTop/Left up the offsetParent chain. */
function layoutPos(el: Element): { top: number; left: number } {
  let top = 0;
  let left = 0;
  let node: HTMLElement | null = el as HTMLElement;
  while (node) {
    top += node.offsetTop || 0;
    left += node.offsetLeft || 0;
    node = node.offsetParent as HTMLElement | null;
  }
  return { top, left };
}

export function useReveal(
  rootRef: RefObject<HTMLElement | null>,
  {
    selector = "[data-reveal]",
    rootMargin = "0px 0px -15% 0px",
    onReveal,
  }: UseRevealOptions = {},
): void {
  // Latest callback without re-running the effect (stable observer).
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => !el.classList.contains("is-revealed"),
    );
    if (els.length === 0) return;

    const reveal = (el: HTMLElement, i: number) => {
      el.style.setProperty("--i", String(i));
      el.classList.add("is-revealed");
    };

    const noIO = typeof IntersectionObserver === "undefined";
    const narrow =
      typeof window !== "undefined" &&
      !!window.matchMedia?.(`(max-width: ${BREAKPOINT.mobile}px)`).matches;

    if (reducedMotion.value || noIO) {
      els.forEach((el) => {
        reveal(el, 0);
        onRevealRef.current?.(el);
      });
      return;
    }

    if (narrow) {
      // Reveal in place now; keep watching only to fire onReveal when seen.
      els.forEach((el) => reveal(el, 0));
      if (!onRevealRef.current) return;
      const seen = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            seen.unobserve(entry.target);
            onRevealRef.current?.(entry.target);
          }
        },
        { rootMargin },
      );
      els.forEach((el) => seen.observe(el));
      return () => seen.disconnect();
    }

    const io = new IntersectionObserver(
      (entries) => {
        const batch: HTMLElement[] = [];
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          batch.push(entry.target as HTMLElement);
        }
        if (batch.length === 0) return;
        const keyed = batch.map((el) => ({ el, ...layoutPos(el) }));
        // Rows first (a few px of tolerance so subpixel tops don't split a
        // row), then left to right.
        keyed.sort((a, b) =>
          Math.abs(a.top - b.top) > 2 ? a.top - b.top : a.left - b.left,
        );
        keyed.forEach(({ el }, i) => {
          reveal(el, i);
          onRevealRef.current?.(el);
        });
      },
      { rootMargin },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [rootRef, selector, rootMargin]);
}
