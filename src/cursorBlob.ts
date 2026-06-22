import * as THREE from "three";

/**
 * SINGLE SOURCE OF TRUTH for the cursor-blob (rice pool) colour + the backdrop
 * it composites over — shared by BOTH cursor blobs:
 *   - keypad:    src/keypad/RiceBlob.tsx
 *   - jump menu: src/MercuryAura.tsx
 *
 * The two are the SAME effect in different scenes. For them to render the
 * IDENTICAL on-screen colour they must (1) use the same rice colour, (2)
 * composite over the same backdrop, and (3) blend with the same math. Defining
 * all three ONCE here makes the match guaranteed by construction: there is
 * nothing to hand-sync between the two files, so they can't drift.
 *
 * The colours are READ FROM THE DESIGN-SYSTEM CSS TOKENS at runtime (canvas /
 * WebGL shaders can't read CSS custom properties directly), so the blobs always
 * equal what the rest of the site uses AND each other:
 *   rice = --accent   (#ff4f00 International Orange)
 *   bg   = --bg-page  (#eef0f3 cool page tone — the keypad viewport colour)
 * Change the token in src/index.css :root and both blobs (and the keypad's CSS
 * backdrop, which already uses var(--bg-page)) move together. Fallbacks match
 * the token defaults for SSR / if the var is ever missing or non-hex.
 */

function readTokenColor(name: string, fallback: string): THREE.Color {
  let hex = fallback;
  if (typeof document !== "undefined") {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    // Only accept a plain hex — THREE.Color can't parse color-mix()/rgb() vars.
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) hex = v;
  }
  return new THREE.Color(hex);
}

/** Rice / pool colour (= --accent). Call at component init to seed a uniform. */
export function blobRiceColor(): THREE.Color {
  return readTokenColor("--accent", "#ff4f00");
}

/** Backdrop the rice composites over (= --bg-page). */
export function blobBgColor(): THREE.Color {
  return readTokenColor("--bg-page", "#eef0f3");
}

/**
 * Shared GLSL: composite the rice OVER the backdrop in LINEAR space, OPAQUE.
 * THREE.ColorManagement converts the colour uniforms to linear on upload, so
 * this mix runs in LINEAR space in both scenes; each then applies a single
 * linear→sRGB encode (keypad via RipplePost's lin2srgb, jump menu via
 * `#include <colorspace_fragment>`) with NO tone-mapping — so the final pixel is
 * identical given identical inputs. Insert this string into a fragment shader,
 * then write `gl_FragColor = vec4(blobComposite(uBg, rice, a), 1.0);`.
 *
 * DO NOT add ACES / tone-mapping to only one path, or the two will diverge.
 */
export const BLOB_COMPOSITE_GLSL = /* glsl */ `
vec3 blobComposite(vec3 bg, vec3 rice, float a) {
  return mix(bg, rice, clamp(a, 0.0, 1.0));
}
`;
