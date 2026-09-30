import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { track } from "./analytics";
import { HERO } from "./motion";
import { scrollToY } from "./scroll";
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

export function JumpToTop({ visible = true }: Props) {
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

  const shown = useShownAfterPaint(visible && pastHero);

  return (
    <button
      type="button"
      className="hud-btn hud-chrome hud-chrome--rise"
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
        // indicator / rounded corner on phones (viewport-fit=cover).
        right: "max(18px, env(safe-area-inset-right, 0px) + 14px)",
        bottom: "max(18px, env(safe-area-inset-bottom, 0px) + 14px)",
        zIndex: 35,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        // 44×44 minimum touch target (was 38×38, below the tap floor).
        width: 44,
        height: 44,
        padding: 0,
        // Flat sharp square, matching the sitewide shape lock (radius 0)
        // and the flat chip language; the glass circle was off-voice.
        background: "var(--bg-surface, #ffffff)",
        border: "1px solid var(--ink-hairline)",
        borderRadius: 0,
        boxShadow: "0 8px 24px -16px rgba(13, 14, 16, 0.25)",
        color: "var(--ink)",
        cursor: "pointer",
      }}
    >
      <ArrowUp size={15} strokeWidth={2} />
    </button>
  );
}
