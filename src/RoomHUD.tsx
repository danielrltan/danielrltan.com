import { useEffect, useState } from "react";
import { SignatureMark } from "./SignatureMark";
import { useIsMobile } from "./useIsMobile";

/**
 * Persistent chrome over the room view: the brand mark (top-left) — now
 * Daniel's signature (the cat mascot was retired). `visible` fades the whole
 * HUD in/out for desk-view transitions.
 *
 * The reset/audio pills that used to sit bottom-left were removed
 * entirely at the owner's request (they read as stray leftover controls,
 * and on a phone the room isn't the interaction surface). No audio
 * control exists anymore; room reset lives on the keyboard shortcut.
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
          // The signature is WIDE (aspect ~2.6:1), so the mark sizes to its
          // content (width:auto) rather than a square chip. Height is the tap
          // target (≥44px on mobile); a little left-aligned padding gives the
          // gesture air without shifting it off the corner.
          width: "auto",
          height: isMobile ? 44 : chipH,
          minWidth: 44,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "flex-start",
          padding: "0 6px",
          zIndex: HUD_Z,
          pointerEvents: dodge ? "none" : "auto",
          opacity: dodge ? 0 : 1,
          // currentColor drives the signature stroke (SignatureMark uses
          // stroke="currentColor"). International Orange: the mark only reveals
          // AFTER the hero (see `visible` in App.tsx), so it always sits over the
          // light content sections, where orange reads on-brand. (Dark ink was
          // unreadable on the orange hero, and the hero already carries the big
          // signature wordmark — so the small mark is hidden there entirely.)
          color: "var(--accent)",
          textDecoration: "none",
          userSelect: "none",
          transition: "transform 0.18s ease, opacity 0.3s ease",
        }}
        onPointerEnter={(e) => {
          // Mouse/trackpad only: on touch, the lift would stick until the next
          // tap elsewhere (mouseenter has no touch counterpart that releases).
          if (e.pointerType !== "mouse") return;
          e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onPointerLeave={(e) => {
          e.currentTarget.style.transform = "translateY(0)";
        }}
      >
        <SignatureMark height={iconPx} />
      </a>
    </div>
  );
}
