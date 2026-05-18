import { useMemo } from "react";
import * as THREE from "three";
import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";

// Required for RectAreaLight to actually shade — one-time module init.
RectAreaLightUniformsLib.init();

interface SpotProps {
  color: string;
  intensity: number;
  distance: number;
  angle: number;
  penumbra: number;
  decay: number;
  position: [number, number, number];
  target: [number, number, number];
}

/**
 * SpotLight + an Object3D target placed in the scene. Setting target via a
 * subnode (rather than mutating the default target) ensures the spotlight
 * actually orients itself correctly.
 */
function SpotWithTarget({
  color,
  intensity,
  distance,
  angle,
  penumbra,
  decay,
  position,
  target,
}: SpotProps) {
  const [tx, ty, tz] = target;
  const targetObj = useMemo(() => {
    const t = new THREE.Object3D();
    t.position.set(tx, ty, tz);
    return t;
  }, [tx, ty, tz]);

  return (
    <>
      <primitive object={targetObj} />
      <spotLight
        color={color}
        intensity={intensity}
        distance={distance}
        angle={angle}
        penumbra={penumbra}
        decay={decay}
        position={position}
        target={targetObj}
      />
    </>
  );
}

const PI = Math.PI;

export function Lighting() {
  return (
    <>
      {/* 0. Ambient fill — lifts the corners + shadowed walls out of
              pure black. CLAUDE.md spec called for one but the scene
              had been running without it, which is why outside-the-pool
              regions read as crushed maroon. Kept warm so it doesn't
              cool down the cozy sunset palette. */}
      <ambientLight color="#ffd4b0" intensity={0.28} />

      {/* 1. Arc floor lamp — main key light */}
      <pointLight
        color="#ffb077"
        intensity={3}
        distance={5}
        decay={2}
        position={[-1.318, 1.924, 1.258]}
      />

      {/* 2. Mirror hue light — warm glow behind round mirror */}
      <pointLight
        color="#ff9060"
        intensity={.75}
        distance={7}
        decay={2}
        position={[-2.065, 0.486, 0.522]}
      />

      {/* 3. Orange globe lamp — on dresser */}
      <pointLight
        color="#ff9955"
        intensity={2}
        distance={4}
        decay={2}
        position={[-1.349, 1.0, 2.088]}
      />

      {/* 4. Sunset lamp — upper shelf */}
      <pointLight
        color="#ffaa66"
        intensity={1}
        distance={4}
        decay={2}
        position={[-1.32, 2.209, 2.114]}
      />

      {/* 5. Mushroom lamp — nightstand beside bed */}
      <pointLight
        color="#ffd4a0"
        intensity={1.2}
        distance={3}
        decay={2}
        position={[0.693, 1.403, -1.594]}
      />

      {/* 6. PC RGB glow — desk area */}
      <pointLight
        color="#fff0dd"
        intensity={.5}
        distance={2.5}
        decay={2}
        position={[1.973, 0.9, -1.604]}
      />

      {/* 7. Monitor bar light */}
      <rectAreaLight
        color="#ffd4aa"
        intensity={3.0}
        width={0.4}
        height={0.05}
        position={[1.458, 1.235, -1.974]}
        rotation={[0, PI, 0]}
      />

      {/* 8. Pegboard backlight */}
      <rectAreaLight
        color="#ffdda0"
        intensity={5.0}
        width={1.1}
        height={0.7}
        position={[1.71, 1.764, -2.101]}
        rotation={[0, PI, 0]}
      />

      {/* 9. Monitor backglow — merged 9a + 9b (intensity summed,
              positioned at the centroid). Each extra light is a full
              geometry pass in the renderer. */}
      <rectAreaLight
        color="#ffbb88"
        intensity={3.5}
        width={0.3}
        height={0.3}
        position={[1.460, 1.095, -2.074]}
        rotation={[0, PI, 0]}
      />

      {/* 10. Bed sunset flood — warm wash over bed from above-front */}
      <SpotWithTarget
        color="#ffaa77"
        intensity={4}
        distance={6}
        angle={PI * 0.48}
        penumbra={0.3}
        decay={2}
        position={[0.323, 2.4, -1.304]}
        target={[-0.993, 0.55, -1.304]}
      />

      {/* 12. Front corner fill */}
      <SpotWithTarget
        color="#ffaa80"
        intensity={3.0}
        distance={6}
        angle={PI * 0.52}
        penumbra={0.4}
        decay={2}
        position={[1.423, 2.5, 0.886]}
        target={[1.423, 0, 0.886]}
      />

      {/* 13. Ambient directional — soft wash from front-right, bumped
              from 0.08 to lift the front face of the room where the
              point lights don't reach. */}
      <directionalLight
        color="#ffcc99"
        intensity={0.18}
        position={[2.823, 3.0, 2.596]}
      />

      {/* 14. Window sunset — faint sun angle, bumped slightly so the
              left wall and floor pick up a hair more rim. */}
      <directionalLight
        color="#ff9966"
        intensity={0.24}
        position={[-0.65, 2.209, 6.092]}
      />
    </>
  );
}
