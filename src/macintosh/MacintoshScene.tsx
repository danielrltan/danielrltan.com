import { useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  SKILL_LOGOS,
  type MacProject,
  type SkillLogo,
} from "./projects";

/**
 * 3D scene for the Macintosh section. Layers:
 *   1. Skill-logo orbit ring around a vertical Y axis.
 *   2. Retro Macintosh built from primitives. Floats high to start,
 *      lands at center as the user scrolls.
 *   3. Drei <Html /> overlay positioned over the Mac's screen face;
 *      shows a boot sequence, then a desktop of project tiles.
 *
 * Pin progress 0..1 is read each frame from the parent's ref.
 */

interface Props {
  pinProgressRef: React.MutableRefObject<number>;
  projects: MacProject[];
  onSelectProject: (p: MacProject) => void;
}

const THRESHOLDS = {
  descentStart: 0.20,
  descentEnd: 0.42,
  bootStart: 0.42,
  bootEnd: 0.52,
  desktopStart: 0.50,
  disintegrateStart: 0.55,
  disintegrateEnd: 0.75,
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

const MAC_HOVER_Y = 3.2;
const MAC_REST_Y = -0.2;
// Orbit must be visibly bigger than the Mac AND close enough to read
// each logo individually. Tightened to 1.8 so logos don't pass too
// close to the camera (at camera z=7 they'd be ~5.2 away — readable).
const ORBIT_RADIUS = 1.8;

function LogoOrbit({
  logos,
  disintegrateRef,
}: {
  logos: SkillLogo[];
  disintegrateRef: React.MutableRefObject<number>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += dt * 0.18;
    }
  });
  return (
    <group ref={groupRef}>
      {logos.map((logo, i) => {
        const angle = (i / logos.length) * Math.PI * 2;
        const x = Math.sin(angle) * ORBIT_RADIUS;
        const z = Math.cos(angle) * ORBIT_RADIUS;
        return (
          <LogoSprite
            key={logo.label}
            logo={logo}
            position={[x, 1.2, z]}
            rotationY={angle}
            disintegrateRef={disintegrateRef}
            seed={i}
          />
        );
      })}
    </group>
  );
}

function LogoSprite({
  logo,
  position,
  rotationY,
  disintegrateRef,
  seed,
}: {
  logo: SkillLogo;
  position: [number, number, number];
  rotationY: number;
  disintegrateRef: React.MutableRefObject<number>;
  seed: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const offset = useMemo(() => {
    const a = seed * 1.3;
    return new THREE.Vector3(
      Math.cos(a) * 0.8,
      Math.sin(a * 1.7) * 0.6,
      Math.sin(a) * 0.5,
    );
  }, [seed]);
  const texture = useMemo(() => makeLogoTexture(logo), [logo]);

  useFrame(() => {
    const m = meshRef.current;
    if (!m) return;
    const d = disintegrateRef.current;
    m.position.set(
      position[0] + offset.x * d * 1.5,
      position[1] + offset.y * d * 1.5,
      position[2] + offset.z * d * 1.5,
    );
    m.scale.setScalar(1 - d * 0.6);
    if (matRef.current) matRef.current.opacity = Math.max(0, 1 - d * 1.1);
  });

  return (
    <mesh ref={meshRef} position={position} rotation={[0, rotationY, 0]}>
      <planeGeometry args={[0.85, 0.45]} />
      <meshBasicMaterial
        ref={matRef}
        map={texture}
        transparent
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function makeLogoTexture(logo: SkillLogo): THREE.CanvasTexture {
  const w = 256;
  const h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const radius = 16;
  ctx.fillStyle = logo.color;
  roundRect(ctx, 0, 0, w, h, radius);
  ctx.fill();
  const lum = relLuminance(logo.color);
  ctx.fillStyle = lum > 0.5 ? "#1a1714" : "#ffffff";
  ctx.font = "600 36px 'Space Grotesk', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(logo.label, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function relLuminance(hex: string): number {
  const v = hex.replace("#", "");
  const r = parseInt(v.slice(0, 2), 16) / 255;
  const g = parseInt(v.slice(2, 4), 16) / 255;
  const b = parseInt(v.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function MacBody({
  screenOnRef,
  screenTexture,
}: {
  screenOnRef: React.MutableRefObject<number>;
  screenTexture: THREE.Texture;
}) {
  const screenMatRef = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    if (screenMatRef.current) {
      // The screen face is opacity-controlled so it stays dark when
      // off and fully visible (with map drawn) when on.
      screenMatRef.current.opacity = Math.min(1, screenOnRef.current * 1.5 + 0.1);
      screenMatRef.current.emissiveIntensity = screenOnRef.current * 0.6;
    }
  });
  return (
    <group>
      <mesh position={[0, 0.85, 0]} castShadow>
        <boxGeometry args={[1.6, 1.7, 1.05]} />
        <meshStandardMaterial color="#e3dccf" roughness={0.6} metalness={0.05} />
      </mesh>
      <mesh position={[0, 1.71, 0]}>
        <boxGeometry args={[1.4, 0.04, 0.95]} />
        <meshStandardMaterial color="#c8c0b0" roughness={0.55} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.0, 0.53]}>
        <boxGeometry args={[1.15, 0.85, 0.02]} />
        <meshStandardMaterial color="#171511" roughness={0.4} metalness={0.05} />
      </mesh>
      <mesh position={[0, 1.0, 0.545]}>
        <planeGeometry args={[1.02, 0.72]} />
        <meshStandardMaterial
          ref={screenMatRef}
          map={screenTexture}
          color="#ffffff"
          emissiveMap={screenTexture}
          emissive="#ffffff"
          emissiveIntensity={0}
          transparent
          roughness={0.25}
          metalness={0}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 0.32, 0.53]}>
        <boxGeometry args={[1.4, 0.5, 0.02]} />
        <meshStandardMaterial color="#d8d0c0" roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh position={[0.5, 0.3, 0.545]}>
        <circleGeometry args={[0.025, 16]} />
        <meshStandardMaterial
          color="#e87040"
          emissive="#e87040"
          emissiveIntensity={1.2}
          roughness={0.3}
          metalness={0}
        />
      </mesh>
      <mesh position={[0.45, 0.55, 0.545]}>
        <boxGeometry args={[0.5, 0.03, 0.005]} />
        <meshStandardMaterial color="#a89e8c" roughness={0.6} metalness={0.05} />
      </mesh>
      <mesh position={[0, -0.05, 0]}>
        <boxGeometry args={[1.5, 0.1, 1.0]} />
        <meshStandardMaterial color="#c8c0b0" roughness={0.55} metalness={0.1} />
      </mesh>
    </group>
  );
}

/**
 * Boot text + project-tile screen contents painted to a 2D canvas
 * and used as the texture map on the Mac's screen face. More reliable
 * than drei's <Html transform> for embedding HTML into a 3D plane
 * — and it gives a more authentic CRT feel since the contents are
 * literally pixel-baked onto the screen plane. Click interaction is
 * handled by a separate raycast (see ScreenClickPlane).
 */
function useScreenTexture(
  projects: MacProject[],
  bootProgress: number,
  hoverIndex: number | null,
): THREE.CanvasTexture {
  return useMemo(() => {
    const w = 780;
    const h = 550;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    drawScreen(ctx, w, h, projects, bootProgress, hoverIndex);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    (tex as unknown as { __canvas?: HTMLCanvasElement }).__canvas = canvas;
    return tex;
    // We rebuild the texture on every change of inputs — for boot text
    // typing this fires at the 30Hz throttle of the parent's state.
  }, [projects, bootProgress, hoverIndex]);
}

function drawScreen(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  projects: MacProject[],
  bootProgress: number,
  hoverIndex: number | null,
) {
  // Background.
  ctx.fillStyle = "#0b0b0b";
  ctx.fillRect(0, 0, w, h);
  // Faint scanlines for CRT feel.
  ctx.fillStyle = "rgba(255, 120, 66, 0.04)";
  for (let y = 0; y < h; y += 3) {
    ctx.fillRect(0, y, w, 1);
  }
  const showDesktop = bootProgress >= 0.95;
  if (!showDesktop) {
    // Boot text — typed-out characters.
    const lines = ["BOOT_OS v1.0", "loading projects.dir...", "READY."];
    const totalChars = lines.reduce((s, l) => s + l.length, 0);
    const charsToShow = Math.floor(bootProgress * totalChars * 1.25);
    let remaining = charsToShow;
    ctx.fillStyle = "#e87040";
    ctx.font = "600 30px 'JetBrains Mono', monospace";
    ctx.textBaseline = "top";
    let y = 40;
    for (const line of lines) {
      if (remaining <= 0) break;
      const take = Math.min(line.length, remaining);
      remaining -= take;
      ctx.fillText(line.slice(0, take), 40, y);
      y += 42;
    }
    return;
  }
  // Desktop UI — top bar + grid of project tiles.
  ctx.fillStyle = "#e87040";
  ctx.font = "600 18px 'JetBrains Mono', monospace";
  ctx.textBaseline = "top";
  ctx.fillText("⊚ projects.dir", 28, 24);
  ctx.textAlign = "right";
  ctx.fillText(`${projects.length} items`, w - 28, 24);
  ctx.textAlign = "left";
  // Underline.
  ctx.strokeStyle = "rgba(232, 112, 64, 0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(28, 56);
  ctx.lineTo(w - 28, 56);
  ctx.stroke();
  // Tile grid (2 columns).
  const tileW = (w - 28 * 2 - 18) / 2;
  const tileH = (h - 56 - 28 - 18) / 2;
  const cols = 2;
  projects.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 28 + col * (tileW + 18);
    const y = 56 + 18 + row * (tileH + 18);
    // Gradient bg using the project's accent color.
    const grad = ctx.createLinearGradient(x, y, x + tileW, y + tileH);
    grad.addColorStop(0, p.color);
    grad.addColorStop(1, "#000");
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, tileW, tileH, 12);
    ctx.fill();
    // Hover highlight ring.
    if (hoverIndex === i) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // Labels — meta + title near the bottom-left of the tile.
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "500 11px 'JetBrains Mono', monospace";
    ctx.fillText(p.meta.split(" · ")[0]!, x + 16, y + tileH - 52);
    ctx.fillStyle = "#ffffff";
    ctx.font = "600 22px 'Space Grotesk', system-ui, sans-serif";
    ctx.fillText(p.title, x + 16, y + tileH - 28);
  });
}

/**
 * Invisible click-catcher plane in 3D space, positioned exactly over
 * the Mac's screen. Raycasts pointer events to compute which tile
 * row/column was hit, then calls onSelect with the matching project.
 * Separate from the texture above because the texture is just pixels
 * — actual hit detection needs a real mesh.
 */
function ScreenClickPlane({
  projects,
  onSelect,
  enabled,
  onHoverChange,
}: {
  projects: MacProject[];
  onSelect: (p: MacProject) => void;
  enabled: boolean;
  onHoverChange: (i: number | null) => void;
}) {
  const cols = 2;
  return (
    <mesh
      position={[0, 1.0, 0.557]}
      onPointerMove={(e) => {
        if (!enabled) return;
        // e.uv is the hit point in plane UV coords (0..1).
        const uv = e.uv;
        if (!uv) return;
        // Map UV to tile index. Screen geometry is 1.02 x 0.72.
        // UV (0,0) is bottom-left of plane. Tiles fill the lower
        // ~60% of the screen. Above that is the bar.
        const v = 1 - uv.y; // top=0, bottom=1
        if (v < 0.115) {
          // Top bar area
          onHoverChange(null);
          return;
        }
        const tileV = (v - 0.115) / 0.885;
        const row = tileV < 0.5 ? 0 : 1;
        const col = uv.x < 0.5 ? 0 : 1;
        const i = row * cols + col;
        if (i < projects.length) {
          onHoverChange(i);
          document.body.style.cursor = "pointer";
        } else {
          onHoverChange(null);
          document.body.style.cursor = "";
        }
      }}
      onPointerOut={() => {
        onHoverChange(null);
        document.body.style.cursor = "";
      }}
      onClick={(e) => {
        if (!enabled) return;
        const uv = e.uv;
        if (!uv) return;
        const v = 1 - uv.y;
        if (v < 0.115) return;
        const tileV = (v - 0.115) / 0.885;
        const row = tileV < 0.5 ? 0 : 1;
        const col = uv.x < 0.5 ? 0 : 1;
        const i = row * cols + col;
        if (i < projects.length) onSelect(projects[i]!);
      }}
    >
      <planeGeometry args={[1.02, 0.72]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function Scene({
  pinProgressRef,
  projects,
  onSelectProject,
}: Props) {
  const macGroupRef = useRef<THREE.Group>(null);
  const screenOnRef = useRef(0);
  const disintegrateRef = useRef(0);

  // Boot progress + hover index are React state so the screen texture
  // re-renders the typed-out characters / hover highlight. Boot is
  // throttled to ~30Hz inside the useFrame below; hover updates
  // event-driven.
  const [bootProgress, setBootProgress] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const lastTickRef = useRef(0);

  const screenTexture = useScreenTexture(projects, bootProgress, hoverIndex);

  useFrame(() => {
    const p = pinProgressRef.current;
    const descent = easeOutCubic(
      clamp01(
        (p - THRESHOLDS.descentStart) /
          (THRESHOLDS.descentEnd - THRESHOLDS.descentStart),
      ),
    );
    const newBoot = clamp01(
      (p - THRESHOLDS.bootStart) /
        (THRESHOLDS.bootEnd - THRESHOLDS.bootStart),
    );
    const newDisintegrate = clamp01(
      (p - THRESHOLDS.disintegrateStart) /
        (THRESHOLDS.disintegrateEnd - THRESHOLDS.disintegrateStart),
    );
    screenOnRef.current = newBoot;
    disintegrateRef.current = newDisintegrate;
    if (macGroupRef.current) {
      macGroupRef.current.position.y =
        MAC_HOVER_Y + (MAC_REST_Y - MAC_HOVER_Y) * descent;
    }
    // Throttle React state updates to ~30Hz so the typed-out boot
    // text and screen texture re-render is a normal cadence and not
    // a full-render-per-frame cost.
    const now = performance.now();
    if (now - lastTickRef.current >= 33) {
      lastTickRef.current = now;
      setBootProgress((prev) => (Math.abs(prev - newBoot) > 0.02 ? newBoot : prev));
    }
  });

  // True once the desktop UI is showing — gates the click plane so
  // accidental clicks during boot don't trigger project selection.
  const showDesktop = bootProgress >= 0.95;

  // disintegrateRef kept alive so the existing per-frame state-update
  // code path still runs without modification, but the LogoOrbit
  // consumer is gone — tech logos are now rendered as a flat HTML
  // marquee outside the canvas (see Macintosh.tsx → TechStackTicker).
  // The user's note: "showing it around the monitor is gonna be
  // really fucking hard and it's better to just see it laid out flat."
  void disintegrateRef;
  return (
    <>
      <ambientLight intensity={0.55} color="#fff4e8" />
      <directionalLight position={[3, 5, 3]} intensity={1.0} color="#fff" />
      <directionalLight position={[-3, 2, 2]} intensity={0.35} color="#ffd4a8" />
      <group ref={macGroupRef}>
        <MacBody screenOnRef={screenOnRef} screenTexture={screenTexture} />
        <ScreenClickPlane
          projects={projects}
          onSelect={onSelectProject}
          enabled={showDesktop}
          onHoverChange={setHoverIndex}
        />
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.21, 0]} receiveShadow>
        <planeGeometry args={[5, 5]} />
        <shadowMaterial opacity={0.18} />
      </mesh>
    </>
  );
}


export function MacintoshScene(props: Props) {
  return (
    <Canvas
      camera={{ position: [0, 1.6, 7.0], fov: 28, near: 0.1, far: 40 }}
      dpr={[1, 1.5]}
      shadows
      gl={{
        antialias: true,
        alpha: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.0,
      }}
    >
      <Scene {...props} />
    </Canvas>
  );
}
