import { useEffect, useState } from "react";
import { BlinkingCat } from "./BlinkingCat";
import { useIsMobile } from "./useIsMobile";

/**
 * Persistent chrome over the room view: just the brand cat (top-left).
 * `visible` fades the whole HUD in/out for desk-view transitions.
 *
 * The mobile reset/audio pills that used to sit bottom-left were removed
 * at the owner's request (they read as stray leftover controls on a
 * phone, where the room isn't the interaction surface). Desktop reset +
 * audio still live in the StatusBar pill.
 */
interface Props {
  /** Outer visibility: fades the whole HUD in/out for desk-view transitions. */
  visible: boolean;
}

const HUD_Z = 30;
const FADE_MS = 700;

// Shared with StatusBar (right) and the hero eyebrow. All three
// top-row elements anchor to the same TOP_STRIP_TOP baseline so the
// navbar reads as one editorial bar.
const TOP_STRIP_TOP = 20;
const TOP_STRIP_LEFT = 22;
const TOP_STRIP_CHIP_H = 40;
const BRAND_ICON_PX = 26;

export function RoomHUD({ visible }: Props) {
  const isMobile = useIsMobile();
  // Compress the brand chip on phones so it doesn't dominate the
  // narrower top-strip alongside small ui touchpoints. The visible cat
  // shrinks (chipH/iconPx) but the TAP target is forced to ≥44px below
  // via minWidth/minHeight so it stays comfortably tappable.
  const chipH = isMobile ? 34 : TOP_STRIP_CHIP_H;
  const iconPx = isMobile ? 22 : BRAND_ICON_PX;
  // Safe-area aware top/left offsets so the brand mark clears the
  // notch / rounded corner on phones (viewport-fit=cover).
  const topOffset = isMobile
    ? "calc(14px + env(safe-area-inset-top, 0px))"
    : TOP_STRIP_TOP;
  const leftOffset = isMobile
    ? "calc(14px + env(safe-area-inset-left, 0px))"
    : TOP_STRIP_LEFT;
  // Initial commit at 0 so the first paint runs before the rAF flip
  // to 1, otherwise the browser may collapse both values into one
  // style and skip the fade-in.
  const [shown, setShown] = useState(false);
  // Footer dodge: at the bottom-of-page rest position the footer's
  // INDEX heading lands exactly under the cat (the footer can't choose
  // what scrolls into the top-left corner). Fade the cat out whenever
  // that heading is inside the top strip of the viewport — the
  // JumpToTop FAB covers back-to-top down there anyway.
  const [dodge, setDodge] = useState(false);

  useEffect(() => {
    if (visible) {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
  }, [visible]);

  useEffect(() => {
    const target = document.getElementById("footer-index-label");
    if (!target || typeof IntersectionObserver === "undefined") return;
    // rootMargin shrinks the root to the viewport's top 12% band, so
    // "intersecting" means the heading overlaps the cat's strip.
    const io = new IntersectionObserver(
      ([entry]) => setDodge(!!entry?.isIntersecting),
      { rootMargin: "0px 0px -88% 0px" },
    );
    io.observe(target);
    return () => io.disconnect();
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        opacity: shown ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease`,
        zIndex: HUD_Z,
      }}
    >
      <a
        href="#top"
        aria-label="Daniel Tan, back to top"
        className="brand-mark"
        onClick={(e) => {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
        style={{
          position: "absolute",
          top: topOffset,
          left: leftOffset,
          // Visible chip stays compact; tap target padded to ≥44px on
          // mobile (touch ergonomics) while desktop keeps the tight chip.
          width: isMobile ? 44 : chipH,
          height: isMobile ? 44 : chipH,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: isMobile ? (44 - iconPx) / 2 : (chipH - iconPx) / 2,
          // Pull the larger tap box back so the cat stays visually at the
          // ~14px corner instead of shifting inward.
          margin: isMobile ? `${-(44 - chipH) / 2}px 0 0 ${-(44 - chipH) / 2}px` : 0,
          zIndex: HUD_Z,
          pointerEvents: dodge ? "none" : "auto",
          opacity: dodge ? 0 : 1,
          color: "var(--ink)",
          textDecoration: "none",
          userSelect: "none",
          transition: "transform 0.18s ease, opacity 0.3s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
        }}
      >
        <BlinkingCat size={iconPx} />
      </a>
    </div>
  );
}
