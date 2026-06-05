import { FooterSignature } from "./FooterSignature";
import "./footer.css";

interface JumpLink {
  number: string;
  label: string;
  /** Stable section class selector, or "top" for scroll-to-top. */
  selector: string;
}

interface ElsewhereLink {
  /** Glyph hint: "→" outbound, "↓" résumé/download, "@" email. */
  glyph: string;
  label: string;
  href: string;
  /** Accessible name announced to screen readers (icon-only context). */
  aria: string;
}

/* Jump targets reference each section's STABLE class (not :nth-of-type,
   which counted the aria-hidden SectionTransition filler as a sibling
   and pointed half the links at the wrong (or invisible) section).
   Labels + numbers now match each section's own index marker:
     About 01 · Stack+Projects 02 · Work 03 · Off the clock 04 ·
     Bits and pieces 05 · Elsewhere/contact 06. */
const JUMP_LINKS: JumpLink[] = [
  { number: "00", label: "Top", selector: "top" },
  { number: "01", label: "About", selector: ".portfolio-about" },
  { number: "02", label: "Stack + Projects", selector: ".portfolio-mac" },
  { number: "03", label: "Work", selector: ".portfolio-work" },
  { number: "04", label: "Off the clock", selector: ".portfolio-other" },
  { number: "05", label: "Bits and pieces", selector: ".portfolio-bp" },
  { number: "06", label: "Elsewhere", selector: ".keypad-section" },
];

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

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

function jumpTo(selector: string) {
  // Honour prefers-reduced-motion: scrollIntoView's "smooth" overrides
  // the CSS `scroll-behavior: auto` reset, so we branch in JS instead.
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  if (selector === "top") {
    window.scrollTo({ top: 0, behavior });
    return;
  }
  const el = document.querySelector(selector);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior, block: "start" });
  }
}

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="portfolio-footer" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">
        Site footer: navigation, links, and colophon
      </h2>
      <div className="footer-inner">
        {/* Three-column grid. Order (left → right):
            1. Elsewhere: sits behind the signature, which renders
               ABOVE the column label as a sign-off flourish.
            2. Index: section jump links.
            3. Colophon: build metadata. */}
        <div className="footer-grid">
          <div className="footer-col footer-col-elsewhere">
            <FooterSignature height={132} />
            <h3 className="footer-col-label" id="footer-elsewhere-label">
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
                  >
                    <span className="footer-link-num" aria-hidden="true">
                      {l.glyph}
                    </span>
                    <span className="footer-link-label">{l.label}</span>
                  </a>
                );
              })}
            </nav>
          </div>

          <div className="footer-col">
            <h3 className="footer-col-label" id="footer-index-label">
              Index
            </h3>
            <nav className="footer-nav" aria-labelledby="footer-index-label">
              {JUMP_LINKS.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  className="footer-link"
                  aria-label={`Jump to ${l.label}`}
                  onClick={() => jumpTo(l.selector)}
                >
                  <span className="footer-link-num" aria-hidden="true">
                    {l.number}
                  </span>
                  <span className="footer-link-label">{l.label}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="footer-col footer-col-meta">
            <h3 className="footer-col-label">Colophon</h3>
            <dl className="footer-meta">
              <div>
                <dt className="footer-meta-key">Stack</dt>
                <dd className="footer-meta-val">
                  React · TypeScript · Three.js · Rapier
                </dd>
              </div>
              <div>
                <dt className="footer-meta-key">Type</dt>
                <dd className="footer-meta-val">
                  Offbit · Geist
                </dd>
              </div>
              <div>
                <dt className="footer-meta-key">Build</dt>
                <dd className="footer-meta-val">v0.1 · {year}</dd>
              </div>
              <div>
                <dt className="footer-meta-key">Location</dt>
                <dd className="footer-meta-val">Toronto / London, ON</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Bottom: copyright + sign-off */}
        <div className="footer-bottom">
          <span className="footer-copy">&copy; Daniel Tan {year}</span>
          <span className="footer-mark">Made with intent and the orange crab.</span>
        </div>

        {/* Signature was here: moved to PortfolioSections.tsx above
            the footer so it acts as a sign-off bridge between the
            keypad section and the footer instead of living inside
            the dark footer band. */}
      </div>
    </footer>
  );
}
