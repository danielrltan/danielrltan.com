import { useEffect, useRef, useState } from "react";
import { FooterSignature } from "./FooterSignature";
import { ScrambleText } from "./ScrambleText";
import { requestScrollRefresh } from "./scrollRefresh";
import { useSeam } from "../seams";
import { track } from "../analytics";
import { SECTION_REGISTRY } from "../sectionRegistry";
import { jumpToSection, scrollToY } from "../scroll";
import "./footer.css";

/**
 * RECEIPT FEED (seam 8, contact -> footer; seam overhaul 2026-10-06, owner
 * brief "section boundaries should never stop the page"; the keypad you just
 * met prints the footer like a receipt).
 *
 * - The sheet: on wide screens (> 768px, motion OK) this footer carries a
 *   negative top margin of its own height (src/seams/stack.css, needs both
 *   this root's and the keypad section's data-seam-stack flag) and rides up
 *   1:1 OVER the stuck keypad, like paper out of the device. Its height is
 *   published as --footer-h on <html> by a ResizeObserver (the keypad
 *   section is 100svh + that, so the page length is unchanged); until the
 *   first write it is 0px, a valid interim with no overlap.
 * - The edge: a static row of 8px pixel perforation teeth replaces the 1px
 *   hairline (footer.css; owner gate G6, fallback the hairline).
 * - The print: each [data-print-row] line stays clipped until it has fully
 *   cleared the bottom of the screen (+24px), then prints with a
 *   left-to-right steps(9) wipe at the About boot timing (a CSS transition
 *   on a class toggle, never a per-frame write). Thresholds are a pure
 *   function of the sheet's progress, p_i = min((b_i + 24) / F, 0.98), so
 *   scrolling back up un-prints in reverse and a cut jump lands printed.
 *   The rows are LINES, so the print head is the screen's bottom edge: the
 *   marker, the three column labels, every link, every colophon line, the
 *   signature and the bottom line. (Whole columns were tried first: side by
 *   side they share a bottom, so the sheet stayed blank under the 07 until
 *   84% of the feed. Then whole column bodies: a 240px link list, 436px on
 *   a phone, left blank paper on screen until its last line cleared, and
 *   un-printed while nearly all of it was still in view. This goes past the
 *   spec's "4-6 row groups" on purpose.)
 *   The print IS the footer's entrance (it replaced the old one-shot
 *   fade-rise of the links, which would have double-animated every row).
 *   Going down only: the "07" marker decodes as its row prints and the
 *   signature replays as its row prints. Keyboard focus prints a row at
 *   once (:focus-within), so a focused link is never invisible.
 * - Phones: no overlap (the footer flows), the same teeth and thresholds.
 *   Reduced motion: every row printed at mount, static signature.
 */
const PRINT_MARGIN_PX = 24;
const PRINT_MAX_P = 0.98;

interface JumpLink {
  number: string;
  /** Registry label: the jumpToSection() key. */
  label: string;
  /** The hero entry scrolls to the very top. */
  top: boolean;
}

interface ElsewhereLink {
  /** Glyph hint: "→" outbound, "↓" résumé/download, "@" email. */
  glyph: string;
  label: string;
  href: string;
  /** Accessible name announced to screen readers (icon-only context). */
  aria: string;
}

/* Jump targets come from the shared section registry (same numbers and
   labels the dial + spill menu use). The hero link scrolls to the very top. */
const JUMP_LINKS: JumpLink[] = SECTION_REGISTRY.map((entry, i) => ({
  number: entry.number,
  label: entry.label,
  top: i === 0,
}));

const ELSEWHERE: ElsewhereLink[] = [
  {
    glyph: "→",
    label: "GitHub",
    href: "https://github.com/danielrltan",
    aria: "GitHub: opens in a new tab",
  },
  {
    glyph: "→",
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/danielrltan",
    aria: "LinkedIn: opens in a new tab",
  },
  {
    glyph: "@",
    label: "Email",
    href: "mailto:hello@danielrltan.com",
    aria: "Email hello@danielrltan.com",
  },
  {
    glyph: "↓",
    label: "Résumé",
    href: "/resume/Daniel_Tan_Resume.pdf",
    aria: "Résumé (PDF, opens in a new tab)",
  },
];

/* Index jumps go through the shared scroll core (src/scroll.ts), the same
   routing the spill menu uses: held sections land on their registered beat
   (data-jump-progress / registry jumpProgress through the section's
   softHold hold trigger), short hops glide on the SCROLL.glide preset, anything past
   3 viewports cuts behind the CRT cover, and reduced motion is an instant
   cut. Never native smooth scroll. */
function jumpTo(link: JumpLink) {
  if (link.top) void scrollToY(0, { preset: "jump" });
  else void jumpToSection(link.label);
}

export function Footer() {
  const year = new Date().getFullYear();

  const footerRef = useRef<HTMLElement>(null);

  // --footer-h: the sheet's own height, rounded, on <html> (read by
  // stack.css for the keypad section height and this root's negative
  // margin). Any change re-measures every trigger below the change.
  useEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const root = document.documentElement;
    let last = -1;
    const write = () => {
      const h = Math.round(el.offsetHeight);
      if (h === last) return;
      last = h;
      root.style.setProperty("--footer-h", `${h}px`);
      requestScrollRefresh();
    };
    write();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(write) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty("--footer-h");
    };
  }, []);

  // The print (see the header). Rows and their thresholds are read in
  // measure() only; render() just toggles classes.
  const signReplay = useRef<(() => void) | null>(null);
  const [markerRun, setMarkerRun] = useState(0);
  const printRef = useRef<{ rows: HTMLElement[]; at: number[] }>({ rows: [], at: [] });
  // The one-shots. `at` is filled in by measure() (mountSeam keeps these
  // objects, so a re-measure moves the thresholds); listed top to bottom so
  // their order never changes.
  const crosses = useRef([
    { at: 2, down: () => setMarkerRun((n) => n + 1) },
    { at: 2, down: () => signReplay.current?.() },
  ]).current;
  const printRows = () =>
    Array.from(footerRef.current?.querySelectorAll<HTMLElement>("[data-print-row]") ?? []);
  useSeam(
    {
      id: "contact-footer",
      trigger: () => footerRef.current,
      start: "top bottom",
      end: "bottom bottom",
      // Class toggles only (no per-frame transform), so phones and touch run
      // the same seam; reduced motion gets final().
      when: () => true,
      measure: () => {
        const el = footerRef.current;
        if (!el) return;
        const F = Math.max(1, el.offsetHeight);
        const top = el.getBoundingClientRect().top;
        const rows = printRows();
        const at = rows.map((r) =>
          Math.min((r.getBoundingClientRect().bottom - top + PRINT_MARGIN_PX) / F, PRINT_MAX_P),
        );
        printRef.current = { rows, at };
        const atOf = (name: string) => at[rows.findIndex((r) => r.dataset.printRow === name)] ?? 2;
        crosses[0]!.at = atOf("marker");
        crosses[1]!.at = atOf("sign");
      },
      render: (p, ctx) => {
        const { rows, at } = printRef.current;
        // A cut-jump landing snaps (no wipe after the cover lifts): the
        // snap class holds the transitions off until the new state has
        // been styled, two frames on.
        const el = footerRef.current;
        if (ctx.jumping && el) {
          el.classList.add("print-snap");
          requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove("print-snap")));
        }
        rows.forEach((r, i) => r.classList.toggle("is-printed", p >= at[i]!));
      },
      cross: crosses,
      final: () => printRows().forEach((r) => r.classList.add("is-printed")),
      reset: () => printRows().forEach((r) => r.classList.remove("is-printed")),
    },
    [],
  );

  return (
    <footer
      ref={footerRef}
      className="portfolio-footer"
      aria-labelledby="footer-heading"
      // Seam 8 flag: the perforation teeth, and (with the keypad section's
      // flag, wide screens) the sheet's overlap. See the header.
      data-seam-stack=""
    >
      <h2 id="footer-heading" className="sr-only">
        Site footer: navigation, links, and colophon
      </h2>
      {/* Terminal landmark: "07" Offbit Dot marker so the closing band
          carries the same big-numeral anchor as the sections above.
          aria-hidden — it's decorative; the index is announced via the
          jump-link labels. (07 = Contact/Elsewhere, the footer's section.) */}
      <div className="footer-marker" aria-hidden="true" data-print-row="marker">
        {/* Decodes each time its row prints (re-keyed); static until then,
            and after a silent print (cut jump). */}
        <ScrambleText key={markerRun} text="07" play={markerRun > 0} />
      </div>
      <div className="footer-inner">
        {/* Three-column grid. Order (left → right):
            1. Elsewhere: sits behind the signature, which renders
               ABOVE the column label as a sign-off flourish.
            2. Index: section jump links.
            3. Colophon: build metadata. */}
        <div className="footer-grid">
          <div className="footer-col footer-col-elsewhere">
            <h3 className="footer-col-label" id="footer-elsewhere-label" data-print-row="label">
              Elsewhere
            </h3>
            <nav className="footer-nav" aria-labelledby="footer-elsewhere-label">
              {ELSEWHERE.map((l) => {
                const isMail = l.href.startsWith("mailto:");
                return (
                  <a
                    key={l.label}
                    href={l.href}
                    // mailto + downloads stay in place; web links open a
                    // new tab and need noopener+noreferrer for safety.
                    target={isMail ? undefined : "_blank"}
                    rel={isMail ? undefined : "noreferrer noopener"}
                    aria-label={l.aria}
                    className="footer-link"
                    data-print-row="link"
                    onClick={() => {
                      if (isMail) track("contact_email", { context: "footer" });
                      else if (l.href.endsWith(".pdf"))
                        track("resume_download", { context: "footer" });
                      else
                        track("outbound_link", {
                          url: l.label.toLowerCase(),
                          context: "footer",
                        });
                    }}
                  >
                    <span className="footer-link-num" aria-hidden="true">
                      {l.glyph}
                    </span>
                    <span className="footer-link-label">{l.label}</span>
                  </a>
                );
              })}
            </nav>
            {/* Signature sign-off tucked UNDER the Elsewhere links, so the left
                column runs to roughly the Index column's length instead of
                floating in a long band below the whole grid. */}
            <div className="footer-elsewhere-sign" aria-hidden="true" data-print-row="sign">
              <FooterSignature height={110} brushRadius={4} replayRef={signReplay} />
            </div>
          </div>

          <div className="footer-col">
            <h3 className="footer-col-label" id="footer-index-label" data-print-row="label">
              Index
            </h3>
            <nav className="footer-nav" aria-labelledby="footer-index-label">
              {JUMP_LINKS.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  className="footer-link"
                  data-print-row="link"
                  aria-label={`Jump to ${l.label}`}
                  onClick={() => {
                    track("nav_jump", { section: l.label, source: "footer" });
                    jumpTo(l);
                  }}
                >
                  <span className="footer-link-num" aria-hidden="true">
                    {l.number}
                  </span>
                  <span className="footer-link-label">{l.label}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="footer-col footer-col-meta footer-col-colophon">
            <h3 className="footer-col-label" data-print-row="label">
              Colophon
            </h3>
            <dl className="footer-meta">
              <div data-print-row="colophon">
                <dt className="footer-meta-key">Stack</dt>
                {/* Commas, not a middle-dot chain: the · is rationed to
                    one per line sitewide (separator chains read as AI
                    spec-sheet slop). */}
                <dd className="footer-meta-val">
                  React, TypeScript, Three.js, R3F
                </dd>
              </div>
              <div data-print-row="colophon">
                <dt className="footer-meta-key">Type</dt>
                <dd className="footer-meta-val">
                  Offbit · Geist
                </dd>
              </div>
              {/* A nicety for those who know: the accent is International
                  Orange — the Golden Gate / aerospace red-orange (FF4F00). */}
              <div data-print-row="colophon">
                <dt className="footer-meta-key">Accent</dt>
                <dd className="footer-meta-val">International Orange · FF4F00</dd>
              </div>
              <div data-print-row="colophon">
                <dt className="footer-meta-key">Build</dt>
                <dd className="footer-meta-val">v0.1 · {year}</dd>
              </div>
              <div data-print-row="colophon">
                <dt className="footer-meta-key">Location</dt>
                <dd className="footer-meta-val">Toronto / London, ON</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Bottom: copyright + sign-off */}
        <div className="footer-bottom" data-print-row="bottom">
          <span className="footer-copy">&copy; Daniel Tan {year}</span>
          <span className="footer-mark">Made with intent and the orange crab.</span>
        </div>

        {/* (A stale note here used to claim the signature moved to
            PortfolioSections.tsx; it never did. The signature renders
            at the top of the Elsewhere column above.) */}
      </div>
    </footer>
  );
}
