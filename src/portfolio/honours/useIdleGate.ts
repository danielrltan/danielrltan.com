import { useEffect, useState } from "react";

/**
 * True one idle period after `open` turns true (requestIdleCallback with a
 * timeout; a short timer where rIC is missing, i.e. Safari). Drops back to
 * false at once when `open` does, so an unmount is never delayed.
 *
 * Same pattern as Play's private gate (Other.tsx). The podium mount (WebGL
 * context, a dozen label textures, the scene build) is one long task; on
 * capable desktops the section-canvas gate opens at load, so without this it
 * lands in the loader lift. Started in the next idle period instead (capped,
 * so it is up long before the reader reaches Honours; the scroll build applies
 * the stored progress on the scene's first frame either way).
 */
export function useIdleGate(open: boolean, timeout: number): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!open) {
      setReady(false);
      return;
    }
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setReady(true), { timeout });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setReady(true), 120);
    return () => window.clearTimeout(id);
  }, [open, timeout]);
  return open && ready;
}
