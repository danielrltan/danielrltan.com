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

/**
 * Consolidated lighting — 5 lights total (down from 14). Each fixture
 * represents a merged cluster of the original setup so the overall
 * sunset-cozy composition stays close while the per-frame light cost
 * drops dramatically.
 *
 *  1. Ambient fill          — global warm wash (was light 0)
 *  2. Sun directional       — shadow caster + global sun (lights 13/14 merged)
 *  3. Lamp cluster point    — left-side lamps merged (lights 1/2/3/4)
 *  4. Desk + pegboard rect  — desk/monitor/PC area merged (lights 6/7/8/9)
 *  5. Bed + corner flood    — bed flood + front corner fill + mushroom (lights 5/10/12)
 */
export function Lighting() {
  return (
    <>
      {/* 1. Ambient — bright, almost-white base with the faintest
              warm tint. Retro-futurism wants a clean canvas (think
              TE / Braun product photography), not a moody amber
              wash. The chromatic warmth comes from the saturated
              practicals below, not from soaking every surface in
              cream. */}
      <ambientLight color="#fff4ec" intensity={0.72} />

      {/* 2. Sun directional — neutral daylight key + shadow caster.
              Pulled toward bright cool-white so the lit faces read
              as crisp product-shot lighting rather than golden
              hour. The practicals carry the warmth.
              Shadow tuning:
              - mapSize bumped 1024 → 2048 for sharper room-scale shadows
              - bias flipped -0.001 → +0.0001 (negative bias pushes
                shadow toward caster and can make it invisible /
                surface-clipped; positive moves it slightly away
                from caster which is the conventional default).
              - normalBias 0.04 — softens shadow-acne at grazing
                angles without needing aggressive position bias. */}
      <directionalLight
        color="#fff8ec"
        intensity={1.0}
        position={[2.823, 3.0, 2.596]}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={0.0001}
        shadow-normalBias={0.04}
        shadow-camera-left={-3.2}
        shadow-camera-right={3.2}
        shadow-camera-top={3.2}
        shadow-camera-bottom={-3.2}
        shadow-camera-near={0.5}
        shadow-camera-far={12}
      />

      {/* 3. Lamp cluster — saturated tungsten. Now that the ambient
              base is clean white, the lamp pool can punch with real
              chroma instead of fighting an already-warm room. Reads
              as a vivid practical light spill on the floor / mirror
              / shelf, not as ambient mood. */}
      <pointLight
        color="#ff8a3c"
        intensity={6}
        distance={6.5}
        decay={2}
        position={[-1.4, 1.4, 1.25]}
      />

      {/* 4. Desk + pegboard + monitor — saturated peach back-wall
              bounce. The colour intensity here is what gives the
              back of the desk its retro-futurism warm-glow rim
              without polluting the whole room. */}
      <rectAreaLight
        color="#ffa055"
        intensity={10}
        width={1.5}
        height={1.0}
        position={[1.58, 1.4, -2.05]}
        rotation={[0, PI, 0]}
      />

      {/* 5. Bed flood + corner fill + mushroom — saturated warm spot
              so the bed/blanket area carries a punchy amber accent
              against the cool base. Saturated colour, clean tone. */}
      <SpotWithTarget
        color="#ff9a5a"
        intensity={5.5}
        distance={9}
        angle={PI * 0.5}
        penumbra={0.45}
        decay={2}
        position={[0.6, 2.6, -0.5]}
        target={[-0.2, 0.5, -1.3]}
      />
    </>
  );
}
