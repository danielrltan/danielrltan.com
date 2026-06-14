import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "./useIsMobile";
import { SECTION_REGISTRY, findSectionElements } from "./sectionRegistry";
import { scrollToSection } from "./portfolio/Keypad";
import "./crt-channel-menu.css";

/**
 * OVERDRIVE NAV menu — the jump menu the top-right status card opens into.
 *
 * Persona-flavoured DIMENSION reskinned to this site: angular orange/ink
 * shards (one per section) that SLAM IN on a staggered diagonal cascade,
 * tilted in 3D, glossy ("CS:GO skin" sheen), bold Offbit numerals. The
 * active section is the popped orange shard. Selecting one ejects the stack
 * and Lenis-scrolls the page there. Clean DOM buttons carry interaction +
 * a11y; the look is pure CSS (see crt-channel-menu.css). Honors
 * prefers-reduced-motion (no cascade / tilt / skew; flat list, instant jump).
 */

interface Props {
  open: boolean;
  /** Current section index (the live "you are here" shard). */
  activeIdx: number;
  onClose: () => void;
}

export function CrtChannelMenu({ open, activeIdx, onClose }: Props) {
  const isMobile = useIsMobile();
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<"open" | "closing">("open");
  const [armed, setArmed] = useState(activeIdx);

  const stackRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const armedRef = useRef(armed);
  armedRef.current = armed;
  const activeRef = useRef(activeIdx);
  activeRef.current = activeIdx;

  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // mount / open / closing lifecycle (so the eject cascade can play).
  useEffect(() => {
    if (open) {
      setMounted(true);
      setPhase("open");
      setArmed(activeRef.current);
    } else if (mounted) {
      setPhase("closing");
      const t = window.setTimeout(() => setMounted(false), 340);
      return () => window.clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus the armed shard once the stack is open.
  useEffect(() => {
    if (mounted && phase === "open") {
      const el = rowRefs.current[armedRef.current];
      if (el) el.focus({ preventScroll: true });
    }
  }, [mounted, phase]);

  // INTERACTIVE 3D: the whole plane tilts toward the cursor as you move the
  // mouse (the "fiddle with it" depth). rAF-throttled; CSS smooths it.
  useEffect(() => {
    if (!mounted) return;
    const reducedM =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedM) return;
    let raf = 0;
    let lx = 0;
    let ly = 0;
    const apply = () => {
      raf = 0;
      const nx = (lx / window.innerWidth) * 2 - 1;
      const ny = (ly / window.innerHeight) * 2 - 1;
      const st = stackRef.current;
      if (st) {
        st.style.setProperty("--ry", `${(nx * 13).toFixed(2)}deg`);
        st.style.setProperty("--rx", `${(-ny * 9).toFixed(2)}deg`);
      }
    };
    const onMove = (e: PointerEvent) => {
      lx = e.clientX;
      ly = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [mounted]);

  const select = (i: number) => {
    const el = (findSectionElements()[i]?.el as HTMLElement | null) ?? null;
    if (!el) {
      onClose();
      return;
    }
    if (reduced) {
      scrollToSection(el, { immediate: true });
      onClose();
      return;
    }
    // Let the eject cascade start, then fly the page over.
    onClose();
    window.setTimeout(() => scrollToSection(el, { duration: 1.1 }), 170);
  };

  const moveArmed = (delta: number) => {
    const n = SECTION_REGISTRY.length;
    const next = (armedRef.current + delta + n) % n;
    setArmed(next);
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

  const right = isMobile
    ? "calc(14px + env(safe-area-inset-right, 0px))"
    : 30;
  const headTop = isMobile ? "calc(62px + env(safe-area-inset-top, 0px))" : 80;
  const stackTop = isMobile
    ? "calc(98px + env(safe-area-inset-top, 0px))"
    : 116;
  const shardW = isMobile ? "min(76vw, 300px)" : 296;

  return (
    <div
      className="navx-stage"
      data-open={phase === "open" ? "true" : "false"}
      data-closing={phase === "closing" ? "true" : "false"}
    >
      <div className="navx-scrim" onClick={onClose} aria-hidden />

      <div className="navx-head" style={{ top: headTop, right }} aria-hidden>
        JUMP&nbsp;/
      </div>

      <div
        ref={stackRef}
        className="navx-stack"
        role="menu"
        aria-label="Section navigation"
        onKeyDown={onKeyDown}
        style={{ top: stackTop, right }}
      >
        {SECTION_REGISTRY.map((s, i) => {
          const isActive = i === activeIdx;
          const isArmed = i === armed;
          return (
            <div
              key={s.number}
              className="navx-slot"
              style={{ "--i": i } as React.CSSProperties}
            >
              <button
                ref={(el) => {
                  rowRefs.current[i] = el;
                }}
                className="navx-shard"
                role="menuitem"
                tabIndex={isArmed ? 0 : -1}
                data-active={isActive ? "true" : "false"}
                data-armed={isArmed ? "true" : "false"}
                aria-current={isActive ? "true" : undefined}
                onClick={() => select(i)}
                onMouseEnter={() => setArmed(i)}
                style={{ width: shardW }}
              >
                <span className="navx-num">{s.number}</span>
                <span className="navx-label">{s.label}</span>
                <span className="navx-tag" aria-hidden>
                  {isActive ? "HERE" : "JUMP"}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
