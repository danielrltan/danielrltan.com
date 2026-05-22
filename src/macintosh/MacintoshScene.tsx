import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, OrbitControls } from "@react-three/drei";
import * as THREE from "three";

// Tune mode — visit ?tune=mac to enter a free-camera, slider-driven
// positioning view. Lets the user drag the Mac into the framing they
// want and read back the scale / camera values to paste into the
// constants below.
const TUNE_MODE =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("tune") === "mac";
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

// Preload the GLB so it's ready when the section pins. URL is the
// path served by Vite/static — see public/mac.glb.
useGLTF.preload("/mac.glb");

function MacBody({
  screenOnRef,
  screenTexture,
}: {
  screenOnRef: React.MutableRefObject<number>;
  screenTexture: THREE.Texture;
}) {
  // Load the GLB. The shape of the .scene return from useGLTF is a
  // THREE.Group; we walk it to find the screen mesh + apply the
  // CanvasTexture there, so the boot text / desktop tiles paint on
  // whatever mesh the artist designated as the CRT face.
  const { scene } = useGLTF("/mac.glb") as unknown as { scene: THREE.Group };
  // screenMeshRef tracks the GLB's screen mesh (housing painted
  // dark). screenOverlayRef is the plane we attach in front of it
  // with the live canvas texture — overlay has clean 0..1 UVs so
  // the texture renders regardless of the GLB mesh's UV layout.
  const screenMeshRef = useRef<THREE.Mesh | null>(null);
  const screenOverlayRef = useRef<THREE.Mesh | null>(null);
  void screenMeshRef;
  void screenOverlayRef;

  // Clone the loaded GLB once. The traversal below operates on this
  // clone (NOT the cached original) because <primitive> renders the
  // clone — swapping a material on the cached scene wouldn't change
  // anything visible. The deep clone gives each instance its own
  // material objects.
  const clone = useMemo(() => scene?.clone(true), [scene]);

  // Walk the clone, identify the screen mesh by material name
  // "screen" (set by the artist), and replace its material with one
  // bound to the live CanvasTexture so the boot text + desktop
  // tiles render on the CRT face.
  useEffect(() => {
    if (!clone) return;
    let screenMesh: THREE.Mesh | null = null;
    clone.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const matSources: THREE.Material[] = Array.isArray(obj.material)
        ? obj.material
        : [obj.material];
      const matchesByMat = matSources.some((m) => {
        const n = (m?.name ?? "").toLowerCase();
        return n === "screen" || n.includes("screen") || n.includes("crt");
      });
      const objName = obj.name.toLowerCase();
      if (
        !screenMesh &&
        (matchesByMat ||
          objName.includes("screen") ||
          objName.includes("crt") ||
          objName.includes("display"))
      ) {
        screenMesh = obj;
      }
      obj.castShadow = true;
      obj.receiveShadow = false;
    });
    if (screenMesh) {
      // Two layers for the CRT face:
      //   1. Paint the existing GLB screen mesh JET BLACK so it
      //      reads as the unlit CRT housing behind the picture.
      //   2. Compute the screen mesh's world-space bounding box and
      //      attach an OVERLAY PLANE in front of it with the canvas
      //      texture. The overlay has clean 0..1 UVs so the texture
      //      renders correctly regardless of the GLB mesh's
      //      (possibly weird) UV layout — which is why the previous
      //      direct material swap was rendering black.
      (screenMesh as THREE.Mesh).material = new THREE.MeshBasicMaterial({
        color: "#080808",
        toneMapped: false,
      });
      screenMeshRef.current = screenMesh;

      // Use the screen mesh's GEOMETRY to derive its actual face
      // orientation — bounding-box axis detection misses tilted
      // screens (CRT faces are angled in the classic Mac model).
      const m = screenMesh as THREE.Mesh;
      m.geometry.computeBoundingBox();
      m.geometry.computeVertexNormals();
      const box = m.geometry.boundingBox!;
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);

      // Find the dominant face normal from the geometry. Iterate
      // the position attribute as triangles, compute each face's
      // normal, accumulate by area. The biggest-area direction is
      // the screen face's normal.
      const posAttr = m.geometry.getAttribute("position") as THREE.BufferAttribute;
      const idxAttr = m.geometry.getIndex();
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const ab = new THREE.Vector3();
      const ac = new THREE.Vector3();
      const n = new THREE.Vector3();
      const accum = new THREE.Vector3();
      const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
      for (let i = 0; i < triCount; i++) {
        const i0 = idxAttr ? idxAttr.getX(i * 3) : i * 3;
        const i1 = idxAttr ? idxAttr.getX(i * 3 + 1) : i * 3 + 1;
        const i2 = idxAttr ? idxAttr.getX(i * 3 + 2) : i * 3 + 2;
        a.fromBufferAttribute(posAttr, i0);
        b.fromBufferAttribute(posAttr, i1);
        c.fromBufferAttribute(posAttr, i2);
        ab.subVectors(b, a);
        ac.subVectors(c, a);
        n.crossVectors(ab, ac);
        const area = n.length() / 2;
        // Bias toward the screen-facing normal: in the mac.glb the
        // screen face is tilted forward (toward camera), and that
        // face has the largest area among the screen mesh's faces.
        accum.add(n.normalize().multiplyScalar(area));
      }
      accum.normalize();
      // Use the dominant normal for both face direction AND the
      // direction we nudge the overlay so it sits in front of the
      // screen mesh's surface.
      const overlaySize = new THREE.Vector2(
        Math.max(size.x, size.z) * 0.95,
        Math.max(size.y, size.x) * 0.6,
      );
      // Better width/height: use the two largest bbox axes.
      const sortedSizes: Array<[string, number]> = [
        ["x", size.x],
        ["y", size.y],
        ["z", size.z],
      ].sort((p, q) => q[1] - p[1]) as Array<[string, number]>;
      overlaySize.set(sortedSizes[0]![1], sortedSizes[1]![1]);

      const overlayGeo = new THREE.PlaneGeometry(
        overlaySize.x,
        overlaySize.y,
      );
      const overlayMat = new THREE.MeshBasicMaterial({
        map: screenTexture,
        color: "#ffffff",
        toneMapped: false,
        side: THREE.DoubleSide,
        transparent: false,
        depthTest: false,
        depthWrite: false,
      });
      const overlay = new THREE.Mesh(overlayGeo, overlayMat);
      // Position at center of screen mesh, nudged 1% of the bbox
      // diagonal along the dominant normal direction.
      overlay.position.copy(center);
      const nudge = Math.max(size.length() * 0.01, 0.01);
      overlay.position.add(accum.clone().multiplyScalar(nudge));
      // Orient the plane so its +Z normal aligns with `accum`.
      // lookAt expects a target point; passing center + accum makes
      // the plane face that direction.
      const target = overlay.position.clone().add(accum);
      overlay.lookAt(target);
      overlay.renderOrder = 999;
      screenMesh.add(overlay);
      screenOverlayRef.current = overlay;
    }
    return () => {
      const overlay = screenOverlayRef.current;
      if (overlay && overlay.parent) {
        overlay.parent.remove(overlay);
        overlay.geometry.dispose();
        (overlay.material as THREE.Material).dispose();
      }
      screenOverlayRef.current = null;
    };
    // Only depend on `clone` — overlay is created once per mac model.
    // Texture updates handled by the separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clone]);

  // Swap the overlay material's texture whenever the canvas re-renders
  // (boot text typing, hover, desktop tiles). Avoids recreating the
  // overlay geometry every 30Hz.
  useEffect(() => {
    const overlay = screenOverlayRef.current;
    if (!overlay) return;
    const mat = overlay.material as THREE.MeshBasicMaterial;
    mat.map = screenTexture;
    mat.needsUpdate = true;
  }, [screenTexture]);

  // (Previous per-frame opacity/emissive ramp on screenMatRef is
  // gone — MeshBasicMaterial doesn't have those properties; the CRT
  // is now always 'on' so the texture renders the moment the boot
  // sequence starts drawing into the canvas. screenOnRef left wired
  // up for future ramped effects.)
  void screenOnRef;

  if (!clone) return null;
  // In tune mode, read scale + position from window.__macTune so
  // the slider HUD can drive the model live.
  return <MacRig clone={clone} />;
}

/**
 * Wraps the loaded mac.glb in a group whose scale + position can be
 * tweaked at runtime by the tune HUD (TUNE_MODE only) or remain at
 * the locked-in defaults outside tune mode.
 */
function MacRig({ clone }: { clone: THREE.Group }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!TUNE_MODE) return;
    const g = groupRef.current;
    if (!g) return;
    const t = (window as unknown as { __macTune?: { scale: number; y: number } })
      .__macTune;
    if (!t) return;
    g.scale.setScalar(t.scale);
    g.position.y = t.y;
  });
  // Defaults match the values that frame the Mac centered in view at
  // the canonical camera pose. Tune mode lets the user override.
  return (
    <group ref={groupRef} scale={[0.21, 0.21, 0.21]} position={[0, 0, 0]}>
      <primitive object={clone} />
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
      {/* Neutral lighting — was warm cream + orange fill which made the
          off-white Mac body read muddy. Pure white directional +
          cooler white fill keeps the body color clean. */}
      <ambientLight intensity={0.7} color="#ffffff" />
      <directionalLight position={[3, 5, 3]} intensity={1.2} color="#ffffff" />
      <directionalLight position={[-3, 2, 2]} intensity={0.45} color="#eef4ff" />
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
    <>
      <Canvas
        // Camera framing: user dragged to pos [-1.09, 0.74, 3.03],
        // fov 28 — that was visually close to ideal but the Mac
        // was clipping at the right edge. Pulled back ~50% along
        // the same direction vector to keep the angle but give
        // breathing room around the model: [-1.6, 1.1, 4.5].
        camera={{ position: [-1.6, 1.1, 4.5], fov: 28, near: 0.1, far: 40 }}
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
        {TUNE_MODE && <TuneCameraReader />}
        {TUNE_MODE && (
          <OrbitControls
            enableDamping
            dampingFactor={0.08}
            target={[0, 0.8, 0]}
            minDistance={2}
            maxDistance={20}
          />
        )}
      </Canvas>
      {TUNE_MODE && <MacTuneHUD />}
    </>
  );
}

/**
 * In tune mode, copies the OrbitControls-driven camera position +
 * fov into window.__macCamTune every frame so the HUD can show
 * paste-ready values.
 */
function TuneCameraReader() {
  const { camera } = useThree();
  useFrame(() => {
    const c = camera as THREE.PerspectiveCamera;
    (window as unknown as {
      __macCamTune?: { pos: [number, number, number]; fov: number };
    }).__macCamTune = {
      pos: [
        Math.round(c.position.x * 100) / 100,
        Math.round(c.position.y * 100) / 100,
        Math.round(c.position.z * 100) / 100,
      ],
      fov: Math.round((c as THREE.PerspectiveCamera).fov * 10) / 10,
    };
  });
  return null;
}

/**
 * Slider panel pinned to the screen edge in TUNE_MODE. Lets the user
 * drag the Mac's scale + Y offset live, while the camera is free-
 * moved by OrbitControls. The current values are reflected back so
 * the user can copy them into the code.
 */
function MacTuneHUD() {
  const [scale, setScale] = useState(0.21);
  const [y, setY] = useState(0);
  const [camInfo, setCamInfo] = useState({ pos: [0, 1.6, 7] as number[], fov: 28 });

  useEffect(() => {
    (window as unknown as { __macTune: { scale: number; y: number } })
      .__macTune = { scale, y };
  }, [scale, y]);

  useEffect(() => {
    const id = setInterval(() => {
      const c = (window as unknown as {
        __macCamTune?: { pos: [number, number, number]; fov: number };
      }).__macCamTune;
      if (c) setCamInfo(c);
    }, 100);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        top: 16,
        left: 16,
        zIndex: 9999,
        background: "rgba(20, 17, 14, 0.92)",
        color: "#fff",
        padding: "16px 18px",
        borderRadius: 10,
        fontFamily: "var(--font-mono), JetBrains Mono, monospace",
        fontSize: 11,
        letterSpacing: "0.06em",
        lineHeight: 1.5,
        boxShadow: "0 12px 32px -8px rgba(0,0,0,0.55)",
        width: 260,
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 10, color: "#ffae6a" }}>
        MAC TUNE
      </div>
      <label style={{ display: "block", marginBottom: 8 }}>
        scale: {scale.toFixed(3)}
        <input
          type="range"
          min={0.05}
          max={1.5}
          step={0.005}
          value={scale}
          onChange={(e) => setScale(parseFloat(e.target.value))}
          style={{ width: "100%", marginTop: 4 }}
        />
      </label>
      <label style={{ display: "block", marginBottom: 12 }}>
        y offset: {y.toFixed(3)}
        <input
          type="range"
          min={-3}
          max={3}
          step={0.01}
          value={y}
          onChange={(e) => setY(parseFloat(e.target.value))}
          style={{ width: "100%", marginTop: 4 }}
        />
      </label>
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.18)", paddingTop: 10, marginBottom: 10 }}>
        <div style={{ opacity: 0.65, marginBottom: 4 }}>CAMERA</div>
        <div>
          pos: [{camInfo.pos[0]}, {camInfo.pos[1]}, {camInfo.pos[2]}]
        </div>
        <div>fov: {camInfo.fov}</div>
      </div>
      <div style={{ opacity: 0.7, fontSize: 10 }}>
        Drag the canvas to rotate camera. Adjust sliders for Mac scale + Y.
        Paste values back to MacintoshScene.tsx when done.
      </div>
    </div>
  );
}
