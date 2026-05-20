import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { TextureLoader } from "three";
import "./sections.css";
import "./gallery.css";

/**
 * 3D photo carousel — vertical cylinder of photos that rotates as
 * the user scrolls. Two horizontal rings stacked at different
 * heights, ~8 photos per ring. The cylinder spins around its Y axis
 * driven by the section's scroll progress (computed locally via a
 * ref + scroll listener so it doesn't fight the global useScroll
 * hook's rAF cadence).
 *
 * Placeholder photos for now — drop real images into
 * /public/gallery/01.jpg … /public/gallery/16.jpg to populate.
 */

const RING_RADIUS = 3.4;
const TOP_RING_Y = 0.95;
const BOTTOM_RING_Y = -0.95;
const PHOTOS_PER_RING = 8;
const PHOTO_W = 1.7;
const PHOTO_H = 1.15;

// Placeholder URLs — colored gradients via SVG data-URI. Replace each
// with /gallery/01.jpg etc. when you drop in real photos.
const HUES = [
  "#e87040", "#f5d9b6", "#b96336", "#ffe7cf",
  "#7a4a30", "#ffb077", "#3a2418", "#e0a87a",
  "#e87040", "#f5d9b6", "#b96336", "#ffe7cf",
  "#7a4a30", "#ffb077", "#3a2418", "#e0a87a",
];

function makePlaceholder(idx: number, hue: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 340 230'>
    <defs>
      <linearGradient id='g${idx}' x1='0' y1='0' x2='1' y2='1'>
        <stop offset='0' stop-color='${hue}'/>
        <stop offset='1' stop-color='#1a1714'/>
      </linearGradient>
    </defs>
    <rect width='340' height='230' fill='url(%23g${idx})'/>
    <text x='20' y='200' font-family='monospace' font-size='14' fill='%23f8f6f3' opacity='0.7'>${String(idx + 1).padStart(2, "0")} / 16</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${svg.replace(/#/g, "%23").replace(/\n/g, "")}`;
}

const PHOTO_URLS = HUES.map((hue, i) => makePlaceholder(i, hue));

function Photo({
  url,
  angle,
  y,
}: {
  url: string;
  angle: number;
  y: number;
}) {
  const texture = useLoader(TextureLoader, url);
  // Position the photo on the cylinder surface, facing outward.
  const x = Math.sin(angle) * RING_RADIUS;
  const z = Math.cos(angle) * RING_RADIUS;
  return (
    <mesh position={[x, y, z]} rotation={[0, angle, 0]}>
      <planeGeometry args={[PHOTO_W, PHOTO_H]} />
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

function Carousel({ sectionRef }: { sectionRef: React.RefObject<HTMLElement | null> }) {
  const groupRef = useRef<THREE.Group>(null);
  // Damped rotation state — read scroll position of section every
  // frame and lerp the group rotation toward the target. Fixed-rate
  // damping means uneven scroll input becomes smooth controlled spin.
  const targetY = useRef(0);

  useFrame((_, dt) => {
    const el = sectionRef.current;
    const g = groupRef.current;
    if (!el || !g) return;

    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    // 0 when section's top is at viewport bottom (just entering);
    // 1 when section's bottom is at viewport top (just leaving).
    const total = rect.height + vh;
    const passed = vh - rect.top;
    const t = Math.max(0, Math.min(1, passed / total));

    // 1.25 full rotations across the section.
    targetY.current = t * Math.PI * 2.5;

    const rate = 1 - Math.exp(-dt * 3.2);
    g.rotation.y += (targetY.current - g.rotation.y) * rate;
  });

  const photos = useMemo(() => {
    const out: { url: string; angle: number; y: number }[] = [];
    for (let i = 0; i < PHOTOS_PER_RING; i++) {
      const angle = (i / PHOTOS_PER_RING) * Math.PI * 2;
      out.push({ url: PHOTO_URLS[i]!, angle, y: TOP_RING_Y });
      out.push({
        url: PHOTO_URLS[i + PHOTOS_PER_RING]!,
        // Offset the bottom ring by half a slot so the photos stagger
        // visually rather than stacking in vertical pairs.
        angle: angle + Math.PI / PHOTOS_PER_RING,
        y: BOTTOM_RING_Y,
      });
    }
    return out;
  }, []);

  return (
    <group ref={groupRef}>
      {photos.map((p, i) => (
        <Photo key={i} url={p.url} angle={p.angle} y={p.y} />
      ))}
    </group>
  );
}

export function Gallery() {
  const sectionRef = useRef<HTMLElement>(null);
  return (
    <section className="portfolio-section gallery-section" ref={sectionRef}>
      <div className="portfolio-col gallery-col">
        <span className="section-marker">06</span>
        <span className="section-index">06 / 08 &middot; Gallery</span>
        <h2>Through the lens.</h2>
        <div className="section-card gallery-card">
          <div className="gallery-canvas-wrap">
            <Canvas
              orthographic={false}
              camera={{ position: [0, 0, 6.5], fov: 28, near: 0.1, far: 50 }}
              gl={{ antialias: true, alpha: true }}
              style={{ width: "100%", height: "100%", touchAction: "none" }}
            >
              <ambientLight intensity={0.8} />
              <directionalLight position={[3, 4, 5]} intensity={0.6} />
              <Suspense fallback={null}>
                <Carousel sectionRef={sectionRef} />
              </Suspense>
            </Canvas>
            <div className="gallery-overlay-label">
              SCROLL <span className="gallery-overlay-arrow">&#8595;</span>
            </div>
          </div>
          <div className="section-rule" />
          <p>
            A rotating reel of moments &mdash; travel, builds, days at
            the desk. Scroll the section and the cylinder turns.
          </p>
        </div>
      </div>
    </section>
  );
}
