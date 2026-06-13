import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

/**
 * Static baked bedroom diorama.
 *
 * The room is now PURELY VIEW-ONLY: the GLB (`room-optimized.glb`) ships
 * with all lighting + shadow baked into its texture atlases, so every
 * mesh renders UNLIT (MeshBasicMaterial). There are no scene lights, no
 * physics, no interactivity - the scroll-driven camera fly-through
 * (ScrollCamera) is the only thing that animates the view.
 *
 * Material conversion (per mesh material):
 *   - baked atlas materials (have a .map)  -> MeshBasicMaterial(map), sRGB
 *   - emissive materials (glow strips, sunbeam, light bar) -> the emissive
 *     colour as the basic colour (so the glow still reads with no lights)
 *   - flat-colour materials -> MeshBasicMaterial(baseColor)
 *   - glass / mirror pieces -> plain transparent (opacity 0.2,
 *     depthWrite:false), NO env map (cosmetic reflection skipped)
 */

const ROOM_URL = "/room-optimized.glb";

// Glass / mirror pieces: rendered as plain transparent (no env map).
// Keyed by BOTH material name and node name so a renamed mesh still hits.
const GLASS_MATERIALS = new Set(["mat_glass_simple", "mat_blk_glass"]);
const GLASS_NODES = new Set([
  "pc_case_glass",
  "th_mirror_round",
  "th_mirror_standing",
  "th_record_player_glass",
]);

// Don't re-flag a shared atlas texture's colorspace twice (harmless, but
// avoids a redundant GPU re-upload).
const srgbFlagged = new WeakSet<THREE.Texture>();
function asSRGB(tex: THREE.Texture) {
  if (srgbFlagged.has(tex)) return;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  srgbFlagged.add(tex);
}

/**
 * Convert one GLTF (MeshStandard) material to an UNLIT MeshBasicMaterial
 * that preserves the baked look without needing scene lights.
 */
function toBakedMaterial(
  src: THREE.Material,
  meshName: string,
): THREE.MeshBasicMaterial {
  const std = src as THREE.MeshStandardMaterial;
  const basic = new THREE.MeshBasicMaterial();
  basic.name = std.name;
  basic.side = std.side ?? THREE.FrontSide;

  // Glass / mirror: plain transparent, no map, no reflection.
  if (GLASS_MATERIALS.has(std.name) || GLASS_NODES.has(meshName)) {
    if (std.color) basic.color.copy(std.color);
    basic.transparent = true;
    basic.opacity = 0.2;
    basic.depthWrite = false;
    basic.side = THREE.DoubleSide;
    return basic;
  }

  if (std.map) {
    // Baked-lighting atlas surface.
    basic.map = std.map;
    asSRGB(std.map);
    basic.color.set(0xffffff);
  } else if (
    std.emissive &&
    std.emissive.r + std.emissive.g + std.emissive.b > 0.02
  ) {
    // Emissive glow (light strips, sunbeam): render the glow colour
    // directly so it reads bright with no lights. emissiveIntensity
    // carries KHR_materials_emissive_strength.
    basic.color
      .copy(std.emissive)
      .multiplyScalar(Math.max(1, std.emissiveIntensity || 1));
  } else {
    // Flat-colour material: use its base colour.
    if (std.color) basic.color.copy(std.color);
  }

  // Carry transparency / cutout / opacity so blended pieces (sunbeam)
  // and any alpha-tested foliage still read correctly.
  basic.transparent = std.transparent;
  basic.opacity = std.opacity ?? 1;
  basic.alphaTest = std.alphaTest ?? 0;
  basic.depthWrite = std.depthWrite ?? true;
  basic.toneMapped = false;
  return basic;
}

export function Room() {
  const { scene } = useGLTF(ROOM_URL);

  const visualScene = useMemo(() => {
    const cloned = scene.clone(true);
    cloned.updateMatrixWorld(true);
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      // Unlit baked meshes don't participate in shadows.
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // No pointer interaction in a view-only scene.
      mesh.raycast = () => {};
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const next = mats.map((m) => toBakedMaterial(m, mesh.name));
      mesh.material = next.length === 1 ? next[0]! : next;
    });
    return cloned;
  }, [scene]);

  return <primitive object={visualScene} />;
}

useGLTF.preload(ROOM_URL);
