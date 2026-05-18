import { useEffect, useRef } from "react";

/**
 * The cat mascot with an organic, irregularly-paced blink — extracted
 * from `LoadingScreen` so the top-left brand mark can reuse the same
 * behaviour. Open frame is `cat.svg` (eye cutouts), closed frame is
 * `cat_blink.svg` (same silhouette, eyes filled in). Both images
 * render stacked and we toggle opacity, so the first blink has no
 * network race waiting for the closed asset to fetch.
 *
 * Blink pacing is intentionally irregular: random gap between
 * sequences, occasional quick double-blink — reads as alive rather
 * than a placeholder loop. Visuals are driven through refs
 * (`element.style.opacity = ...`) instead of React state so blinks
 * stay snappy even when the main thread is busy.
 */
const BLINK_CLOSED_MS = 100;
const BLINK_FADE_MS = 0;
const BLINK_FIRST_MIN_MS = 200;
const BLINK_FIRST_MAX_MS = 700;
const BLINK_GAP_MIN_MS = 1600;
const BLINK_GAP_MAX_MS = 3600;
const DOUBLE_BLINK_CHANCE = 0.28;
const DOUBLE_BLINK_GAP_MIN_MS = 180;
const DOUBLE_BLINK_GAP_MAX_MS = 300;
const CAT_OPEN_SRC = "/images/cat.svg";
const CAT_CLOSED_SRC = "/images/cat_blink.svg";

interface Props {
  /** Rendered width = height in CSS pixels. */
  size: number;
}

export function BlinkingCat({ size }: Props) {
  const openRef = useRef<HTMLImageElement>(null);
  const closedRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let cancelled = false;
    const pending = new Set<ReturnType<typeof setTimeout>>();
    const after = (ms: number, fn: () => void) => {
      const t = setTimeout(() => {
        pending.delete(t);
        if (!cancelled) fn();
      }, ms);
      pending.add(t);
    };
    const rand = (min: number, max: number) =>
      min + Math.random() * (max - min);

    const setEyes = (open: boolean) => {
      const o = openRef.current;
      const c = closedRef.current;
      if (o) o.style.opacity = open ? "1" : "0";
      if (c) c.style.opacity = open ? "0" : "1";
    };

    const closeThenOpen = (onOpened: () => void) => {
      setEyes(false);
      after(BLINK_CLOSED_MS, () => {
        setEyes(true);
        onOpened();
      });
    };

    const cycle = (isFirst = false) => {
      const gap = isFirst
        ? rand(BLINK_FIRST_MIN_MS, BLINK_FIRST_MAX_MS)
        : rand(BLINK_GAP_MIN_MS, BLINK_GAP_MAX_MS);
      after(gap, () => {
        closeThenOpen(() => {
          if (Math.random() < DOUBLE_BLINK_CHANCE) {
            after(
              rand(DOUBLE_BLINK_GAP_MIN_MS, DOUBLE_BLINK_GAP_MAX_MS),
              () => closeThenOpen(() => cycle()),
            );
          } else {
            cycle();
          }
        });
      });
    };

    cycle(true);
    return () => {
      cancelled = true;
      pending.forEach(clearTimeout);
    };
  }, []);

  const layer: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    transition: `opacity ${BLINK_FADE_MS}ms ease`,
    willChange: "opacity",
  };

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
      }}
      aria-hidden
    >
      <img
        ref={openRef}
        src={CAT_OPEN_SRC}
        alt=""
        style={{ ...layer, opacity: 1 }}
        draggable={false}
      />
      <img
        ref={closedRef}
        src={CAT_CLOSED_SRC}
        alt=""
        style={{ ...layer, opacity: 0 }}
        draggable={false}
      />
    </div>
  );
}
