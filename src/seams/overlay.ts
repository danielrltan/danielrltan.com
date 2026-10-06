/**
 * #seam-layer claim / release (spec §4.4, rule §0.7).
 *
 * The page has at most ONE fixed cross-section overlay: #seam-layer, a sibling
 * of <main> at z 12 (above the hero layer, below JumpToTop and the HUD),
 * pointer-events none. A per-seam overlay or a second fixed layer was rejected
 * (§8): stacked fixed layers are what made the old boundaries read as bars.
 * It exists only on desktop with a fine pointer and motion OK (SeamLayer.tsx),
 * and its single claimant is the projects -> work relay pixel.
 *
 * The layer stays `visibility: hidden` (no paint, no compositing cost) except
 * while a seam holds it.
 */
let owner: string | null = null;

const layer = () => (typeof document === "undefined" ? null : document.getElementById("seam-layer"));

/** A fresh child div of the layer for `id` (the layer becomes visible), or null when the layer is absent. Throws in dev if another seam holds it. */
export function claimOverlay(id: string): HTMLElement | null {
  const el = layer();
  if (!el) return null;
  if (owner && owner !== id) {
    if (import.meta.env.DEV) throw new Error(`#seam-layer is held by '${owner}', '${id}' cannot claim it`);
    return null;
  }
  owner = id;
  el.replaceChildren();
  const child = document.createElement("div");
  el.appendChild(child);
  el.style.visibility = "visible";
  return child;
}

/** Empty and hide the layer if `id` holds it. */
export function releaseOverlay(id: string): void {
  if (owner !== id) return;
  owner = null;
  const el = layer();
  if (!el) return;
  el.replaceChildren();
  el.style.visibility = "hidden";
}

/** Debug: the seam that holds the layer, if any. */
export const overlayOwner = () => owner;
