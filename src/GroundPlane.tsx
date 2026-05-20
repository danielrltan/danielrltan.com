import { useMemo } from "react";
import * as THREE from "three";

/**
 * Ground plane the room sits on. Baked rice-dot grid with a radial
 * alpha falloff: dots are full-opacity right under the room and fade
 * smoothly to transparent at the plane edges — like a soft spotlight
 * focusing attention on the centerpiece.
 *
 * Sits at y=0, room floor level. The drei ContactShadows in App.tsx
 * lives slightly above (y=+0.005) so its soft dark blob renders ON
 * the dot grid rather than being occluded by the plane.
 */

const PLANE_SIZE = 60;
// One big texture covering the full plane (NO tiling) so the radial
// fade has a single, plane-wide center.
const TEX_SIZE = 2048;
const DOT_SPACING_PX = 26;
const DOT_RADIUS_PX = 2.2;
// Inner radius where alpha = 1, outer radius where alpha = 0.
// Expressed as a fraction of TEX_SIZE/2 (i.e., max distance to edge).
const FADE_INNER = 0.18;
const FADE_OUTER = 0.78;

function makeDotTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext("2d")!;

  // Base — wrapper-bg cool grey.
  ctx.fillStyle = "#ecedef";
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  const cx = TEX_SIZE / 2;
  const cy = TEX_SIZE / 2;
  const halfDiag = TEX_SIZE / 2; // distance from center to edge midpoint
  ctx.fillStyle = "#15171a";

  const cols = Math.ceil(TEX_SIZE / DOT_SPACING_PX);
  for (let r = 0; r <= cols; r++) {
    for (let c = 0; c <= cols; c++) {
      const x = c * DOT_SPACING_PX;
      const y = r * DOT_SPACING_PX;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const t = (d / halfDiag - FADE_INNER) / (FADE_OUTER - FADE_INNER);
      const alpha = Math.max(0, Math.min(1, 1 - t));
      if (alpha <= 0.01) continue;
      // Ease-out so the falloff feels natural rather than linear.
      const a = Math.pow(alpha, 1.4) * 0.7;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(x, y, DOT_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // No tiling — one texture spans the whole plane so the radial
  // gradient has a single center.
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

export function GroundPlane() {
  const texture = useMemo(() => makeDotTexture(), []);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}
