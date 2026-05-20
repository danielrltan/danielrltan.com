import { useRef } from "react";
import { FooterSignature } from "./FooterSignature";
import "./footer.css";

interface Link {
  number: string;
  label: string;
  selector: string;
  external?: boolean;
  href?: string;
}

const JUMP_LINKS: Link[] = [
  { number: "00", label: "Top", selector: "top" },
  { number: "01", label: "About", selector: ".portfolio-section:nth-of-type(2)" },
  { number: "02", label: "Skills", selector: ".portfolio-section:nth-of-type(3)" },
  { number: "03", label: "Projects", selector: ".portfolio-section:nth-of-type(4)" },
  { number: "04", label: "Work", selector: ".portfolio-section:nth-of-type(5)" },
  { number: "05", label: "Play", selector: ".portfolio-section:nth-of-type(6)" },
  { number: "06", label: "Other", selector: ".portfolio-section:nth-of-type(7)" },
  { number: "07", label: "Contact", selector: ".portfolio-section:nth-of-type(8)" },
];

const ELSEWHERE: Link[] = [
  {
    number: "→",
    label: "GitHub",
    selector: "",
    external: true,
    href: "https://github.com/danielrltan",
  },
  {
    number: "→",
    label: "LinkedIn",
    selector: "",
    external: true,
    href: "https://www.linkedin.com/in/danielrltan",
  },
  {
    number: "→",
    label: "Email",
    selector: "",
    external: true,
    href: "mailto:hello@danielrltan.com",
  },
  {
    number: "↓",
    label: "Resume",
    selector: "",
    external: true,
    href: "/resume/Daniel_Tan_Resume.pdf",
  },
];

function jumpTo(selector: string) {
  if (selector === "top") {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const el = document.querySelector(selector);
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

export function Footer() {
  const year = new Date().getFullYear();
  const footerRef = useRef<HTMLElement>(null);

  return (
    <footer className="portfolio-footer" ref={footerRef}>
      <div className="footer-inner">
        {/* Top: nav + elsewhere */}
        <div className="footer-grid">
          <div className="footer-col">
            <div className="footer-col-label">Index</div>
            <nav className="footer-nav">
              {JUMP_LINKS.map((l) => (
                <button
                  key={l.label}
                  type="button"
                  className="footer-link"
                  onClick={() => jumpTo(l.selector)}
                >
                  <span className="footer-link-num">{l.number}</span>
                  <span className="footer-link-label">{l.label}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="footer-col">
            <div className="footer-col-label">Elsewhere</div>
            <nav className="footer-nav">
              {ELSEWHERE.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  target={l.href?.startsWith("mailto:") ? undefined : "_blank"}
                  rel="noreferrer"
                  className="footer-link"
                >
                  <span className="footer-link-num">{l.number}</span>
                  <span className="footer-link-label">{l.label}</span>
                </a>
              ))}
            </nav>
          </div>

          <div className="footer-col footer-col-meta">
            <div className="footer-col-label">Colophon</div>
            <div className="footer-meta">
              <div>
                <span className="footer-meta-key">Stack</span>
                <span className="footer-meta-val">
                  React · TypeScript · Three.js · Rapier
                </span>
              </div>
              <div>
                <span className="footer-meta-key">Type</span>
                <span className="footer-meta-val">
                  Offbit · Geist · JetBrains Mono
                </span>
              </div>
              <div>
                <span className="footer-meta-key">Build</span>
                <span className="footer-meta-val">v0.1 · {year}</span>
              </div>
              <div>
                <span className="footer-meta-key">Location</span>
                <span className="footer-meta-val">Toronto / London, ON</span>
              </div>
            </div>
          </div>
        </div>

        {/* Signature — scaled to footer width, painted once when the
            footer scrolls into view. Independent canvas; doesn't
            bleed across the rest of the viewport. */}
        <FooterSignature height={140} />

        {/* Bottom: copyright + sign-off */}
        <div className="footer-bottom">
          <span className="footer-copy">&copy; Daniel Tan {year}</span>
          <span className="footer-mark">Made with intent and the orange crab.</span>
        </div>
      </div>
    </footer>
  );
}
