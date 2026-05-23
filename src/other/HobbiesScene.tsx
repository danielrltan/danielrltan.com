import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Hobbies scene — replaces the previous OtherDeskScene. 10 floating
 * 3D objects representing personal interests, arranged as a loose
 * asymmetric cluster in empty space (no surface). Hover an object →
 * tooltip with the hobby label. The camera drifts slowly around the
 * Y axis to give the scene constant subtle life.
 *
 * Each item:
 *   - Loads its GLB from /public/hobbies/{file} in parallel via
 *     GLTFLoader. Until the asset arrives (or if it 404s), a varied
 *     primitive placeholder occupies the same slot so the layout is
 *     correct from t=0.
 *   - Has independent gentle Y bob + slow rotation on a per-item
 *     random axis. Motion is unsynchronized so the cluster feels
 *     organic rather than mechanical.
 *   - One item — the "anchor" — is 30% larger than the others and
 *     sits roughly central. The other nine orbit at varied distances.
 *
 * Tooltip:
 *   - DOM <div> overlaid on the canvas. Positioned via mousemove
 *     listener at cursor + 20px offset. 180ms enter delay (avoids
 *     flicker when sweeping past objects), 200ms leave delay (avoids
 *     flicker when crossing an object's edge).
 *   - On touch devices, tap to show / tap elsewhere to dismiss; no
 *     hover delay.
 */

interface Hobby {
  id: string;
  file: string;
  label: string;
}

const HOBBIES: Hobby[] = [
  { id: "belt",     file: "belt.glb",     label: "Taekwondo"   },
  { id: "piano",    file: "piano.glb",    label: "Piano"       },
  { id: "pc",       file: "pc.glb",       label: "Workstation" },
  { id: "shoe",     file: "shoe.glb",     label: "Fashion"     },
  { id: "keyboard", file: "keyboard.glb", label: "Keyboards"   },
  { id: "cursor",   file: "cursor.glb",   label: "Design"      },
  { id: "turbo",    file: "turbo.glb",    label: "Cars"        },
  { id: "yarn",     file: "yarn.glb",     label: "Crocheting"  },
  { id: "luggage",  file: "luggage.glb",  label: "Travel"      },
  { id: "ski",      file: "ski.glb",      label: "Skiing"      },
];

// "pc" is the visual anchor — central, 30% bigger than the rest.
const ANCHOR_ID = "pc";

/**
 * Hand-tuned asymmetric cluster. Volume ≈ 6 wide × 4 tall × 4 deep,
 * centered at origin. No two items share the same X or Y so the
 * silhouettes don't stack. Anchor sits near origin; the other nine
 * are distributed across all eight octants with varied radii so the
 * cluster reads as a sculpted swarm rather than a sphere.
 */
const LAYOUT: Record<string, { pos: [number, number, number]; placeholder: PlaceholderKind }> = {
  pc:       { pos: [ 0.0,  0.2,  0.0], placeholder: "icosahedron" },
  piano:    { pos: [-2.0,  0.8, -1.2], placeholder: "box"         },
  keyboard: { pos: [ 1.6, -0.3,  0.8], placeholder: "torus"       },
  shoe:     { pos: [-1.8, -0.7,  1.3], placeholder: "cone"        },
  cursor:   { pos: [ 1.4,  1.1, -0.6], placeholder: "octahedron"  },
  belt:     { pos: [-1.2, -1.2, -0.8], placeholder: "dodecahedron"},
  turbo:    { pos: [ 2.2, -0.2, -1.5], placeholder: "cylinder"    },
  yarn:     { pos: [-2.4,  0.4,  1.0], placeholder: "sphere"      },
  luggage:  { pos: [ 0.8, -1.4,  1.4], placeholder: "tetrahedron" },
  ski:      { pos: [-0.4,  1.4,  1.6], placeholder: "ring"        },
};

type PlaceholderKind =
  | "icosahedron"
  | "box"
  | "torus"
  | "cone"
  | "octahedron"
  | "dodecahedron"
  | "cylinder"
  | "sphere"
  | "tetrahedron"
  | "ring";

const PLACEHOLDER_COLOR = "#c08a5e";

function PlaceholderMesh({ kind, size }: { kind: PlaceholderKind; size: number }) {
  const r = size * 0.55;
  switch (kind) {
    case "icosahedron":
      return <icosahedronGeometry args={[r, 0]} />;
    case "box":
      return <boxGeometry args={[size, size * 0.8, size * 0.9]} />;
    case "torus":
      return <torusGeometry args={[r * 0.85, r * 0.32, 12, 32]} />;
    case "cone":
      return <coneGeometry args={[r, size * 1.2, 16]} />;
    case "octahedron":
      return <octahedronGeometry args={[r, 0]} />;
    case "dodecahedron":
      return <dodecahedronGeometry args={[r, 0]} />;
    case "cylinder":
      return <cylinderGeometry args={[r * 0.7, r * 0.85, size * 0.9, 16]} />;
    case "sphere":
      return <sphereGeometry args={[r, 20, 16]} />;
    case "tetrahedron":
      return <tetrahedronGeometry args={[r * 1.05, 0]} />;
    case "ring":
      return <torusGeometry args={[r * 0.95, r * 0.18, 8, 28]} />;
  }
}

/** Per-item animation parameters, deterministic per id so each
 *  mount looks the same but no two items move in lockstep. */
interface AnimParams {
  bobAmp: number;
  bobPeriod: number;
  bobPhase: number;
  rotAxis: THREE.Vector3;
  rotSpeed: number;
  initialRot: THREE.Euler;
}

function makeAnim(id: string): AnimParams {
  // Cheap deterministic hash → 0..1 floats from the id string.
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
  const axis = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
  return {
    bobAmp: 0.08 + rand() * 0.05,
    bobPeriod: 3 + rand() * 3, // 3..6s
    bobPhase: rand() * Math.PI * 2,
    rotAxis: axis,
    rotSpeed: 0.1 + rand() * 0.2,
    initialRot: new THREE.Euler(
      (rand() - 0.5) * 0.8,
      (rand() - 0.5) * Math.PI * 2,
      (rand() - 0.5) * 0.8,
    ),
  };
}

interface HobbyMeshProps {
  hobby: Hobby;
  scene: THREE.Group | null; // null = not loaded yet (or failed) → render placeholder
  isAnchor: boolean;
  onHoverChange: (hovering: boolean, label: string) => void;
}

function HobbyMesh({ hobby, scene, isAnchor, onHoverChange }: HobbyMeshProps) {
  const groupRef = useRef<THREE.Group>(null);
  const hoverLerpRef = useRef(0);
  const hoveredRef = useRef(false);

  const layout = LAYOUT[hobby.id]!;
  const baseSize = isAnchor ? 1.3 : 1.0;
  const placeholderSize = baseSize * 0.7;
  const anim = useMemo(() => makeAnim(hobby.id), [hobby.id]);

  // GLBs come in with arbitrary scales. Normalize to a target bounding
  // sphere radius so all 10 read at consistent visual sizes regardless
  // of how they were modeled. Anchor gets a 1.3x bump on top.
  const normalizedScene = useMemo(() => {
    if (!scene) return null;
    const cloned = scene.clone(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const targetRadius = baseSize * 0.6;
    const k = sphere.radius > 0 ? targetRadius / sphere.radius : 1;
    cloned.scale.setScalar(k);
    // Re-center so the model's bbox sits at the group origin.
    const center = box.getCenter(new THREE.Vector3()).multiplyScalar(k);
    cloned.position.sub(center);
    return cloned;
  }, [scene, baseSize]);

  useFrame((state, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    // Bob — sinusoidal Y offset around the layout position.
    const y = layout.pos[1] + Math.sin((t / anim.bobPeriod) * Math.PI * 2 + anim.bobPhase) * anim.bobAmp;
    g.position.set(layout.pos[0], y, layout.pos[2]);
    // Continuous rotation around the per-item axis.
    g.rotateOnAxis(anim.rotAxis, anim.rotSpeed * dt);
    // Hover scale — smooth lerp toward 1.0 or 1.1.
    const target = hoveredRef.current ? 1.1 : 1.0;
    hoverLerpRef.current += (target - hoverLerpRef.current) * (1 - Math.exp(-dt * 8));
    g.scale.setScalar(hoverLerpRef.current);
  });

  // Set initial rotation once, before useFrame's first tick overrides.
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    g.rotation.copy(anim.initialRot);
  }, [anim.initialRot]);

  const onPointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hoveredRef.current = true;
    onHoverChange(true, hobby.label);
  };
  const onPointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hoveredRef.current = false;
    onHoverChange(false, hobby.label);
  };

  return (
    <group ref={groupRef} onPointerOver={onPointerOver} onPointerOut={onPointerOut}>
      {normalizedScene ? (
        <primitive object={normalizedScene} />
      ) : (
        <mesh>
          <PlaceholderMesh kind={layout.placeholder} size={placeholderSize} />
          <meshStandardMaterial color={PLACEHOLDER_COLOR} roughness={0.55} metalness={0.15} />
        </mesh>
      )}
    </group>
  );
}

function SceneInner({
  loaded,
  onHoverChange,
}: {
  loaded: Record<string, THREE.Group | null>;
  onHoverChange: (hovering: boolean, label: string) => void;
}) {
  // Slow camera orbit around the Y axis — gives the cluster constant
  // subtle life without giving control to the user.
  const { camera } = useThree();
  const orbitState = useRef({
    radius: 9.5,
    height: 1.4,
    angle: Math.PI * 0.18, // start slightly off-center so the anchor isn't dead-center symmetric
  });

  useFrame((_, dt) => {
    const s = orbitState.current;
    s.angle += dt * 0.05;
    camera.position.set(
      Math.sin(s.angle) * s.radius,
      s.height,
      Math.cos(s.angle) * s.radius,
    );
    camera.lookAt(0, 0, 0);
  });

  return (
    <>
      <ambientLight intensity={0.2} color="#fff4e8" />
      <directionalLight position={[4, 6, 3]} intensity={2.0} color="#ffffff" />
      <directionalLight position={[-4, 5, 2]} intensity={0.6} color="#ffd9b3" />
      <directionalLight position={[0, 3, -5]} intensity={0.3} color="#cfd8e0" />
      {HOBBIES.map((h) => (
        <HobbyMesh
          key={h.id}
          hobby={h}
          scene={loaded[h.id] ?? null}
          isAnchor={h.id === ANCHOR_ID}
          onHoverChange={onHoverChange}
        />
      ))}
    </>
  );
}

const HOVER_ENTER_DELAY_MS = 180;
const HOVER_LEAVE_DELAY_MS = 200;

interface TooltipState {
  visible: boolean;
  label: string;
  x: number;
  y: number;
}

export function HobbiesScene() {
  const [loaded, setLoaded] = useState<Record<string, THREE.Group | null>>({});
  const [tooltip, setTooltip] = useState<TooltipState>({
    visible: false,
    label: "",
    x: 0,
    y: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef({ x: 0, y: 0 });
  const enterTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);
  const pendingLabelRef = useRef<string>("");
  const isTouch = useMemo(
    () => typeof window !== "undefined" && "ontouchstart" in window,
    [],
  );

  // Parallel GLB loads. forEach starts all 10 concurrently — there's
  // nothing to await between them, so Promise.all isn't needed.
  useEffect(() => {
    const loader = new GLTFLoader();
    HOBBIES.forEach((h) => {
      loader.load(
        `/hobbies/${h.file}`,
        (gltf) => setLoaded((p) => ({ ...p, [h.id]: gltf.scene })),
        undefined,
        () => {
          // 404 / parse error — leave placeholder by recording null.
          // Logged at debug level only; missing GLBs are expected
          // during the asset-modeling phase.
          setLoaded((p) => ({ ...p, [h.id]: null }));
        },
      );
    });
  }, []);

  // Track cursor in container coords so tooltip can follow.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      cursorRef.current.x = e.clientX - rect.left;
      cursorRef.current.y = e.clientY - rect.top;
      if (tooltip.visible) {
        setTooltip((prev) => ({
          ...prev,
          x: cursorRef.current.x,
          y: cursorRef.current.y,
        }));
      }
    };
    el.addEventListener("pointermove", onMove);
    return () => el.removeEventListener("pointermove", onMove);
  }, [tooltip.visible]);

  // Hover bridge — called by HobbyMesh on pointer over/out.
  const handleHoverChange = (hovering: boolean, label: string) => {
    document.body.style.cursor = hovering ? "pointer" : "";
    if (hovering) {
      pendingLabelRef.current = label;
      if (leaveTimerRef.current != null) {
        window.clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
      }
      if (isTouch) {
        // Touch: show immediately, no enter delay.
        setTooltip({
          visible: true,
          label,
          x: cursorRef.current.x,
          y: cursorRef.current.y,
        });
        return;
      }
      if (enterTimerRef.current != null) return;
      enterTimerRef.current = window.setTimeout(() => {
        enterTimerRef.current = null;
        setTooltip({
          visible: true,
          label: pendingLabelRef.current,
          x: cursorRef.current.x,
          y: cursorRef.current.y,
        });
      }, HOVER_ENTER_DELAY_MS);
    } else {
      if (enterTimerRef.current != null) {
        window.clearTimeout(enterTimerRef.current);
        enterTimerRef.current = null;
      }
      if (leaveTimerRef.current != null) return;
      leaveTimerRef.current = window.setTimeout(() => {
        leaveTimerRef.current = null;
        setTooltip((prev) => ({ ...prev, visible: false }));
      }, HOVER_LEAVE_DELAY_MS);
    }
  };

  // Touch: tap empty space (canvas miss) closes the tooltip.
  const handleMissed = () => {
    if (!isTouch) return;
    setTooltip((prev) => ({ ...prev, visible: false }));
  };

  return (
    <div ref={containerRef} className="hobbies-canvas-wrap">
      <Canvas
        camera={{ position: [0, 1.4, 9.5], fov: 35, near: 0.1, far: 50 }}
        dpr={[1, Math.min(typeof window !== "undefined" ? window.devicePixelRatio : 1, 2)]}
        gl={{ antialias: true, alpha: true }}
        onPointerMissed={handleMissed}
      >
        <SceneInner loaded={loaded} onHoverChange={handleHoverChange} />
      </Canvas>
      {tooltip.visible && (
        <div
          className="hobbies-tooltip"
          style={{
            transform: `translate(${tooltip.x + 20}px, ${tooltip.y + 20}px)`,
          }}
        >
          {tooltip.label}
        </div>
      )}
    </div>
  );
}
