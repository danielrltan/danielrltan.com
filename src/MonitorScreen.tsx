import { useEffect, useState, type ReactNode } from "react";
import { Html, useGLTF } from "@react-three/drei";
import * as THREE from "three";

interface Props {
  children: ReactNode;
  cssWidth?: number;
  cssHeight?: number;
  /** Tiny offset along screen-normal so the HTML plane doesn't z-fight. */
  pushOut?: number;
  /**
   * Multiplier on the auto-derived world scale. The mesh's AABB doesn't
   * always match the visible screen rect (it's the frame, not the glass
   * area, and Blender unit scale can compound). Dial this in until the
   * OS exactly fills the monitor; 1 = pure AABB-derived size.
   */
  sizeMultiplier?: number;
}

interface Pose {
  center: THREE.Vector3;
  /** World-space screen width (auto-detected from the AABB's largest non-thin axis). */
  width: number;
  /** World-space screen height (auto-detected from the AABB). */
  height: number;
  /** Rotation that puts the Html's local XY plane onto the screen face. */
  rotation: THREE.Euler;
}

const FALLBACK_POSE: Pose = {
  // Manifest-derived position in three.js coords (Blender Z-up converted).
  center: new THREE.Vector3(1.4525, 1.0556, -2.0048),
  width: 0.62,
  height: 0.37,
  rotation: new THREE.Euler(0, 0, 0),
};

/**
 * Pick width / height / rotation from a mesh's AABB by finding the thinnest
 * axis (= the screen depth). The other two axes are the screen face.
 *   - thin axis Z → screen on XY plane, no rotation (Html's default).
 *   - thin axis X → screen on YZ plane, rotate +Y by π/2.
 *   - thin axis Y → screen on XZ plane, rotate +X by π/2.
 */
function deriveFace(size: THREE.Vector3): {
  width: number;
  height: number;
  rotation: THREE.Euler;
} {
  const { x, y, z } = size;
  if (z <= x && z <= y) return { width: x, height: y, rotation: new THREE.Euler() };
  if (x <= y && x <= z)
    return { width: z, height: y, rotation: new THREE.Euler(0, Math.PI / 2, 0) };
  return { width: x, height: z, rotation: new THREE.Euler(Math.PI / 2, 0, 0) };
}

/**
 * Mounts arbitrary HTML/React content onto the monitor's screen face in
 * the 3D room via drei's `<Html transform>`. Real DOM, full interactivity.
 *
 * Pose strategy:
 *   - Start with a hardcoded pose pulled from the Blender manifest so we
 *     ALWAYS render something at the monitor, even if the runtime mesh
 *     lookup fails (e.g. on first frame before useGLTF resolves).
 *   - Then a useEffect tries to override that pose with the actual
 *     `clk_monitor_frame.matrixWorld` decomposition; if it works, the
 *     pose snaps into place. If not, the fallback stays in use.
 *
 * Important visual notes:
 *   - `zIndexRange` is clamped low so drei's portal sits *below* the
 *     custom MoveableCursor (z-index 10000) — otherwise the cursor
 *     disappears under the OS overlay.
 *   - `occlude={true}` uses raycasting hit-tests rather than depth-
 *     buffer blending; cheaper and plays well with EffectComposer.
 */

export function MonitorScreen({
  children,
  cssWidth = 1100,
  cssHeight = 660,
  pushOut = 0.01,
  sizeMultiplier = 1
}: Props) {
  const { scene } = useGLTF("/room.glb");
  const [pose, setPose] = useState<Pose>(FALLBACK_POSE);

  useEffect(() => {
    const screen = scene.getObjectByName("clk_monitor_frame");
    if (!screen) {
      console.warn("[MonitorScreen] clk_monitor_frame not in GLB; using fallback pose");
      return;
    }
    scene.updateMatrixWorld(true);
    // The GLB baked Blender world transforms into vertex coordinates, so
    // `matrixWorld.decompose` returns identity — useless. Read the actual
    // geometry world-AABB instead; that IS the mesh's world placement.
    const box = new THREE.Box3().setFromObject(screen);
    if (!isFinite(box.min.x)) {
      console.warn("[MonitorScreen] empty bounding box; keeping fallback");
      return;
    }
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const face = deriveFace(size);
    console.log(
      "[MonitorScreen] center:",
      center.toArray().map((n) => n.toFixed(3)),
      "size:",
      size.toArray().map((n) => n.toFixed(3)),
      "→ face:",
      `${face.width.toFixed(3)} × ${face.height.toFixed(3)}`,
    );
    setPose({ center, width: face.width, height: face.height, rotation: face.rotation });
  }, [scene]);

  // ---------------------------------------------------------------
  //   🛠  TUNE THIS NUMBER to size the OS on the monitor in 3D.
  //       Bigger = OS fills more of the screen face.
  //       Smaller = OS shrinks toward the centre.
  //   The previous AABB-derived auto-calc didn't survive drei's
  //   internal distanceFactor math, so it's a hard-coded knob now.
  // ---------------------------------------------------------------
  const SCALE = 0.022;
  const scale = SCALE * sizeMultiplier; // sizeMultiplier prop still honoured.

  return (
    <group position={pose.center} rotation={pose.rotation}>
      <Html
        transform
        occlude
        position={[0, 0, pushOut]}
        scale={scale}
        zIndexRange={[5000, 0]}
        style={{
          width: cssWidth,
          height: cssHeight,
          overflow: "hidden",
          background: "#000",
          // System cursor takes over once the pointer enters the OS —
          // the custom MoveableCursor is faded out by a `[data-os-root]`
          // check in MoveableCursor.tsx, so we only see one cursor at a
          // time. The two cursor "zones" are: the room (custom) and the
          // PC (system).
          cursor: "auto",
        }}
      >
        <div
          data-os-root="true"
          style={{ width: "100%", height: "100%" }}
        >
          {children}
        </div>
      </Html>
    </group>
  );
}
