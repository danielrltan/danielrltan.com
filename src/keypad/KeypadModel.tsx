import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Loads /keypad.glb and wires up four social keycaps + the spinnable
 * dial. Other meshes render unchanged.
 *
 * GLB nodes (confirmed via scripts/dump-glb-nodes.mjs):
 *   x, linkedin, github, pinterest  — social keycaps (clickable)
 *   knob                              — spinnable dial; parent group
 *                                       with Cylinder006/Cylinder006_1
 *                                       (brushed-metal body + cat
 *                                       face decal) as children;
 *                                       rotating this node spins
 *                                       both meshes together
 *   frame                             — body + sidebutton (parent
 *                                       group with Cube003/Cube003_1
 *                                       child meshes)
 *   Cube006                           — display screen
 *
 * Animations driven from useFrame with fixed-rate damping
 * (per the project's scroll-animations-fixed-rate rule) — no spring
 * library, no per-frame React re-renders.
 */

useGLTF.preload("/keypad.glb");

/**
 * Smooth the normal attribute by averaging across vertices at the
 * SAME POSITION, without merging vertices or touching UV/position/
 * index data. This is the runtime equivalent of Blender's "Shade
 * Smooth" applied per shared position — solves the case where the
 * GLB ships with face-normal-per-vertex on chamfer subdivisions
 * (32 of 40 position-clusters on the keypad caps had normals 26°–60°
 * apart, producing the visible triangulation).
 *
 * Important properties:
 *   - positions UNCHANGED (silhouette unaffected)
 *   - UVs UNCHANGED (icon decals on cap tops stay intact)
 *   - index buffer UNCHANGED (no merging across UV seams)
 *   - ONLY the normal attribute is rewritten
 *
 * Hard edges where the two surfaces don't share a position
 * (e.g. cap top→side 90° seam, where the GLB has slightly-offset
 * vertices on each side) are naturally preserved because they
 * never enter the same position cluster.
 */
function smoothNormalsAcrossSharedPositions(
  geom: THREE.BufferGeometry,
  posTol = 1e-4,
): { clusters: number; merged: number } {
  const pos = geom.attributes.position as THREE.BufferAttribute | undefined;
  const norm = geom.attributes.normal as THREE.BufferAttribute | undefined;
  if (!pos || !norm) return { clusters: 0, merged: 0 };
  // Round each position to the tolerance grid for stable hashing.
  const round = (n: number) => Math.round(n / posTol) * posTol;
  const clusters = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const k =
      round(pos.getX(i)).toFixed(6) +
      "," +
      round(pos.getY(i)).toFixed(6) +
      "," +
      round(pos.getZ(i)).toFixed(6);
    let arr = clusters.get(k);
    if (!arr) {
      arr = [];
      clusters.set(k, arr);
    }
    arr.push(i);
  }
  let merged = 0;
  for (const verts of clusters.values()) {
    if (verts.length < 2) continue;
    let ax = 0,
      ay = 0,
      az = 0;
    for (const v of verts) {
      ax += norm.getX(v);
      ay += norm.getY(v);
      az += norm.getZ(v);
    }
    const len = Math.hypot(ax, ay, az);
    if (len === 0) continue;
    ax /= len;
    ay /= len;
    az /= len;
    for (const v of verts) {
      norm.setXYZ(v, ax, ay, az);
    }
    merged++;
  }
  norm.needsUpdate = true;
  return { clusters: clusters.size, merged };
}

// TODO(daniel): confirm these handles. Defaulting to the same
// `danielrltan` slug used for GitHub/LinkedIn — adjust if X or
// Pinterest use a different username.
// NOTE: in the source GLB the node named "github" actually carries
// the LinkedIn icon material, and the node "linkedin" carries the
// GitHub icon — confirmed by walking child.material.name in the
// meshInfo probe. Swapping the URL mapping here is the right fix
// (re-naming nodes in Blender would also work but the user prefers
// to keep node names where they are). When the cap is clicked we
// look up its NODE name, so the URLs below pair node-name → URL the
// USER sees on the cap.
const SOCIAL_URLS: Record<string, string> = {
  github: "https://www.linkedin.com/in/danielrltan",
  linkedin: "https://github.com/danielrltan",
  x: "https://x.com/danielrltan",
  pinterest: "https://www.pinterest.com/danrlt",
};

const SOCIAL_KEYS = Object.keys(SOCIAL_URLS);

const HOVER_DIP = 0.095;
const PRESS_DIP = 0.19;
const PRESS_HOLD_MS = 110;
const PRESS_LERP_RATE = 18;

/** Dispatched whenever the keypad's hover state changes (over an
 *  interactive cap / dial / sidebtn). App.tsx listens and mirrors
 *  into the MoveableCursor `hot` state so the cursor reacts. */
function emitCursorHover(hot: boolean) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("keypad-cursor-hover", { detail: { hot } }),
  );
}

// Each click adds this much angular velocity (rad/s) to the dial.
// Velocity decays exponentially via DIAL_DAMP; rapid clicking
// accumulates, so the user can spin the dial increasingly fast by
// hammering on it.
const DIAL_KICK = Math.PI * 2 * 1.1;
// Slow decay so accumulated velocity persists long enough that a
// rapid click stack actually reaches "spinning hard" before fading.
// At 0.9, velocity halves every ~0.77s.
const DIAL_DAMP = 0.9;
// Hard cap so a determined spammer can't push velocity into the
// 'spinning so fast it looks frozen' territory.
const DIAL_MAX_VEL = Math.PI * 2 * 12; // 12 revs/sec ceiling

export interface KeypadModelApi {
  /** Add the given angular velocity (rad/s) to the dial. */
  kickDial: (radPerSec: number) => void;
}

interface CapState {
  obj: THREE.Object3D;
  baseY: number;
  pressT: number;
  hovered: boolean;
  pressedAt: number | null;
}

// Fit policy: model's bounding-sphere radius (rotation-invariant)
// should equal this fraction of the visible camera HALF-HEIGHT at
// world z=0. Picked empirically — bump down if it reads too tight,
// up to fill more of the frame. 0.92 puts the model nicely filling
// the laying-flat view without kissing canvas edges.
const TARGET_FILL_RATIO = 0.92;

interface KeypadModelProps {
  /** Called once at mount with an imperative API. Used by parent to
   *  trigger automatic dial-spins (e.g. on scroll drop-in). */
  onReady?: (api: KeypadModelApi) => void;
}

export function KeypadModel({ onReady }: KeypadModelProps = {}) {
  const { scene } = useGLTF("/keypad.glb");
  const { camera, size, gl } = useThree();

  // Clone + traverse synchronously so caps & dial are known before
  // the first render returns — hit-volume meshes need their world
  // positions on mount.
  const { cloned, recenterOffset, sphereRadius, caps, dial } = useMemo(() => {
    const cl = scene.clone(true);
    const capMap: Record<string, CapState> = {};
    let dialObj: THREE.Object3D | null = null;
    // Shading fix: force flatShading off and recompute vertex
    // normals on every mesh. Per the user's instruction this stays
    // STRICTLY at the geometry/normal level — no subdivision, no
    // UV-merging, no material/roughness/lighting changes. A previous
    // attempt at runtime smoothing interpolated UVs across cap
    // top/side seams and wrecked the icon decals; this version
    // touches only normals + material.flatShading flag and leaves
    // the indexed buffer + UVs untouched.
    cl.traverse((obj) => {
      const name = obj.name;
      if (SOCIAL_KEYS.includes(name)) {
        capMap[name] = {
          obj,
          baseY: obj.position.y,
          pressT: 0,
          hovered: false,
          pressedAt: null,
        };
      } else if (name === "knob") {
        // Dial / spinnable knob. Parent group containing both the
        // cylinder body and cat-face decal as child meshes — we
        // rotate the parent so both spin together. If the dial node
        // gets renamed again, console will warn and list available
        // node names (see warning block below).
        dialObj = obj;
      }
      const m = obj as THREE.Mesh;
      if (m.isMesh) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const maxAniso = gl.capabilities.getMaxAnisotropy();
        for (const mat of mats) {
          if (!mat) continue;
          const stdMat = mat as THREE.MeshStandardMaterial;
          stdMat.flatShading = false;
          // Anisotropic filtering on every texture map on the
          // material. Default anisotropy is 1, which makes textures
          // look fuzzy/dithered when sampled at oblique angles — the
          // icon decals on the cap top faces (which sit at ~32° to
          // the camera) hit this hardest. Max anisotropy on modern
          // GPUs is 16; samples the texture along the projected
          // direction, recovering sharp edges.
          const TEX_KEYS = [
            "map",
            "normalMap",
            "roughnessMap",
            "metalnessMap",
            "emissiveMap",
            "aoMap",
          ] as const;
          for (const key of TEX_KEYS) {
            const tex = stdMat[key] as THREE.Texture | null;
            if (!tex) continue;
            tex.anisotropy = maxAniso;
            tex.needsUpdate = true;
          }
          mat.needsUpdate = true;
        }
        // Normal averaging across position-shared vertices. Smooths
        // hard-shaded chamfer-subdivision boundaries (the GLB ships
        // face-normal-per-vertex on those) WITHOUT touching positions,
        // UVs, or the index buffer. Tried LoopSubdivision earlier on
        // non-textured meshes; it smoothed the brushed-metal body's
        // 90° hard edges into mirror-smooth curves, making the frame
        // read as chrome/glass instead of brushed metal. Reverted —
        // the chamfer normals averaging alone is what we want here.
        smoothNormalsAcrossSharedPositions(m.geometry);
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    if (Object.keys(capMap).length < SOCIAL_KEYS.length) {
      const missing = SOCIAL_KEYS.filter((k) => !capMap[k]);
      console.warn("[keypad] expected social keycap nodes missing:", missing);
    }
    if (!dialObj) {
      const names: string[] = [];
      cl.traverse((o) => {
        if (o.name) names.push(o.name);
      });
      console.warn(
        "[keypad] dial node 'knob' not found in GLB. Available nodes:",
        names,
      );
    }
    const box = new THREE.Box3().setFromObject(cl);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    return {
      cloned: cl,
      recenterOffset: center.clone().multiplyScalar(-1),
      sphereRadius: sphere.radius,
      caps: capMap,
      dial: dialObj as THREE.Object3D | null,
    };
  }, [scene]);

  // Camera-aware fit. Re-runs on resize so portrait/landscape both
  // get a sensible scale. Uses visible camera HEIGHT at world z=0
  // as the target dimension — height is the smaller dim on most
  // landscape canvases, so fitting the sphere to height-fraction
  // guarantees the model stays inside both axes.
  const fitScale = useMemo(() => {
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) return 1;
    const pc = camera as THREE.PerspectiveCamera;
    // Real cam→lookAt distance (the model centroid is at world
    // origin after recenterOffset). Using camera.position.z would be
    // wrong now that the camera is off-axis (above + in front).
    const distToTarget = pc.position.length();
    const visibleHalfHeight =
      Math.tan(THREE.MathUtils.degToRad(pc.fov / 2)) * distToTarget;
    // Clamp against width too — on portrait viewports the height
    // isn't the tighter axis.
    const visibleHalfWidth = visibleHalfHeight * (size.width / size.height);
    const tighter = Math.min(visibleHalfHeight, visibleHalfWidth);
    return (tighter * TARGET_FILL_RATIO) / sphereRadius;
  }, [camera, size.width, size.height, sphereRadius]);

  const capsRef = useRef(caps);
  capsRef.current = caps;
  const dialVelRef = useRef(0);

  // Expose imperative API for parent-driven dial kicks (e.g. spin
  // automatically when the drop-in animation completes).
  useEffect(() => {
    if (!onReady) return;
    onReady({
      kickDial: (rad) => {
        const next = dialVelRef.current + rad;
        dialVelRef.current = Math.min(next, DIAL_MAX_VEL);
      },
    });
  }, [onReady]);

  useFrame((_, dt) => {
    const map = capsRef.current;
    const now = performance.now();
    const k = 1 - Math.exp(-dt * PRESS_LERP_RATE);
    for (const name in map) {
      const c = map[name]!;
      let target = c.hovered ? 0.45 : 0;
      if (c.pressedAt != null && now - c.pressedAt < PRESS_HOLD_MS) {
        target = 1;
      }
      c.pressT += (target - c.pressT) * k;
      // Map pressT [0..0.45..1] → dip [0..HOVER_DIP..PRESS_DIP] piecewise.
      let dip: number;
      if (c.pressT <= 0.45) {
        dip = (c.pressT / 0.45) * HOVER_DIP;
      } else {
        const t = (c.pressT - 0.45) / 0.55;
        dip = HOVER_DIP + t * (PRESS_DIP - HOVER_DIP);
      }
      c.obj.position.y = c.baseY - dip;
    }

    if (dial && Math.abs(dialVelRef.current) > 1e-4) {
      dial.rotation.y += dialVelRef.current * dt;
      dialVelRef.current *= Math.exp(-dt * DIAL_DAMP);
    }
  });

  // Site uses `cursor: none` globally + a custom MoveableCursor ring;
  // setting document.body.style.cursor here would be overridden.
  // Every interactive element fires a `keypad-cursor-hover` window
  // CustomEvent so App.tsx can flip the MoveableCursor `hot` state.
  const handleCapEnter = (name: string) => (e: any) => {
    e.stopPropagation();
    const c = capsRef.current[name];
    if (c) c.hovered = true;
    emitCursorHover(true);
  };
  const handleCapLeave = (name: string) => (e: any) => {
    e.stopPropagation();
    const c = capsRef.current[name];
    if (c) c.hovered = false;
    emitCursorHover(false);
  };
  const handleCapClick = (name: string) => (e: any) => {
    e.stopPropagation();
    const c = capsRef.current[name];
    if (c) c.pressedAt = performance.now();
    const url = SOCIAL_URLS[name];
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };
  const handleDialEnter = (e: any) => {
    e.stopPropagation();
    emitCursorHover(true);
  };
  const handleDialLeave = (e: any) => {
    e.stopPropagation();
    emitCursorHover(false);
  };
  const handleDialClick = (e: any) => {
    e.stopPropagation();
    // Accumulate velocity — each click ADDS to the existing spin,
    // so rapid clicks let the dial reach high speeds while a single
    // click is a gentle nudge. Clamp to ceiling so we don't end up
    // with a strobing dial that visually freezes.
    const next = dialVelRef.current + DIAL_KICK;
    dialVelRef.current = Math.min(next, DIAL_MAX_VEL);
  };

  // Two-level grouping: outer scales the whole keypad to fit the
  // camera frame, inner translates so the (already-scaled) centroid
  // lands at origin. Hit volumes live inside the inner group so
  // their positions are in the same local frame as the cloned model.
  return (
    <group scale={fitScale}>
      <group position={recenterOffset}>
        <primitive object={cloned} />
        {SOCIAL_KEYS.map((name) => {
          const cap = caps[name];
          if (!cap) return null;
          return (
            <mesh
              key={name}
              position={[
                cap.obj.position.x,
                cap.obj.position.y,
                cap.obj.position.z,
              ]}
              onPointerOver={handleCapEnter(name)}
              onPointerOut={handleCapLeave(name)}
              onClick={handleCapClick(name)}
            >
              <boxGeometry args={[0.55, 0.4, 0.55]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          );
        })}
        {dial && (
          <mesh
            position={[dial.position.x, dial.position.y, dial.position.z]}
            onPointerOver={handleDialEnter}
            onPointerOut={handleDialLeave}
            onClick={handleDialClick}
          >
            {/* Hit volume sized generously around the actual knob
                mesh so clicks consistently register. Cylinder axis
                is +Y, matching the knob's vertical rotational axis. */}
            <cylinderGeometry args={[1.1, 1.1, 1.5, 24]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        )}
      </group>
    </group>
  );
}
