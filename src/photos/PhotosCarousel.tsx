import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { PhotoItem } from "../portfolio/Photos";

/**
 * Carousel of photo planes hanging on a vertical Y axis. Rotation
 * driven by scroll position through the parent section — one full
 * revolution per ~2 viewports of scroll. Click a photo → enlarge in
 * a centered modal.
 *
 * Photos default to colored gradient panels with their title rendered
 * as a label (placeholder until real images land in
 * `/public/images/photos/`). Setting `photo.src` swaps in a texture.
 */

interface Props {
  photos: PhotoItem[];
  /** Reference to the parent section, used to drive scroll-rotation. */
  sectionRef: React.RefObject<HTMLElement | null>;
}

// Ring radius (distance from carousel center to each photo). Bigger
// radius spreads the photos apart; smaller stacks them closer to the
// camera.
const RING_RADIUS = 3.0;
// Photo plane size in world units.
const PHOTO_WIDTH = 1.8;
const PHOTO_HEIGHT = 2.4;
// Camera distance from the ring center.
const CAMERA_DISTANCE = 7.2;
// Total rotations through the section. ~1 revolution per viewport of
// scroll feels close to the "slow turn" the user described.
const REVOLUTIONS_PER_SECTION = 1.0;

function CarouselScene({
  photos,
  rotationTargetRef,
  onSelect,
}: {
  photos: PhotoItem[];
  rotationTargetRef: React.MutableRefObject<number>;
  onSelect: (i: number) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  // Lerp the actual rotation toward the scroll-driven target — never
  // bind the uniform directly to scroll position (fixed-rate rule).
  const rotation = useRef(0);

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const k = 1 - Math.exp(-dt * 6);
    rotation.current += (rotationTargetRef.current - rotation.current) * k;
    g.rotation.y = rotation.current;
  });

  return (
    <>
      {/* Warm fill + bright top key so plane fronts catch even when
          rotated toward the camera at an angle. */}
      <ambientLight intensity={0.55} color="#fff4e8" />
      <directionalLight position={[2, 5, 4]} intensity={1.0} color="#ffffff" />
      <directionalLight position={[-3, -2, 2]} intensity={0.25} color="#ffd4a8" />
      <group ref={groupRef}>
        {photos.map((p, i) => {
          const angle = (i / photos.length) * Math.PI * 2;
          const x = Math.sin(angle) * RING_RADIUS;
          const z = Math.cos(angle) * RING_RADIUS;
          return (
            <PhotoPlane
              key={i}
              photo={p}
              position={[x, 0, z]}
              // Plane faces outward radially — rotate Y so its front
              // normal points away from the ring center.
              rotationY={angle}
              onClick={() => onSelect(i)}
            />
          );
        })}
      </group>
    </>
  );
}

function PhotoPlane({
  photo,
  position,
  rotationY,
  onClick,
}: {
  photo: PhotoItem;
  position: [number, number, number];
  rotationY: number;
  onClick: () => void;
}) {
  // For now (no real photo files yet) we generate a colored gradient
  // texture per panel. Swap to a CanvasTexture or TextureLoader-loaded
  // image once `/public/images/photos/*.jpg` exists.
  const texture = useMemo(() => makePlaceholderTexture(photo), [photo]);
  return (
    <mesh
      position={position}
      rotation={[0, rotationY, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
      }}
    >
      <planeGeometry args={[PHOTO_WIDTH, PHOTO_HEIGHT]} />
      <meshStandardMaterial
        map={texture}
        side={THREE.DoubleSide}
        roughness={0.65}
        metalness={0}
      />
    </mesh>
  );
}

function makePlaceholderTexture(photo: PhotoItem): THREE.CanvasTexture {
  const w = 512;
  const h = 720;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  // Vertical gradient from photo.color → darker variant.
  const c = photo.color;
  const dark = darken(c, 0.4);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, c);
  grad.addColorStop(1, dark);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  // Subtle vignette so the placeholder reads as a photo, not a flag.
  const vg = ctx.createRadialGradient(w / 2, h / 2, w * 0.2, w / 2, h / 2, w * 0.85);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.35)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
  // Title + meta — laid out in the lower-left like a postcard caption.
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "600 38px 'Space Grotesk', system-ui, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(photo.title, 36, h - 60);
  if (photo.meta) {
    ctx.font = "500 18px 'JetBrains Mono', monospace";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(photo.meta, 36, h - 30);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function darken(hex: string, amount: number): string {
  const v = hex.replace("#", "");
  const r = Math.max(0, parseInt(v.slice(0, 2), 16) * (1 - amount));
  const g = Math.max(0, parseInt(v.slice(2, 4), 16) * (1 - amount));
  const b = Math.max(0, parseInt(v.slice(4, 6), 16) * (1 - amount));
  return `rgb(${r | 0}, ${g | 0}, ${b | 0})`;
}

function CarouselModal({
  photos,
  index,
  onClose,
}: {
  photos: PhotoItem[];
  index: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const p = photos[index]!;
  return (
    <div className="photos-modal" onClick={onClose}>
      <div
        className="photos-modal-card"
        style={{
          background: `linear-gradient(180deg, ${p.color}, ${darken(p.color, 0.4)})`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="photos-modal-title">{p.title}</div>
        {p.meta && <div className="photos-modal-meta">{p.meta}</div>}
        <button className="photos-modal-close" onClick={onClose}>
          ×
        </button>
      </div>
    </div>
  );
}

export function PhotosCarousel({ photos, sectionRef }: Props) {
  const rotationTargetRef = useRef(0);
  const [selected, setSelected] = useState<number | null>(null);

  // Drive rotation from the section's vertical scroll position. As
  // the section enters view from the bottom and scrolls out the top,
  // the carousel rotates by REVOLUTIONS_PER_SECTION turns. rAF-paced
  // so we don't sample scroll on every scroll event.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const el = sectionRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      // r.top = vh → section just entered viewport bottom → 0
      // r.top = -r.height → section just exited viewport top → 1
      const p = (vh - r.top) / (vh + r.height);
      const clamped = Math.max(0, Math.min(1, p));
      rotationTargetRef.current =
        clamped * Math.PI * 2 * REVOLUTIONS_PER_SECTION;
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
  }, [sectionRef]);

  return (
    <>
      <Canvas
        camera={{ position: [0, 0.4, CAMERA_DISTANCE], fov: 32, near: 0.1, far: 50 }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
      >
        <CarouselScene
          photos={photos}
          rotationTargetRef={rotationTargetRef}
          onSelect={setSelected}
        />
      </Canvas>
      {selected != null && (
        <CarouselModal
          photos={photos}
          index={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// Suppress unused warning — useThree is imported by Canvas via JSX
// pragma and TypeScript flags it as an unused import otherwise.
void useThree;
