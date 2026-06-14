import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "./useIsMobile";
import { SECTION_REGISTRY, findSectionElements } from "./sectionRegistry";
import { NavSpillMenu } from "./NavSpillMenu";

/**
 * Top-right section indicator: Offbit numeral + Geist label + a stepped
 * pixel-block scroll meter. Section detection reads live rects so it
 * stays accurate as pinned sections grow their pin spacers. (The
 * faux-mono readout, live clock, and reset/ambience buttons were
 * removed per design; room reset still lives on the keyboard shortcut.
 * The previous circular SVG progress ring was retired with the pixel
 * retrofuturism pass: round chrome fought the blocky type language.)
 */

// Pixel meter: scroll progress quantised into this many blocks. The
// stepped fill (no tween) is deliberate — steps read as hardware.
const METER_SEGMENTS = 7;
const METER_TRACK = "rgba(13, 14, 16, 0.14)";

export function StatusBar() {
  const isMobile = useIsMobile();
  const [activeIdx, setActiveIdx] = useState(0);
  // Nav-menu open state: the resting card is a button that opens the CRT
  // "channel guide" (CrtChannelMenu) to jump between sections.
  const [menuOpen, setMenuOpen] = useState(false);
  // Scroll progress fills the meter blocks via direct DOM mutation on
  // this ref, so the StatusBar tree never reconciles on a scroll frame.
  const meterRef = useRef<HTMLDivElement>(null);

  // Active section = the deepest one whose top has passed 45% of viewport.
  //
  // We read LIVE getBoundingClientRect() on a rAF-coalesced scroll listener
  // rather than caching IntersectionObserver entry rects. The IO approach
  // cached each section's top from the snapshot taken at a threshold
  // crossing — but the GSAP-pinned sections (Mac / Work / Other) sit
  // `position: fixed` during their pin, so their real top changes (0 while
  // pinned → moving once released) WITHOUT firing new IO crossings. Those
  // stale tops made the pill lag a whole section behind at the pin
  // boundaries. Live rects on the ~7 section elements per scroll frame are
  // cheap and always correct. setState only fires on a genuine index change.
  useEffect(() => {
    const found = findSectionElements();
    let lastIdx = -1;
    let raf = 0;
    let lastInput = 0; // last scroll/resize time
    const measure = () => {
      const vh = window.innerHeight || 1;
      let bestIdx = 0;
      for (let i = 0; i < found.length; i++) {
        const el = found[i]!.el;
        if (!el) continue;
        if (el.getBoundingClientRect().top <= vh * 0.45) bestIdx = i;
      }
      if (bestIdx !== lastIdx) {
        lastIdx = bestIdx;
        setActiveIdx(bestIdx);
      }
    };
    // Keep measuring for ~1.3s after the last scroll/resize. A scroll fires
    // one event, but GSAP's pinned sections (Mac/Work/Other) ease into place
    // over ~1s of SCRUB *without* further scroll events — so a scroll-only
    // listener would read a mid-transition rect and never re-check, leaving
    // the pill one section off when you stop near a pin boundary. Ticking
    // through the settle window keeps it correct, then idles (no per-frame
    // layout cost when nothing's moving).
    const SETTLE_MS = 1800;
    const tick = () => {
      measure();
      if (performance.now() - lastInput < SETTLE_MS) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };
    const onInput = () => {
      lastInput = performance.now();
      if (!raf) raf = requestAnimationFrame(tick);
    };
    measure();
    window.addEventListener("scroll", onInput, { passive: true });
    window.addEventListener("resize", onInput, { passive: true });
    return () => {
      window.removeEventListener("scroll", onInput);
      window.removeEventListener("resize", onInput);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    let raf = 0;
    let lastFilled = -1;
    const update = () => {
      const max = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const progress = Math.min(1, Math.max(0, window.scrollY / max));
      // ceil-with-floor: any progress > 0 lights the first block, full
      // scroll lights all of them.
      const filled =
        progress <= 0
          ? 0
          : Math.max(1, Math.round(progress * METER_SEGMENTS));
      if (filled === lastFilled) return;
      lastFilled = filled;
      const el = meterRef.current;
      if (!el) return;
      for (let i = 0; i < el.children.length; i++) {
        (el.children[i] as HTMLElement).style.background =
          i < filled ? "var(--accent)" : METER_TRACK;
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Global hotkey: "m" or "/" toggles the channel menu. Ignored while
  // typing in a field so it never eats input. (Esc / outside-click close
  // are owned by CrtChannelMenu itself.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M" && e.key !== "/") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      setMenuOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = SECTION_REGISTRY[activeIdx] ?? SECTION_REGISTRY[0]!;
  const cardAria = `Open section menu. Current: ${active.number} ${active.label}`;

  // Shared pixel scroll meter: a row of square cells that fill with the
  // accent as the page scrolls. Stepped on purpose (no transition) so it
  // reads as a hardware segment display, matching the OffBit/dot-matrix
  // type language. Fill is mutated directly by the scroll listener
  // (meterRef), no React reconcile per frame.
  const meter = (cellW: number, cellH: number) => (
    <div
      ref={meterRef}
      aria-hidden
      style={{ display: "flex", gap: 2, flex: "0 0 auto" }}
    >
      {Array.from({ length: METER_SEGMENTS }, (_, i) => (
        <span
          key={i}
          style={{ width: cellW, height: cellH, background: METER_TRACK }}
        />
      ))}
    </div>
  );

  // The resting card is now a BUTTON that opens the channel menu. Footprint
  // stays identical — only behaviour + a CSS hover/focus tell are added
  // (.status-nav-card lives in crt-channel-menu.css). Shared across both
  // the mobile + desktop branches.
  const cardButtonProps = {
    className: "status-nav-card",
    role: "button" as const,
    tabIndex: 0,
    "aria-haspopup": "menu" as const,
    "aria-expanded": menuOpen,
    "aria-label": cardAria,
    onClick: () => setMenuOpen((o) => !o),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setMenuOpen((o) => !o);
      }
    },
  };
  const menu = (
    <NavSpillMenu
      open={menuOpen}
      activeIdx={activeIdx}
      onClose={() => setMenuOpen(false)}
    />
  );

  // Offbit numeral + Geist label + progress ring. No faux-mono, no live
  // clock. Offbit appears ONLY as the display numeral (a deliberate
  // accent), the label is clean Geist. Anchors top-right.
  if (isMobile) {
    return (
      <>
      <div
        {...cardButtonProps}
        data-active-section={active.number}
        style={{
          position: "fixed",
          top: "calc(14px + env(safe-area-inset-top, 0px))",
          right: "calc(14px + env(safe-area-inset-right, 0px))",
          maxWidth: "min(64vw, 240px)",
          zIndex: 40,
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 12px",
          background: "rgba(255, 255, 255, 0.86)",
          backdropFilter: "blur(12px) saturate(125%)",
          WebkitBackdropFilter: "blur(12px) saturate(125%)",
          border: "1px solid var(--ink-hairline)",
          // Sharp angular chrome (CSS .status-nav-card clips a Persona corner).
          borderRadius: 0,
          boxShadow: "0 10px 22px -16px rgba(13, 14, 16, 0.5)",
          color: "var(--ink)",
          userSelect: "none",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            fontFamily: '"Offbit", monospace',
            fontWeight: 700,
            fontSize: 22,
            lineHeight: 1,
            color: "var(--accent)",
            flex: "0 0 auto",
            // Offbit sits ~13% high in its line box; nudge to optically centre.
            transform: "translateY(3px)",
          }}
        >
          {active.number}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {active.label}
        </span>
        {meter(3, 9)}
        <span className="nav-open-hint" aria-hidden>
          OPEN /
        </span>
      </div>
      {menu}
      </>
    );
  }

  return (
    <>
    <div
      {...cardButtonProps}
      data-active-section={active.number}
      style={{
        position: "fixed",
        top: 20,
        right: 22,
        zIndex: 40,
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 14px 8px 12px",
        background: "rgba(255, 255, 255, 0.86)",
        backdropFilter: "blur(12px) saturate(125%)",
        WebkitBackdropFilter: "blur(12px) saturate(125%)",
        border: "1px solid var(--ink-hairline)",
        // Sharp angular chrome (CSS .status-nav-card clips a Persona corner).
        borderRadius: 0,
        boxShadow: "0 12px 28px -18px rgba(13, 14, 16, 0.55)",
        color: "var(--ink)",
        userSelect: "none",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          fontFamily: '"Offbit", monospace',
          fontWeight: 700,
          fontSize: 30,
          lineHeight: 1,
          color: "var(--accent)",
          // Offbit sits ~13% high in its line box, so flex-centering the box
          // leaves the glyph optically high. Nudge down to centre it.
          transform: "translateY(4px)",
        }}
      >
        {active.number}
      </span>
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 3,
          lineHeight: 1,
          // Fixed width so the pill doesn't resize between "Work" and
          // "Bits and pieces".
          minWidth: 128,
        }}
      >
        <span
          style={{
            fontSize: 9.5,
            fontWeight: 600,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "rgba(13, 14, 16, 0.5)",
          }}
        >
          Section
        </span>
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            letterSpacing: "-0.01em",
            whiteSpace: "nowrap",
          }}
        >
          {active.label}
        </span>
      </span>
      {meter(4, 12)}
      <span className="nav-open-hint" aria-hidden>
        OPEN /
      </span>
    </div>
    {menu}
    </>
  );
}
