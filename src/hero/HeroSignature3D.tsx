import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  type SignatureData,
  buildSignatureTubes,
  eventsToStrokes,
} from "./signatureGeometry";

/**
 * 3D extruded signature for the hero — picks up after HeroSignature2D
 * finishes drawing + assets finish loading. Each pen-down → pen-up
 * stroke is a TubeGeometry along a CatmullRomCurve3. Materials are
 * metallic-orange so the cursor-tracking point light catches the
 * curve of each tube and sweeps highlights across them.
 */

interface Props {
  data: SignatureData | null;
  /** Opacity multiplier for crossfade-in from the 2D version. */
  opacity: number;
}

// World-space width of the signature rig. Camera is at z=6 with
// fov=28° (perspective half-angle 14°), giving a viewport half-width
// at z=0 of tan(14°) * 6 ≈ 1.5 world units. Setting RIG_WIDTH to 2.5
// frames the signature at ~83% of viewport width with breathing room
// on either side.
const RIG_WIDTH = 2.5;
const TUBE_RADIUS = 0.022;
// Warm walnut base picks up orange highlights from the cursor-tracking
// point light. Pure-dark base read as a flat black silhouette and the
// only color visible was the highlight smear; the warmer base lets
// the unlit portions of the signature still feel "alive."
const SIGNATURE_BASE_COLOR = "#3a2418";
const SIGNATURE_METALNESS = 0.55;
const SIGNATURE_ROUGHNESS = 0.40;

function SignatureMesh({ data }: { data: SignatureData }) {
  const groupRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const { size, camera } = useThree();
  const targetTilt = useRef(new THREE.Vector2(0, 0));
  const currentTilt = useRef(new THREE.Vector2(0, 0));
  const cursorWorld = useRef(new THREE.Vector3(0, 0, 4));

  const geometries = useMemo(() => {
    const strokes = eventsToStrokes(data.events);
    return buildSignatureTubes(strokes, data.bounds, {
      width: RIG_WIDTH,
      tubeRadius: TUBE_RADIUS,
    });
  }, [data]);

  // Cleanup geometry on unmount (and when geometries change).
  useEffect(() => {
    return () => {
      for (const g of geometries) g.dispose();
    };
  }, [geometries]);

  // Track cursor and project to a plane at z=0 (signature's plane).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      // Cursor in normalized device coords (-1..1).
      const ndcX = (e.clientX / window.innerWidth) * 2 - 1;
      const ndcY = -(e.clientY / window.innerHeight) * 2 + 1;
      targetTilt.current.set(ndcX, ndcY);
      // Unproject into world at the signature's z=0 plane.
      const v = new THREE.Vector3(ndcX, ndcY, 0.5);
      v.unproject(camera);
      const dir = v.sub(camera.position).normalize();
      const dist = -camera.position.z / dir.z;
      cursorWorld.current.copy(camera.position).add(dir.multiplyScalar(dist));
      // Push the point light slightly in front of the plane so it
      // grazes the tubes rather than sitting embedded in them.
      cursorWorld.current.z = 2;
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [camera, size.width, size.height]);

  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    // Cursor parallax: tilt the rig toward the cursor. Max ±5° around
    // X/Y. Lerped so motion is smooth even on fast mouse flicks.
    const lerpK = 1 - Math.exp(-dt * 4);
    currentTilt.current.x +=
      (targetTilt.current.x - currentTilt.current.x) * lerpK;
    currentTilt.current.y +=
      (targetTilt.current.y - currentTilt.current.y) * lerpK;
    g.rotation.y = currentTilt.current.x * 0.09;
    g.rotation.x = -currentTilt.current.y * 0.06;

    // Cursor light follows the projected cursor world position.
    if (lightRef.current) {
      lightRef.current.position.lerp(cursorWorld.current, lerpK);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Ambient anchor so the unlit side of each tube isn't pitch
          black — small, just enough to read silhouette. */}
      <ambientLight intensity={0.18} color="#fff4e8" />
      {/* Cursor-tracked highlight light. Warm orange to match brand. */}
      <pointLight
        ref={lightRef}
        position={[0, 0, 2]}
        intensity={42}
        distance={9}
        decay={1.4}
        color="#ffae6a"
      />
      {/* Soft fill from above so the rig isn't entirely dependent on
          cursor proximity for visibility. */}
      <directionalLight position={[0.5, 1.5, 2]} intensity={0.6} color="#ffffff" />
      {geometries.map((geom, i) => (
        <mesh key={i} geometry={geom} castShadow={false} receiveShadow={false}>
          <meshStandardMaterial
            color={SIGNATURE_BASE_COLOR}
            metalness={SIGNATURE_METALNESS}
            roughness={SIGNATURE_ROUGHNESS}
            envMapIntensity={1.0}
          />
        </mesh>
      ))}
    </group>
  );
}

export function HeroSignature3D({ data, opacity }: Props) {
  // Track whether the canvas has mounted at least once so we can keep
  // the wrapper at display:none until needed (avoids running an idle
  // WebGL context behind the 2D signature during loading).
  const [shouldRender, setShouldRender] = useState(false);
  useEffect(() => {
    if (opacity > 0) setShouldRender(true);
  }, [opacity]);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 4,
        pointerEvents: "none",
        opacity,
        transition: "opacity 520ms ease",
      }}
    >
      {shouldRender && data && (
        <Canvas
          camera={{ position: [0, 0, 6], fov: 28, near: 0.1, far: 50 }}
          // DPR capped at the actual device value (up to 2.5). 1.5 was
          // leaving the signature soft/aliased on high-DPI displays
          // where the signature is the page's hero element and any
          // jaggies are immediately visible. 2.5 covers most Retina-
          // class screens; native antialias + tube-geometry segment
          // bumps do the rest.
          dpr={[1, Math.min(window.devicePixelRatio || 1, 2.5)]}
          gl={{
            antialias: true,
            // MSAA samples — bumps multi-sample anti-aliasing on the
            // default WebGL framebuffer. 4 is the safe ceiling across
            // mobile + integrated GPUs; pairs with the high tube-
            // segment count to clean up edges along the stroke
            // silhouettes.
            samples: 4,
            alpha: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.0,
          }}
        >
          <SignatureMesh data={data} />
        </Canvas>
      )}
    </div>
  );
}
