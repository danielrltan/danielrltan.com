import { useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { HobbyObject } from "../portfolio/Other";

/**
 * 3D desk scene for the Other section. A simple wooden plane with
 * primitive-geometry objects scattered on top — each clickable, each
 * with a small HTML tooltip anchored above on click.
 *
 * Camera is positioned to look down at the desk surface from a 3/4
 * angle, mimicking the curiosity-cabinet "object on a table" feel
 * established by the other sections (Macintosh, Keypad).
 */

interface Props {
  hobbies: HobbyObject[];
}

const DESK_WIDTH = 4.5;
const DESK_DEPTH = 2.6;
const DESK_THICKNESS = 0.1;
// Desk top sits at y=0; objects sit on top via y in their position.
const DESK_COLOR = "#7a4f30";

function DeskScene({
  hobbies,
  setSelected,
  selectedId,
}: {
  hobbies: HobbyObject[];
  setSelected: (h: HobbyObject | null) => void;
  selectedId: string | null;
}) {
  return (
    <>
      <ambientLight intensity={0.45} color="#fff4e8" />
      <directionalLight position={[3, 6, 2]} intensity={1.1} color="#fff" castShadow />
      <directionalLight position={[-2, 3, -2]} intensity={0.4} color="#ffd4a8" />
      {/* Desk slab — simple box with a warm wood color. */}
      <mesh position={[0, -DESK_THICKNESS / 2, 0]} receiveShadow>
        <boxGeometry args={[DESK_WIDTH, DESK_THICKNESS, DESK_DEPTH]} />
        <meshStandardMaterial color={DESK_COLOR} roughness={0.75} metalness={0.05} />
      </mesh>
      {/* Soft "edge ring" so the slab has a subtle highlight rim
          that catches the key light. Optional, just makes it less
          flat. */}
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.6, 2.2, 32]} />
        <meshBasicMaterial color="#5a3a1f" transparent opacity={0.18} />
      </mesh>
      {/* Hobby objects. */}
      {hobbies.map((h) => (
        <HobbyMesh
          key={h.id}
          hobby={h}
          isSelected={selectedId === h.id}
          onSelect={() => setSelected(h)}
          onHover={(over) => {
            document.body.style.cursor = over ? "pointer" : "";
          }}
        />
      ))}
    </>
  );
}

function HobbyMesh({
  hobby,
  isSelected,
  onSelect,
  onHover,
}: {
  hobby: HobbyObject;
  isSelected: boolean;
  onSelect: () => void;
  onHover: (over: boolean) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const size = hobby.size ?? 0.35;
  // Gentle hover float so the desk objects feel alive.
  const hover = useRef(0);
  useFrame((_, dt) => {
    const m = meshRef.current;
    if (!m) return;
    const target = isSelected ? 1 : 0;
    hover.current += (target - hover.current) * (1 - Math.exp(-dt * 6));
    m.position.y = hobby.position[1] + hover.current * 0.08;
  });

  const geom = (() => {
    switch (hobby.shape) {
      case "cylinder":
        return <cylinderGeometry args={[size * 0.55, size * 0.6, size, 16]} />;
      case "sphere":
        return <sphereGeometry args={[size * 0.55, 24, 16]} />;
      case "cone":
        return <coneGeometry args={[size * 0.6, size * 1.2, 16]} />;
      case "box":
      default:
        return <boxGeometry args={[size, size * 0.7, size * 0.8]} />;
    }
  })();

  return (
    <mesh
      ref={meshRef}
      position={hobby.position}
      castShadow
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover(true);
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onHover(false);
      }}
    >
      {geom}
      <meshStandardMaterial
        color={hobby.color}
        roughness={0.55}
        metalness={0.18}
        emissive={isSelected ? hobby.color : "#000000"}
        emissiveIntensity={isSelected ? 0.25 : 0}
      />
    </mesh>
  );
}

export function OtherDeskScene({ hobbies }: Props) {
  const [selected, setSelected] = useState<HobbyObject | null>(null);
  return (
    <>
      <Canvas
        camera={{ position: [0, 1.7, 3.5], fov: 38, near: 0.1, far: 30 }}
        dpr={[1, 1.5]}
        shadows
        onPointerMissed={() => setSelected(null)}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.0,
        }}
      >
        <DeskScene
          hobbies={hobbies}
          setSelected={setSelected}
          selectedId={selected?.id ?? null}
        />
      </Canvas>
      {selected && (
        <div
          className="other-tooltip"
          onClick={() => setSelected(null)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="other-tooltip-label">{selected.label}</div>
          <div className="other-tooltip-blurb">{selected.blurb}</div>
          <button
            className="other-tooltip-close"
            onClick={(e) => {
              e.stopPropagation();
              setSelected(null);
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
