import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "./useIsMobile";
import { SECTION_REGISTRY, findSectionElements } from "./sectionRegistry";
import { scrollToSection } from "./portfolio/Keypad";
import "./crt-channel-menu.css";

/**
 * CRT CHANNEL MENU — the section-nav "channel guide" the top-right status
 * card opens into. The card stays a tiny readout; activating it powers on
 * this fixed CRT console where each website section is a CHANNEL you tune
 * (arrows / hover) and JUMP into (Enter / click), which fires a halftone
 * boot-wipe and Lenis-scrolls the page to that section.
 *
 * Voice: reuses the house ASCII vocabulary verbatim — the SAME geometric
 * tile ramp + bayer4 dither as HeroGlyphRing, and 2D-canvas CRT passes
 * (scanline crawl, refresh roll, vignette, flicker, boot-wipe) in the
 * spirit of the Mac screen shader. ONE 2D canvas runs behind clean DOM
 * rows: the canvas is pure aria-hidden texture, the buttons carry all
 * interaction + a11y. Honors prefers-reduced-motion (no bloom / flash /
 * crawl / wipe; instant jump).
 */

interface Props {
  open: boolean;
  /** Current section index (the live "tuned channel" / where you are). */
  activeIdx: number;
  onClose: () => void;
}

// Panel metrics (CSS px). Width matches the resting status card (250px) so
// the guide reads as that card expanding, not a wider slab below it. Rows
// clear the 44px touch-target floor.
const HEADER_H = 36;
const ROW_H = 46;
const PANEL_W_DESKTOP = 250;
const CELL = 10; // glyph cell size, matches HeroGlyphRing CELL_PX
const RAMP = 7; // density ramp length (tileMask 0..7)

const SURFACE = "#ffffff"; // white tube interior
const ACCENT = "#e87040";
const ACCENT_HOT = "#ff6a2a";
const TEXT = "#0d0e10"; // ink text on white
const TEXT_DIM = "rgba(13, 14, 16, 0.6)"; // clears 4.5:1 on white
const SEP = "rgba(13, 14, 16, 0.3)"; // "/" separators

/* ── Ported house ASCII math (from HeroGlyphRing POST_FRAG) ───────────── */
function bayer2(x: number, y: number): number {
  const x2 = ((x % 2) + 2) % 2;
  const y2 = ((y % 2) + 2) % 2;
  return 3 * y2 + x2 * (2 - 4 * y2);
}
function bayer4(x: number, y: number): number {
  x = Math.floor(x);
  y = Math.floor(y);
  return (4 * bayer2(Math.floor(x / 2), Math.floor(y / 2)) + bayer2(x, y) + 0.5) / 16;
}
function vhash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let fx = x - ix;
  let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = vhash(ix, iy);
  const b = vhash(ix + 1, iy);
  const c = vhash(ix, iy + 1);
  const d = vhash(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Draw one procedural geometric tile (same vocabulary as the hero ring). */
function drawTile(ctx: CanvasRenderingContext2D, idx: number, x: number, y: number) {
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  if (idx <= 0) return;
  if (idx === 1) {
    const s = CELL * 0.26;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s); // small square
  } else if (idx === 2) {
    ctx.lineWidth = CELL * 0.12; // diagonal /
    ctx.beginPath();
    ctx.moveTo(x + CELL * 0.14, y + CELL * 0.86);
    ctx.lineTo(x + CELL * 0.86, y + CELL * 0.14);
    ctx.stroke();
  } else if (idx === 3) {
    ctx.lineWidth = CELL * 0.11; // cross X
    ctx.beginPath();
    ctx.moveTo(x + CELL * 0.16, y + CELL * 0.84);
    ctx.lineTo(x + CELL * 0.84, y + CELL * 0.16);
    ctx.moveTo(x + CELL * 0.16, y + CELL * 0.16);
    ctx.lineTo(x + CELL * 0.84, y + CELL * 0.84);
    ctx.stroke();
  } else if (idx === 4) {
    ctx.lineWidth = CELL * 0.13; // outline box
    const s = CELL * 0.6;
    ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
  } else if (idx === 5) {
    ctx.lineWidth = CELL * 0.12; // box + slash
    const s = CELL * 0.6;
    ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.32, cy + s * 0.32);
    ctx.lineTo(cx + s * 0.32, cy - s * 0.32);
    ctx.stroke();
  } else if (idx === 6) {
    const s = CELL * 0.6;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s); // inset square
  } else {
    const s = CELL * 0.86;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s); // full square
  }
}

export function CrtChannelMenu({ open, activeIdx, onClose }: Props) {
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [armed, setArmed] = useState(activeIdx);

  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const armedRef = useRef(armed);
  armedRef.current = armed;
  const activeRef = useRef(activeIdx);
  activeRef.current = activeIdx;
  const wipeStartRef = useRef(0);
  const tuneStartRef = useRef(0);
  // Offscreen coverage grid of the armed channel number (the "punched
  // figure": glyph density boosts inside the numeral so the number reads
  // as a figure made of the field). Rebuilt on armed/size change.
  const figureRef = useRef<{ cols: number; rows: number; grid: Float32Array } | null>(null);
  const figureKeyRef = useRef("");

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const PANEL_H = HEADER_H + SECTION_REGISTRY.length * ROW_H;
  const panelW = isMobile ? Math.min(Math.round(window.innerWidth * 0.78), PANEL_W_DESKTOP) : PANEL_W_DESKTOP;

  // ── mount / show lifecycle (so the exit transition can play) ──────────
  useEffect(() => {
    if (open) {
      setMounted(true);
      setArmed(activeRef.current);
    }
  }, [open]);
  useEffect(() => {
    if (!mounted) return;
    if (open) {
      const r = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(r);
    }
    setShown(false);
    const t = window.setTimeout(() => setMounted(false), 240);
    return () => window.clearTimeout(t);
  }, [open, mounted]);

  // Focus the armed row when the panel opens.
  useEffect(() => {
    if (shown) {
      const el = rowRefs.current[armedRef.current];
      if (el) el.focus({ preventScroll: true });
    }
  }, [shown]);

  // 3D depth: the panel is a perspective slab that parallax-tilts toward the
  // cursor and folds in on open. tiltRef holds the eased state; pointerTgtRef
  // the normalized cursor (-1..1). Both driven in the canvas rAF below.
  const tiltRef = useRef({ rx: 0, ry: 0, open: 0 });
  const pointerTgtRef = useRef({ x: 0, y: 0 });
  const shownRef = useRef(false);
  shownRef.current = shown;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onMove = (e: PointerEvent) => {
      pointerTgtRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointerTgtRef.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // ── canvas: glyph field + CRT passes (rAF while mounted) ──────────────
  useEffect(() => {
    if (!mounted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let raf = 0;

    const rebuildFigure = (W: number, H: number) => {
      const num = SECTION_REGISTRY[armedRef.current]?.number ?? "00";
      const key = `${W}x${H}:${num}`;
      if (figureKeyRef.current === key) return;
      figureKeyRef.current = key;
      const cols = Math.ceil(W / CELL);
      const rows = Math.ceil(H / CELL);
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.round(W));
      off.height = Math.max(1, Math.round(H));
      const octx = off.getContext("2d");
      const grid = new Float32Array(cols * rows);
      if (octx) {
        octx.fillStyle = "#000";
        octx.fillRect(0, 0, off.width, off.height);
        octx.fillStyle = "#fff";
        octx.font = `bold ${Math.round(H * 0.92)}px "Offbit", monospace`;
        octx.textAlign = "center";
        octx.textBaseline = "middle";
        octx.fillText(num, W / 2, H / 2 + H * 0.04);
        const img = octx.getImageData(0, 0, off.width, off.height).data;
        for (let gy = 0; gy < rows; gy++) {
          for (let gx = 0; gx < cols; gx++) {
            const sx = Math.min(off.width - 1, Math.round((gx + 0.5) * CELL));
            const sy = Math.min(off.height - 1, Math.round((gy + 0.5) * CELL));
            grid[gy * cols + gx] = img[(sy * off.width + sx) * 4]! / 255;
          }
        }
      }
      figureRef.current = { cols, rows, grid };
    };

    const draw = (now: number) => {
      const W = panelW;
      const H = PANEL_H;
      const cw = Math.round(W * dpr);
      const ch = Math.round(H * dpr);
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rebuildFigure(W, H);
      const fig = figureRef.current;

      // Tube interior.
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = SURFACE;
      ctx.fillRect(0, 0, W, H);

      const cols = Math.ceil(W / CELL);
      const rows = Math.ceil(H / CELL);
      const t = reduced ? 0 : now * 0.001;
      const armedY0 = HEADER_H + armedRef.current * ROW_H;
      const armedY1 = armedY0 + ROW_H;
      const wipeT = wipeStartRef.current
        ? (now - wipeStartRef.current) / 300
        : -1;
      const wipeY = wipeT >= 0 && wipeT <= 1.2 ? wipeT * H : -1;

      // Glyph field.
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          const px = gx * CELL;
          const py = gy * CELL;
          // Slow drifting density, kept low so type stays readable.
          let d =
            vnoise(gx * 0.16 + t * 0.25, gy * 0.16 - t * 0.18) * 0.5 + 0.06;
          // Punched figure: denser glyphs inside the armed numeral.
          if (fig && gx < fig.cols && gy < fig.rows) {
            d += fig.grid[gy * fig.cols + gx]! * 0.42;
          }
          // Armed-row band: lift density so the tuned channel glows.
          const inArmed = py >= armedY0 && py < armedY1;
          if (inArmed) d += 0.16;
          // Boot-wipe band sweeping down: ramp to full square.
          if (wipeY >= 0) {
            const dist = Math.abs(py - wipeY);
            if (dist < 26) d += (1 - dist / 26) * 1.2;
          }
          const dith = bayer4(gx, gy);
          let idx = Math.floor(d * RAMP + dith);
          if (idx <= 0) continue;
          if (idx > 7) idx = 7;
          // Brightness: faint base field on white, denser in the armed band
          // / figure. Alphas run higher than the black version so the orange
          // tiles read against white.
          let a = 0.2 + (inArmed ? 0.26 : 0);
          if (fig && gx < fig.cols && gy < fig.rows)
            a += fig.grid[gy * fig.cols + gx]! * 0.28;
          if (wipeY >= 0 && Math.abs(py - wipeY) < 26) a = 0.95;
          a = Math.min(0.98, a);
          // Hot facets use the more saturated accent so they pop on white
          // (a lighter peach would wash out).
          const hot = inArmed || (wipeY >= 0 && Math.abs(py - wipeY) < 26);
          ctx.strokeStyle = ctx.fillStyle = hot
            ? `rgba(255,106,42,${a})`
            : `rgba(232,112,64,${a})`;
          drawTile(ctx, idx, px, py);
        }
      }

      if (!reduced) {
        // Scanline crawl: faint grey lines drifting downward (subtle on white).
        ctx.fillStyle = "rgba(13,14,16,0.05)";
        const off = (t * 14) % 4;
        for (let y = off; y < H; y += 4) ctx.fillRect(0, y, W, 1.4);

        // Refresh-roll: a soft shadow band drifting down every ~3.6s. Ink
        // (darkening) rather than light so it reads on a white tube.
        const roll = ((now / 3600) % 1) * (H + 60) - 30;
        const grad = ctx.createLinearGradient(0, roll - 30, 0, roll + 30);
        grad.addColorStop(0, "rgba(13,14,16,0)");
        grad.addColorStop(0.5, "rgba(13,14,16,0.05)");
        grad.addColorStop(1, "rgba(13,14,16,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, roll - 30, W, 60);

        // Tune pulse: brief accent wash on the armed row (source-over so it
        // reads as a tint on white, not a wash-out).
        const tuneT = tuneStartRef.current
          ? (now - tuneStartRef.current) / 200
          : 2;
        if (tuneT >= 0 && tuneT <= 1) {
          ctx.fillStyle = `rgba(232,112,64,${0.09 * (1 - tuneT)})`;
          ctx.fillRect(3, armedY0, W, ROW_H);
        }
      }

      // Corner vignette: faint ink falloff at the edges (a screen rim).
      const vg = ctx.createRadialGradient(
        W / 2,
        H / 2,
        Math.min(W, H) * 0.35,
        W / 2,
        H / 2,
        Math.max(W, H) * 0.72,
      );
      vg.addColorStop(0, "rgba(13,14,16,0)");
      vg.addColorStop(1, "rgba(13,14,16,0.1)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
      // Warm corner cast so the accent reads warm.
      const wc = ctx.createRadialGradient(W, 0, 0, W, 0, Math.max(W, H));
      wc.addColorStop(0, "rgba(232,112,64,0.06)");
      wc.addColorStop(1, "rgba(232,112,64,0)");
      ctx.fillStyle = wc;
      ctx.fillRect(0, 0, W, H);

      // ── 3D depth: fold-in + cursor parallax tilt of the whole slab ──────
      const panel = panelRef.current;
      if (panel) {
        const tilt = tiltRef.current;
        const openTarget = shownRef.current ? 1 : 0;
        tilt.open += (openTarget - tilt.open) * 0.16;
        if (reduced) {
          panel.style.transform = "none";
        } else {
          const pt = pointerTgtRef.current;
          // Parallax target scaled by openness so it doesn't tilt while folded.
          const tgtRy = pt.x * 7 * tilt.open;
          const tgtRx = -pt.y * 5 * tilt.open;
          tilt.ry += (tgtRy - tilt.ry) * 0.1;
          tilt.rx += (tgtRx - tilt.rx) * 0.1;
          // Folds back from the top edge when closing (open 0 -> -60deg).
          const foldX = (1 - tilt.open) * -60;
          const baseY = -7;
          const baseX = 4;
          panel.style.transform =
            `rotateY(${(baseY + tilt.ry).toFixed(2)}deg) ` +
            `rotateX(${(baseX + tilt.rx + foldX).toFixed(2)}deg)`;
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mounted, panelW, PANEL_H, reduced]);

  // ── selection: boot-wipe → Lenis jump → close ────────────────────────
  const select = (i: number) => {
    const els = findSectionElements();
    const el = (els[i]?.el as HTMLElement | null) ?? null;
    if (!el) {
      onClose();
      return;
    }
    if (reduced) {
      scrollToSection(el, { immediate: true });
      onClose();
      return;
    }
    wipeStartRef.current = performance.now();
    window.setTimeout(() => {
      wipeStartRef.current = 0;
      scrollToSection(el, { duration: 1.1 });
      onClose();
    }, 300);
  };

  const moveArmed = (delta: number) => {
    const n = SECTION_REGISTRY.length;
    const next = (armedRef.current + delta + n) % n;
    setArmed(next);
    tuneStartRef.current = performance.now();
    rowRefs.current[next]?.focus({ preventScroll: true });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      moveArmed(1);
    } else if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      moveArmed(-1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(armedRef.current);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Home") {
      e.preventDefault();
      setArmed(0);
      rowRefs.current[0]?.focus({ preventScroll: true });
    } else if (e.key === "End") {
      e.preventDefault();
      const last = SECTION_REGISTRY.length - 1;
      setArmed(last);
      rowRefs.current[last]?.focus({ preventScroll: true });
    }
  };

  if (!mounted) return null;

  const top = isMobile
    ? "calc(58px + env(safe-area-inset-top, 0px))"
    : 70;
  const right = isMobile
    ? "calc(14px + env(safe-area-inset-right, 0px))"
    : 22;
  const armedNum = SECTION_REGISTRY[armed]?.number ?? "00";

  return (
    <>
      <div
        className="crt-menu-scrim"
        data-open={shown ? "true" : "false"}
        onClick={onClose}
        aria-hidden
      />
      <div
        className="crt-menu-stage"
        data-open={shown ? "true" : "false"}
        style={{
          position: "fixed",
          top,
          right,
          width: panelW,
          height: PANEL_H,
          zIndex: 60,
        }}
      >
      <div
        ref={panelRef}
        className="crt-menu"
        role="menu"
        aria-label="Section navigation"
        onKeyDown={onKeyDown}
        style={{
          position: "absolute",
          inset: 0,
          background: SURFACE,
          border: `1px solid rgba(232,112,64,0.45)`,
          boxShadow: "0 22px 48px -22px rgba(13,14,16,0.6)",
          overflow: "hidden",
          userSelect: "none",
          color: TEXT,
        }}
      >
        {/* Halftone / CRT texture canvas — pure decoration, behind the DOM. */}
        <canvas
          ref={canvasRef}
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
        <div className="crt-menu-flash" aria-hidden />

        {/* Header */}
        <div
          style={{
            position: "relative",
            height: HEADER_H,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 12px",
            borderBottom: "1px solid rgba(232,112,64,0.22)",
            fontFamily: '"VT323", monospace',
          }}
        >
          <span style={{ fontSize: 16, letterSpacing: "0.14em", color: TEXT_DIM }}>
            CHANNEL GUIDE
          </span>
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 13, letterSpacing: "0.1em", color: TEXT_DIM }}>
              CH
            </span>
            <span
              style={{
                fontFamily: '"Offbit", monospace',
                fontWeight: 700,
                fontSize: 18,
                color: ACCENT,
                transform: "translateY(2px)",
              }}
            >
              {armedNum}
            </span>
          </span>
        </div>

        {/* Channel rows */}
        <div style={{ position: "relative" }}>
          {SECTION_REGISTRY.map((s, i) => {
            const isActive = i === activeIdx;
            const isArmed = i === armed;
            return (
              <button
                key={s.number}
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className="crt-menu-row"
                role="menuitem"
                tabIndex={isArmed ? 0 : -1}
                onClick={() => select(i)}
                onMouseEnter={() => {
                  setArmed(i);
                  tuneStartRef.current = performance.now();
                }}
                aria-current={isActive ? "true" : undefined}
                style={{
                  position: "relative",
                  width: "100%",
                  height: ROW_H,
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "0 10px 0 12px",
                  // Active channel pops FORWARD off the slab (a lifted plate
                  // with its own shadow) so the tuned row reads with depth.
                  background: isActive ? SURFACE : "transparent",
                  border: "none",
                  borderLeft: isActive
                    ? `3px solid ${ACCENT}`
                    : "3px solid transparent",
                  boxShadow: isActive
                    ? "0 6px 16px -6px rgba(232,112,64,0.55)"
                    : "none",
                  transform: isActive ? "scale(1.035)" : "none",
                  zIndex: isActive ? 2 : 1,
                  color: isActive ? TEXT : TEXT_DIM,
                  cursor: "pointer",
                  textAlign: "left",
                  font: "inherit",
                }}
              >
                {/* armed caret */}
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    fontFamily: '"VT323", monospace',
                    fontSize: 16,
                    color: ACCENT,
                    opacity: isArmed ? 1 : 0,
                  }}
                >
                  &gt;
                </span>
                <span
                  style={{
                    fontFamily: '"Offbit", monospace',
                    fontWeight: 700,
                    fontSize: 20,
                    color: ACCENT,
                    transform: "translateY(2px)",
                    minWidth: 30,
                  }}
                >
                  {s.number}
                </span>
                <span
                  aria-hidden
                  style={{ color: SEP, fontSize: 13 }}
                >
                  /
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 14.5,
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: isArmed ? TEXT : undefined,
                  }}
                >
                  {s.label}
                </span>
                {/* signal-strength tiles (house ramp shapes) */}
                <span
                  aria-hidden
                  style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
                >
                  <span
                    style={{
                      width: 4,
                      height: 4,
                      background: ACCENT,
                      opacity: isArmed ? 1 : 0.45,
                    }}
                  />
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      border: `1px solid ${ACCENT}`,
                      opacity: isArmed ? 1 : 0.45,
                    }}
                  />
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      background: isArmed ? ACCENT_HOT : ACCENT,
                      opacity: isArmed ? 1 : 0.45,
                    }}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      </div>
    </>
  );
}
