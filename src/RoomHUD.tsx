import { useEffect, useRef, useState } from "react";
import { SignatureMark } from "./SignatureMark";
import { useIsMobile } from "./useIsMobile";
import { scrollToY } from "./scroll";
import "./crt-channel-menu.css"; // HUD CHROME entrance states (.hud-chrome)

/**
 * `visible` delayed until the hidden state has been painted, so a component
 * that MOUNTS already visible still plays its entrance transition (a style
 * change needs a painted "before" state). Two rAFs: the first lands before
 * the paint that shows the hidden state, the second flips it after. Hiding is
 * immediate. Shared by the HUD chrome (RoomHUD, StatusBar, JumpToTop) so the
 * three enter on the same frame.
 *
 * The double rAF only matters for a mount-with-visible. A component that has
 * already been on screen (hidden) for a painted frame, like the HUD
 * PRE-MOUNTED at `ready` (spec §5 O6 phase B), flips to shown in the effect
 * right after `visible` turns true: ~33-50 ms sooner on the 1.0vh reveal.
 */
export function useShownAfterPaint(visible: boolean): boolean {
  const [shown, setShown] = useState(false);
  // True once the hidden state has been painted at least once since mount.
  const paintedRef = useRef(false);
  useEffect(() => {
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        paintedRef.current = true;
      });
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, []);
  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    if (paintedRef.current) {
      setShown(true);
      return;
    }
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => setShown(true));
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [visible]);
  return shown;
}

/**
 * Top-left brand mark: Daniel's signature in a white tile. `visible` fades
 * it in once the visitor has scrolled past the hero (App.tsx's hudVisible),
 * and it dodges the footer so it never sits over the sign-off.
 */
interface Props {
  /** Outer visibility: fades the whole HUD in/out for desk-view transitions. */
  visible: boolean;
}

const HUD_Z = 30;

// Shared with StatusBar (right) and the hero eyebrow. All three
// top-row elements anchor to the same TOP_STRIP_TOP baseline so the
// navbar reads as one editorial bar.
const TOP_STRIP_TOP = 20;
const TOP_STRIP_LEFT = 22;
// Chip height matches the SectionDial bar (.snc-dial, 54px) so the two
// top-row tiles read as one system: white tile left, white tile right.
const TOP_STRIP_CHIP_H = 54;
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
  // Entrance: the HUD chrome's shared hidden → shown transition (opacity +
  // a --chrome-lift drop over --chrome-dur; see HUD CHROME in
  // crt-channel-menu.css). The brand leads; the dial and jump-to-top follow a
  // --stagger behind it.
  const shown = useShownAfterPaint(visible);
  // Footer dodge: at the bottom-of-page rest position the footer's
  // INDEX heading lands exactly under the cat (the footer can't choose
  // what scrolls into the top-left corner). Fade the cat out whenever
  // that heading is inside the top strip of the viewport — the
  // JumpToTop FAB covers back-to-top down there anyway.
  const [dodge, setDodge] = useState(false);

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
      // Hidden = opacity 0 + visibility hidden + inert, so the brand link is
      // not clickable or focusable while invisible over the hero (it used to
      // keep pointer-events:auto inside an opacity-0 wrapper).
      className="hud-chrome hud-chrome--plain"
      data-hud={shown ? "shown" : "hidden"}
      inert={!shown}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: HUD_Z,
      }}
    >
      <a
        href="#top"
        aria-label="Daniel Tan, back to top"
        className="brand-mark"
        onClick={(e) => {
          e.preventDefault();
          // Glide under 3 viewports, a covered cut beyond, instant under
          // reduced motion (scroll.ts). Never native smooth scroll.
          void scrollToY(0, { preset: "jump" });
        }}
        style={{
          position: "absolute",
          top: topOffset,
          left: leftOffset,
          // The signature is WIDE (aspect ~2.6:1), so the tile sizes to its
          // content (width:auto) rather than a square. Height is the tap
          // target (≥44px on mobile) and matches the dial bar on desktop.
          //
          // SURFACE (see .brand-mark in index.css): the mark used to float bare
          // over the page, so every section's corner header ("01 —
          // danielrltan.com", the giant wordmark) scrolled straight through the
          // orange strokes and the two orange marks tangled. It now sits on a
          // solid white tile — the same tile language as the SectionDial on the
          // right — so whatever scrolls beneath is cleanly masked, and the top
          // strip reads as ONE bar with a tile at each end.
          width: "auto",
          height: isMobile ? 44 : chipH,
          minWidth: 44,
          padding: isMobile ? "0 12px" : "0 16px",
          zIndex: HUD_Z,
          pointerEvents: dodge ? "none" : "auto",
          opacity: dodge ? 0 : 1,
          // currentColor drives the signature stroke (SignatureMark uses
          // stroke="currentColor"). International Orange on the white tile.
          color: "var(--accent)",
        }}
      >
        <SignatureMark height={iconPx} />
      </a>
    </div>
  );
}
