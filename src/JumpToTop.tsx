import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { track } from "./analytics";
import { HERO, MQ } from "./motion";
import { scrollToY } from "./scroll";
import { useMedia } from "./useMedia";
import { useShownAfterPaint } from "./RoomHUD";
import "./crt-channel-menu.css"; // HUD CHROME entrance states (.hud-chrome)

/**
 * Persistent jump-to-top pill, bottom-right.
 *
 * Shown while `visible` (App's HUD reveal; defaults to true so a plain mount
 * keeps working) AND the page is past the hero: scrollY >= HERO.hudRevealVh
 * viewports, the same line the HUD reveals on, so the brand, dial and this
 * button enter together (it used to wait for 8% of the whole document,
 * ~1.5-1.9vh, and arrive on its own). It hides again back over the hero, where
 * there's nowhere to jump to.
 *
 * COMPACT SCREENS (MQ.compact: phones, a phone on its side). The 44x44 square
 * at right/bottom 18 sat on top of right-aligned content (the Honours metrics,
 * the contact hosts) for most of the page. There:
 *   - the visible square shrinks to 34px, while the button itself keeps the
 *     44x44 hit area (the square is an inner span; the button is transparent);
 *   - it gets the HUD top strip's floating treatment (solid surface + a real
 *     shadow) so it reads as chrome over content, not part of it;
 *   - it waits until About has scrolled fully off the top (on a phone About is
 *     a long stacked column, and "back to top" from there is one flick);
 *   - it steps aside once the footer's top has risen above 70% of the
 *     screen: the footer carries its own back-to-top (its index starts with
 *     the hero link) and the FAB was covering its right column. Not on the
 *     footer's first sliver: landing on Contact shows the footer's top edge,
 *     and the FAB is still the only way up from there.
 * Desktop is unchanged.
 *
 * Entrance/exit: the shared HUD CHROME transition (crt-channel-menu.css),
 * rising from +--chrome-lift, a --stagger behind the brand.
 */
interface Props {
  visible?: boolean;
}

/** Past-the-hero test, no layout read (innerHeight only changes on resize). */
function pastHeroNow(): boolean {
  return window.scrollY >= HERO.hudRevealVh * (window.innerHeight || 1);
}

/**
 * Compact-only gates, both IntersectionObserver driven (no scroll handler, no
 * layout reads): `pastAbout` = About's box is entirely above the viewport;
 * `footerIn` = the footer's top is above 70% of the viewport. The sections
 * can mount after the HUD (lazy sections, the loader), so a missing element
 * is retried on scroll until it exists.
 */
function useCompactGates(enabled: boolean) {
  const [pastAbout, setPastAbout] = useState(false);
  const [footerIn, setFooterIn] = useState(false);
  useEffect(() => {
    if (!enabled || typeof IntersectionObserver === "undefined") return;
    let aboutIo: IntersectionObserver | null = null;
    let footerIo: IntersectionObserver | null = null;
    const attach = () => {
      if (!aboutIo) {
        const about = document.querySelector(".portfolio-about");
        if (about) {
          aboutIo = new IntersectionObserver(([e]) => {
            if (!e) return;
            setPastAbout(!e.isIntersecting && e.boundingClientRect.top < 0);
          });
          aboutIo.observe(about);
        }
      }
      if (!footerIo) {
        // The whole footer (it runs to the end of the document, so once its
        // top passes the line it stays "in" all the way down; an IO on a
        // smaller target missed instant jumps that skip straight past it).
        const footer = document.querySelector(".portfolio-footer");
        if (footer) {
          footerIo = new IntersectionObserver(([e]) => setFooterIn(!!e?.isIntersecting), {
            rootMargin: "0px 0px -30% 0px",
          });
          footerIo.observe(footer);
        }
      }
      if (aboutIo && footerIo) window.removeEventListener("scroll", attach);
    };
    window.addEventListener("scroll", attach, { passive: true });
    attach();
    return () => {
      window.removeEventListener("scroll", attach);
      aboutIo?.disconnect();
      footerIo?.disconnect();
      setPastAbout(false);
      setFooterIn(false);
    };
  }, [enabled]);
  return { pastAbout, footerIn };
}

export function JumpToTop({ visible = true }: Props) {
  const compact = useMedia(MQ.compact);
  // Own rAF-coalesced scroll handler computing only the boolean; setState
  // fires solely when it flips.
  const [pastHero, setPastHero] = useState(() =>
    typeof window === "undefined" ? false : pastHeroNow(),
  );
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const next = pastHeroNow();
      setPastHero((prev) => (prev === next ? prev : next));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  const { pastAbout, footerIn } = useCompactGates(compact);

  const shown = useShownAfterPaint(
    visible && pastHero && (!compact || (pastAbout && !footerIn)),
  );

  // Desktop: the original 44px flat square. Compact: a transparent 44px hit
  // box carrying a 34px floating square (.hud-btn-face, index.css).
  const face = compact
    ? {
        background: "transparent",
        border: "none",
        boxShadow: "none",
      }
    : {
        // Flat sharp square, matching the sitewide shape lock (radius 0)
        // and the flat chip language; the glass circle was off-voice.
        background: "var(--bg-surface, #ffffff)",
        border: "1px solid var(--ink-hairline)",
        boxShadow: "0 8px 24px -16px rgba(13, 14, 16, 0.25)",
      };

  return (
    <button
      type="button"
      className={`hud-btn hud-chrome hud-chrome--rise${compact ? " hud-btn--compact" : ""}`}
      data-hud={shown ? "shown" : "hidden"}
      inert={!shown}
      aria-label="Jump to top"
      onClick={() => {
        track("jump_to_top");
        // Glide under 3 viewports, a covered cut beyond (so the pins aren't
        // whipped past), instant under reduced motion. See scroll.ts.
        void scrollToY(0, { preset: "jump" });
      }}
      style={{
        ["--hud-delay" as string]: "var(--stagger)",
        position: "fixed",
        // Safe-area aware bottom-right so the button clears the home
        // indicator / rounded corner on phones (viewport-fit=cover). Compact:
        // the 34px face sits 5px inside the 44px hit box, so the box goes 5px
        // further out to keep the face ~13px off the edges.
        right: compact
          ? "max(8px, env(safe-area-inset-right, 0px) + 6px)"
          : "max(18px, env(safe-area-inset-right, 0px) + 14px)",
        bottom: compact
          ? "max(8px, env(safe-area-inset-bottom, 0px) + 6px)"
          : "max(18px, env(safe-area-inset-bottom, 0px) + 14px)",
        zIndex: 35,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        // 44×44 minimum touch target (was 38×38, below the tap floor).
        width: 44,
        height: 44,
        padding: 0,
        borderRadius: 0,
        color: "var(--ink)",
        cursor: "pointer",
        ...face,
      }}
    >
      {compact ? (
        <span className="hud-btn-face" aria-hidden>
          <ArrowUp size={14} strokeWidth={2.25} />
        </span>
      ) : (
        <ArrowUp size={15} strokeWidth={2} />
      )}
    </button>
  );
}
