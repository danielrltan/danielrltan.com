import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTheme } from "./theme";

export type IconShape =
  | "book"
  | "folder"
  | "octahedron"
  | "torus"
  | "envelope"
  | "monitor"
  | "icosahedron"
  | "cube";

interface Props {
  id: string;
  label: string;
  shape: IconShape;
  /** Absolute position in the parent container. */
  x: number;
  y: number;
  selected: boolean;
  /** Single-tap activation (open the window). */
  onActivate: () => void;
  /** Drag callback — fires while the icon is being moved. */
  onMove: (id: string, x: number, y: number) => void;
  /**
   * Drop callback — fires once on pointer up after a drag. Parent
   * decides whether to snap to the nearest open slot.
   */
  onDrop?: (id: string, x: number, y: number) => void;
  /** Selection callback — fires on pointer down before activate / drag is decided. */
  onSelect: (id: string) => void;
  /** Optional callback when the icon becomes the topmost desktop element. */
  onFocus?: (id: string) => void;
}

const DRAG_THRESHOLD_PX = 4;

/**
 * One desktop icon — small R3F canvas (72×72) rendering a single mesh
 * that idle-rotates and speeds up on hover. The wrapper is absolutely
 * positioned and supports pointer-drag to reposition. A pointer-up that
 * never crossed the drag threshold counts as a click and fires
 * `onActivate` (opens the window). Each icon owns its own GL context.
 */
export function DesktopIcon({
  id,
  label,
  shape,
  x,
  y,
  selected,
  onActivate,
  onMove,
  onDrop,
  onSelect,
  onFocus,
}: Props) {
  const [hover, setHover] = useState(false);
  const [pressing, setPressing] = useState(false);
  const dragRef = useRef<{
    pid: number;
    offX: number;
    offY: number;
    moved: boolean;
    lastX: number;
    lastY: number;
  } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    onSelect(id);
    onFocus?.(id);
    dragRef.current = {
      pid: e.pointerId,
      offX: e.clientX - x,
      offY: e.clientY - y,
      moved: false,
      lastX: x,
      lastY: y,
    };
    setPressing(true);
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pid !== e.pointerId) return;
    const nx = e.clientX - d.offX;
    const ny = e.clientY - d.offY;
    if (!d.moved) {
      const dx = Math.abs(nx - x);
      const dy = Math.abs(ny - y);
      if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) return;
      d.moved = true;
    }
    d.lastX = nx;
    d.lastY = ny;
    onMove(id, nx, ny);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || d.pid !== e.pointerId) return;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* already released */
    }
    const { moved, lastX, lastY } = d;
    dragRef.current = null;
    setPressing(false);
    // Click vs drag distinguished by `moved`. The DRAG_THRESHOLD_PX
    // guard above means tiny twitches stay classified as clicks.
    if (moved) {
      onDrop?.(id, lastX, lastY);
    } else {
      onActivate();
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label}
      data-icon-id={id}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate();
        }
      }}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: 92,
        padding: "8px 6px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        background: selected
          ? "color-mix(in srgb, var(--accent) 18%, transparent)"
          : "transparent",
        border: "1px solid",
        borderColor: selected
          ? "color-mix(in srgb, var(--accent) 40%, transparent)"
          : "transparent",
        borderRadius: 10,
        cursor: pressing ? "grabbing" : "pointer",
        touchAction: "none",
        color: "var(--text-dk)",
        transform: pressing ? "scale(0.97)" : "scale(1)",
        // Drag follows cursor instantly (no left/top tween); on
        // release, the parent may re-position the icon (snap), and
        // we want THAT change to glide smoothly.
        transition: pressing
          ? "transform 0.1s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease"
          : "left 0.22s ease, top 0.22s ease, transform 0.1s ease, background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
        boxShadow: pressing ? "0 6px 18px rgba(0,0,0,0.18)" : "none",
        userSelect: "none",
      }}
    >
      <div style={{ width: 72, height: 72, pointerEvents: "none" }}>
        <Canvas
          // dpr=1 is plenty at 72×72 — bumping to 1.5 doubled pixel work
          // for no perceivable gain on a tiny icon. antialias off saves
          // another large chunk of fillrate per icon, and the icons each
          // own a WebGL context (6 contexts on the OS) so per-icon cost
          // multiplies.
          dpr={1}
          camera={{ position: [0, 0, 3.2], fov: 35 }}
          gl={{ antialias: false, alpha: true, powerPreference: "low-power" }}
          style={{ width: "100%", height: "100%" }}
        >
          <ambientLight intensity={0.55} />
          <directionalLight position={[2, 3, 2]} intensity={1.2} />
          <directionalLight position={[-2, -1, -1]} intensity={0.35} />
          <SpinningMesh shape={shape} hover={hover} />
        </Canvas>
      </div>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
          letterSpacing: 0.5,
          color: "var(--text-dk)",
          textShadow:
            "0 1px 0 rgba(255,255,255,0.4), 0 0 6px rgba(0,0,0,0.04)",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {label}
      </span>
    </div>
  );
}

function SpinningMesh({ shape, hover }: { shape: IconShape; hover: boolean }) {
  const ref = useRef<THREE.Mesh | THREE.Group | null>(null);
  const { colors } = useTheme();

  useFrame((_state, dt) => {
    const o = ref.current;
    if (!o) return;
    const speedY = hover ? 1.6 : 0.55;
    const speedX = hover ? 0.6 : 0.18;
    o.rotation.y += speedY * dt;
    o.rotation.x += speedX * dt;
  });

  const matAccent = (
    <meshStandardMaterial
      color={colors.accent}
      roughness={0.45}
      metalness={0.15}
    />
  );
  const matAccent2 = (
    <meshStandardMaterial
      color={colors.accent2}
      roughness={0.5}
      metalness={0.1}
    />
  );

  switch (shape) {
    case "book":
      return (
        <group ref={ref as React.RefObject<THREE.Group>}>
          <mesh>
            <boxGeometry args={[1.05, 1.35, 0.22]} />
            {matAccent}
          </mesh>
          <mesh position={[-0.515, 0, 0]}>
            <boxGeometry args={[0.05, 1.35, 0.24]} />
            {matAccent2}
          </mesh>
        </group>
      );
    case "folder":
      return (
        <group ref={ref as React.RefObject<THREE.Group>}>
          <mesh>
            <boxGeometry args={[1.4, 0.95, 0.18]} />
            {matAccent}
          </mesh>
          <mesh position={[-0.35, 0.55, 0]}>
            <boxGeometry args={[0.55, 0.22, 0.2]} />
            {matAccent2}
          </mesh>
        </group>
      );
    case "octahedron":
      return (
        <mesh ref={ref as React.RefObject<THREE.Mesh>}>
          <octahedronGeometry args={[0.92, 0]} />
          {matAccent}
        </mesh>
      );
    case "torus":
      return (
        <mesh ref={ref as React.RefObject<THREE.Mesh>}>
          <torusGeometry args={[0.7, 0.28, 12, 28]} />
          {matAccent}
        </mesh>
      );
    case "envelope":
      return (
        <group ref={ref as React.RefObject<THREE.Group>}>
          <mesh>
            <boxGeometry args={[1.4, 0.95, 0.15]} />
            {matAccent}
          </mesh>
          <mesh position={[0, 0.05, 0.08]} rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[0.7, 0.7, 0.04]} />
            {matAccent2}
          </mesh>
        </group>
      );
    case "monitor":
      return (
        <group ref={ref as React.RefObject<THREE.Group>}>
          <mesh>
            <boxGeometry args={[1.2, 1, 1]} />
            {matAccent}
          </mesh>
          <mesh position={[0, 0, 0.51]}>
            <ringGeometry args={[0.18, 0.34, 20]} />
            {matAccent2}
          </mesh>
        </group>
      );
    case "icosahedron":
      return (
        <mesh ref={ref as React.RefObject<THREE.Mesh>}>
          <icosahedronGeometry args={[0.95, 0]} />
          {matAccent}
        </mesh>
      );
    case "cube":
    default:
      return (
        <mesh ref={ref as React.RefObject<THREE.Mesh>}>
          <boxGeometry args={[1.15, 1.15, 1.15]} />
          {matAccent}
        </mesh>
      );
  }
}
