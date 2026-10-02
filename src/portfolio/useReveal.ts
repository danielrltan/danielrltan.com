import { useLayoutEffect, useRef, type RefObject } from "react";
import { reducedMotion } from "../motion";

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
 * - The hidden pose only applies under a root carrying `data-reveal-armed`,
 *   which the hook sets (before paint) whenever motion is allowed. A
 *   [data-reveal] node outside an armed root renders visible. A
 *   MutationObserver adopts nodes that mount after the first pass.
 * - Phones run the same one-shot rise, shorter and subtler: sections.css
 *   swaps --reveal-dur / --reveal-lift for the -mobile tokens on stacked
 *   layouts. Opacity + transform only; nothing pins or scroll-jacks.
 * - Reduced motion (or no IntersectionObserver): the root is never armed and
 *   everything is revealed at mount; `onReveal` fires at mount too.
 * - `enabled: false` makes the hook a no-op (a section that only wants the
 *   primitive on some layouts, e.g. About / Work on the stacked mobile
 *   layout, passes its live media match). Turning it off later disarms the
 *   root; nodes already revealed stay revealed.
 * - `onReveal(el)` fires once per element when it is revealed.
 */
export interface UseRevealOptions {
  selector?: string;
  rootMargin?: string;
  onReveal?: (el: Element) => void;
  /** Default true. False: do nothing (and disarm a previously armed root). */
  enabled?: boolean;
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
    enabled = true,
  }: UseRevealOptions = {},
): void {
  // Latest callback without re-running the effect (stable observer).
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;

  // Layout effect: the root is armed (and the hidden pose applied) before
  // the first paint, so armed nodes never flash visible-then-hidden.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled) return;

    const reveal = (el: HTMLElement, i: number) => {
      el.style.setProperty("--i", String(i));
      el.classList.add("is-revealed");
    };

    const noIO = typeof IntersectionObserver === "undefined";
    const immediate = reducedMotion.value || noIO;

    // Every node handed to an observer (or revealed outright) exactly once.
    const tracked = new WeakSet<Element>();
    const pending = (): HTMLElement[] =>
      Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => !tracked.has(el) && !el.classList.contains("is-revealed"),
      );

    let observer: IntersectionObserver | null = null;
    let adopt: (els: HTMLElement[]) => void;

    if (immediate) {
      adopt = (els) =>
        els.forEach((el) => {
          tracked.add(el);
          reveal(el, 0);
          onRevealRef.current?.(el);
        });
    } else {
      // Only an armed root hides its [data-reveal] nodes (sections.css), so
      // a marked node outside an armed root always renders visible.
      root.setAttribute("data-reveal-armed", "");
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
      observer = io;
      adopt = (els) =>
        els.forEach((el) => {
          tracked.add(el);
          io.observe(el);
        });
    }

    adopt(pending());

    // Nodes that mount later (a re-keyed or conditionally rendered tile, HMR)
    // are adopted too, so none is left parked in the hidden pose.
    const mo =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver((records) => {
            if (records.some((r) => r.addedNodes.length > 0)) {
              const fresh = pending();
              if (fresh.length) adopt(fresh);
            }
          });
    mo?.observe(root, { childList: true, subtree: true });

    return () => {
      mo?.disconnect();
      observer?.disconnect();
      root.removeAttribute("data-reveal-armed");
    };
  }, [rootRef, selector, rootMargin, enabled]);
}
