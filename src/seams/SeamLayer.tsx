import { useEffect, useState } from "react";
import { MQ, reducedMotion } from "../motion";
import { useMedia } from "../useMedia";

/**
 * #seam-layer: the page's single fixed cross-section overlay (spec §4.4; see
 * overlay.ts). Mounted by App.tsx right after <PortfolioSections/>, so it is a
 * sibling of <main>. Rendered only where SEAM_MQ.fine holds (desktop width,
 * not touch-primary, motion OK), live: an MQ flip or a reduced-motion toggle
 * mounts / unmounts it without App re-rendering. Hidden until a seam claims it.
 */
export function SeamLayer() {
  const narrow = useMedia(MQ.narrow);
  const touch = useMedia(MQ.touchPrimary);
  const [reduced, setReduced] = useState(reducedMotion.value);
  useEffect(() => reducedMotion.subscribe(setReduced), []);
  if (narrow || touch || reduced) return null;
  return (
    <div
      id="seam-layer"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--seam-z, 12)",
        pointerEvents: "none",
        contain: "strict",
        visibility: "hidden",
      }}
    />
  );
}
