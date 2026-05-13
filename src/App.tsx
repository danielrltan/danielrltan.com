import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Physics } from "@react-three/rapier";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import { Room } from "./Room";
import { Lighting } from "./Lighting";

export default function App() {
  return (
    <Canvas
      shadows
      camera={{ position: [5, 5, 5], fov: 35 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 0.8,
      }}
      onCreated={({ scene, gl }) => {
        scene.background = new THREE.Color("#0a0604");
        gl.outputColorSpace = THREE.SRGBColorSpace;
        // Physically correct lights (decay/intensity match the brief's units).
        (gl as unknown as { useLegacyLights?: boolean }).useLegacyLights = false;
      }}
    >
      <Suspense fallback={null}>
        <Lighting />
        <Physics gravity={[0, -9.81, 0]}>
          <Room />
        </Physics>
        <OrbitControls makeDefault target={[-0.5, 1.0, 0.2]} />
        <EffectComposer>
          <Bloom
            mipmapBlur
            luminanceThreshold={1.0}
            intensity={0.7}
            radius={0.85}
          />
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}
