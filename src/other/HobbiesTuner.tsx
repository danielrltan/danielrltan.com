/**
 * ============================================================================
 *  HOBBIES OBJECT TUNER  —  DISPOSABLE DEV TOOL  (activate with ?tune=other)
 * ============================================================================
 *  Lets you dial in size / rotation / position for every object in the "Some
 *  interests" cluster, for BOTH the desktop (LAYOUT) and mobile (POS_PORTRAIT)
 *  arrangements, then copy the result back into HobbiesScene.tsx.
 *
 *  HOW TO USE
 *    - Open the Play section with ?tune=other in the URL.
 *    - Click an object (or pick it from the list). Drag the gizmo, or type exact
 *      numbers in the panel. R / T / G switch Rotate / Translate / Scale.
 *    - Toggle Desktop / Mobile to edit the other arrangement (edits are kept).
 *    - "Copy desktop LAYOUT" / "Copy mobile POS_PORTRAIT" → paste back into
 *      HobbiesScene.tsx.
 *
 *  THIS WHOLE FILE IS THROWAWAY. When the orientations are final, delete it +
 *  the lazy import/branch in Other.tsx. The only thing that stays is the tuned
 *  values you pasted into LAYOUT / POS_PORTRAIT (and the `rot` field, which the
 *  live scene already reads). No tuner code ships to normal visitors — it is
 *  lazy-imported only when ?tune=other is present.
 * ============================================================================
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, TransformControls } from "@react-three/drei";
import * as THREE from "three";
import {
  HOBBIES,
  LAYOUT,
  resolveTransform,
  normalizeHobbyScene,
  useHobbyScenes,
  CLUSTER_HALF_W_PORTRAIT,
  CLUSTER_HALF_H_PORTRAIT,
  CAM_LOOK_Y_PORTRAIT,
  VFOV_DEG,
  camDistanceForAspect,
  desktopFraming,
} from "./HobbiesScene";

type Arrangement = "desktop" | "mobile";
type Mode = "translate" | "rotate" | "scale";
type Vec3 = [number, number, number];
interface ObjXform {
  pos: Vec3;
  scale: number;
  rot: Vec3; // radians
}
type Store = Record<string, ObjXform>;

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const deg = (rad: number) => Math.round((rad * 180) / Math.PI);
const rad = (d: number) => (d * Math.PI) / 180;

function freshStore(mobile: boolean): Store {
  const s: Store = {};
  for (const h of HOBBIES) {
    const t = resolveTransform(h.id, mobile);
    s[h.id] = { pos: [...t.pos], scale: t.scale, rot: [...t.rot] };
  }
  return s;
}

// ---------------------------------------------------------------------------
// One tunable object: renders the normalized GLB at the store transform.
// ---------------------------------------------------------------------------
function TunerObject({
  id,
  scene,
  xform,
  selected,
  onSelect,
  registerRef,
}: {
  id: string;
  scene: THREE.Group | null;
  xform: ObjXform;
  selected: boolean;
  onSelect: (id: string) => void;
  registerRef: (id: string, g: THREE.Group | null) => void;
}) {
  const normalized = useMemo(
    () => (scene ? normalizeHobbyScene(scene) : null),
    [scene],
  );
  return (
    <group
      ref={(g) => registerRef(id, g)}
      position={xform.pos}
      rotation={xform.rot}
      scale={xform.scale}
      onPointerDown={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onSelect(id);
      }}
    >
      {normalized ? (
        <primitive object={normalized} />
      ) : (
        <mesh>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshStandardMaterial color={selected ? "#ff4f00" : "#888"} wireframe />
        </mesh>
      )}
      {/* selection halo */}
      {selected && (
        <mesh scale={1.0}>
          <sphereGeometry args={[0.42, 16, 12]} />
          <meshBasicMaterial color="#ff4f00" wireframe transparent opacity={0.35} />
        </mesh>
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------
// Camera rig: frame the cluster exactly like the live section does, per
// arrangement. Re-runs on arrangement change + "reset view".
// ---------------------------------------------------------------------------
function CameraRig({
  arrangement,
  resetKey,
  orbit,
}: {
  arrangement: Arrangement;
  resetKey: number;
  orbit: React.MutableRefObject<{ target: THREE.Vector3; update: () => void } | null>;
}) {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.height > 0 ? size.width / size.height : 1;
    const mobile = arrangement === "mobile";
    // Match the LIVE scene's framing exactly so tuned positions land where they
    // ship: portrait fits the tall cluster; desktop parks it low (top band for the
    // wordmark — desktopFraming). The wordmark itself isn't drawn in the tuner, so
    // the reserved top band reads as empty headroom: don't tune objects into it.
    const lookY = mobile ? CAM_LOOK_Y_PORTRAIT : desktopFraming(aspect).lookY;
    const dist = mobile
      ? camDistanceForAspect(aspect, CLUSTER_HALF_W_PORTRAIT, CLUSTER_HALF_H_PORTRAIT)
      : desktopFraming(aspect).dist;
    camera.position.set(0, lookY, dist);
    camera.lookAt(0, lookY, 0);
    (camera as THREE.PerspectiveCamera).fov = VFOV_DEG;
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    if (orbit.current) {
      orbit.current.target.set(0, lookY, 0);
      orbit.current.update();
    }
  }, [arrangement, resetKey, size.width, size.height, camera, orbit]);
  return null;
}

// ---------------------------------------------------------------------------
// In-canvas scene: lights + objects + the gizmo on the selected object.
// ---------------------------------------------------------------------------
function TunerScene({
  arrangement,
  store,
  loaded,
  selectedId,
  mode,
  onSelect,
  registerRef,
  selObj,
  onGizmoChange,
  resetKey,
}: {
  arrangement: Arrangement;
  store: Store;
  loaded: Record<string, THREE.Group | null>;
  selectedId: string | null;
  mode: Mode;
  onSelect: (id: string) => void;
  registerRef: (id: string, g: THREE.Group | null) => void;
  selObj: THREE.Object3D | null;
  onGizmoChange: () => void;
  resetKey: number;
}) {
  const orbit = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  return (
    <>
      <ambientLight intensity={0.5} color="#eef1f4" />
      <directionalLight position={[4, 6, 4]} intensity={2.7} color="#ffffff" />
      <directionalLight position={[-5, 3, 2]} intensity={0.8} color="#d7dde3" />
      <directionalLight position={[-2, -1, -5]} intensity={1.1} color="#ff4f00" />
      <directionalLight position={[3, -4, 2]} intensity={0.35} color="#ff6a2a" />

      {HOBBIES.map((h) => (
        <TunerObject
          key={arrangement + ":" + h.id}
          id={h.id}
          scene={loaded[h.id] ?? null}
          xform={store[h.id]}
          selected={selectedId === h.id}
          onSelect={onSelect}
          registerRef={registerRef}
        />
      ))}

      {/* @ts-expect-error drei ref shape */}
      <OrbitControls ref={orbit} makeDefault enableDamping={false} />
      <CameraRig arrangement={arrangement} resetKey={resetKey} orbit={orbit} />

      {selObj && selObj.parent && (
        <TransformControls object={selObj} mode={mode} onObjectChange={onGizmoChange} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Numeric row (label + 3 inputs, or 1 input for scale).
// ---------------------------------------------------------------------------
function NumRow({
  label,
  values,
  step,
  onChange,
}: {
  label: string;
  values: number[];
  step: number;
  onChange: (i: number, v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
      <span style={{ width: 34, color: "#9aa3ad", fontSize: 11 }}>{label}</span>
      {values.map((v, i) => (
        <input
          key={i}
          type="number"
          step={step}
          value={Number.isFinite(v) ? v : 0}
          onChange={(e) => onChange(i, parseFloat(e.target.value))}
          style={{
            width: 60,
            background: "#0d0e10",
            color: "#fff",
            border: "1px solid #333",
            borderRadius: 0,
            padding: "3px 5px",
            fontSize: 11,
            fontFamily: "monospace",
          }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The tuner.
// ---------------------------------------------------------------------------
export function HobbiesTuner() {
  const loaded = useHobbyScenes();
  const [arrangement, setArrangement] = useState<Arrangement>("desktop");
  const [mode, setMode] = useState<Mode>("translate");
  const [selectedId, setSelectedId] = useState<string | null>(HOBBIES[0]!.id);
  const [resetKey, setResetKey] = useState(0);
  // bump to force the panel to re-read the live transform (numbers).
  const [, forcePanel] = useState(0);
  const [copied, setCopied] = useState("");

  // Editable transforms PER arrangement (the export source of truth). Held in a
  // ref so gizmo drags never re-render the canvas tree; the live object groups
  // are mutated directly and read back here on change.
  const stores = useRef<Record<Arrangement, Store>>({
    desktop: freshStore(false),
    mobile: freshStore(true),
  });
  const objRefs = useRef<Record<string, THREE.Group | null>>({});
  // The Object3D the gizmo is attached to. STATE (not a ref) so the gizmo only
  // mounts once its object is actually in the scene graph — switching arrangement
  // remounts the objects, and attaching TransformControls to a detached group
  // throws "must be a part of the scene graph".
  const [selObj, setSelObj] = useState<THREE.Object3D | null>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;

  const store = stores.current[arrangement];

  // Stable (no deps) so changing selection doesn't re-fire every object's ref.
  const registerRef = useCallback((id: string, g: THREE.Group | null) => {
    objRefs.current[id] = g;
    if (id === selectedIdRef.current) setSelObj(g);
  }, []);

  // Point the gizmo at the selected group when selection (or arrangement) changes
  // and the group is already mounted.
  useEffect(() => {
    setSelObj(selectedId ? objRefs.current[selectedId] ?? null : null);
    forcePanel((n) => n + 1);
  }, [selectedId, arrangement]);

  // Read the live selected group's transform back into the store + refresh panel.
  const onGizmoChange = useCallback(() => {
    const g = selObj;
    if (!g || !selectedId) return;
    const x = store[selectedId];
    x.pos = [r3(g.position.x), r3(g.position.y), r3(g.position.z)];
    x.rot = [r3(g.rotation.x), r3(g.rotation.y), r3(g.rotation.z)];
    x.scale = r3((g.scale.x + g.scale.y + g.scale.z) / 3);
    forcePanel((n) => n + 1);
  }, [selectedId, store, selObj]);

  // Apply a numeric edit from the panel to the store AND the live group.
  const applyEdit = useCallback(
    (field: "pos" | "rot" | "scale", i: number, v: number) => {
      if (!selectedId || Number.isNaN(v)) return;
      const x = store[selectedId];
      const g = objRefs.current[selectedId];
      if (field === "scale") {
        x.scale = v;
        g?.scale.setScalar(v);
      } else if (field === "pos") {
        x.pos[i] = v;
        if (g) g.position.fromArray(x.pos);
      } else {
        // input is in degrees → store radians
        x.rot[i] = rad(v);
        if (g) g.rotation.set(x.rot[0], x.rot[1], x.rot[2]);
      }
      forcePanel((n) => n + 1);
    },
    [selectedId, store],
  );

  // R / T / G shortcuts (Blender-style). Ignore when typing in an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "r" || e.key === "R") setMode("rotate");
      else if (e.key === "t" || e.key === "T") setMode("translate");
      else if (e.key === "g" || e.key === "G") setMode("scale");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Serialize the active arrangement to paste-ready TypeScript.
  const exportCode = useCallback(
    (arr: Arrangement) => {
      const s = stores.current[arr];
      const f = (n: number) => {
        const x = r3(n);
        const str = x.toFixed(2).replace(/\.?0+$/, "");
        return (x >= 0 ? " " : "") + (str === "" || str === "-" ? "0" : str);
      };
      const lines: string[] = [];
      if (arr === "desktop") {
        lines.push("// paste into LAYOUT in HobbiesScene.tsx (keep radius/placeholder/tone)");
        for (const h of HOBBIES) {
          const x = s[h.id];
          const L = LAYOUT[h.id]!;
          lines.push(
            `  ${(h.id + ":").padEnd(9)} { pos: [${f(x.pos[0])}, ${f(x.pos[1])}, ${f(x.pos[2])}], ` +
              `scale: ${x.scale.toFixed(2)}, rot: [${f(x.rot[0])}, ${f(x.rot[1])}, ${f(x.rot[2])}], ` +
              `radius: ${L.radius}, placeholder: "${L.placeholder}", tone: "${L.tone}" },`,
          );
        }
      } else {
        lines.push("// paste into POS_PORTRAIT in HobbiesScene.tsx");
        for (const h of HOBBIES) {
          const x = s[h.id];
          const L = LAYOUT[h.id]!;
          // only emit scale/rot when they differ from desktop (keep it lean)
          const parts = [`pos: [${f(x.pos[0])}, ${f(x.pos[1])}, ${f(x.pos[2])}]`];
          if (Math.abs(x.scale - L.scale) > 0.001) parts.push(`scale: ${x.scale.toFixed(2)}`);
          if (x.rot.some((rv, i) => Math.abs(rv - L.rot[i]) > 0.001))
            parts.push(`rot: [${f(x.rot[0])}, ${f(x.rot[1])}, ${f(x.rot[2])}]`);
          lines.push(`  ${(h.id + ":").padEnd(9)} { ${parts.join(", ")} },`);
        }
      }
      const code = lines.join("\n");
      navigator.clipboard?.writeText(code);
      setCopied(arr);
      window.setTimeout(() => setCopied(""), 1400);
      // also log so it's recoverable if clipboard is blocked
      console.log(`[HobbiesTuner] ${arr} export:\n${code}`);
    },
    [],
  );

  const sel = selectedId ? store[selectedId] : null;
  const mobile = arrangement === "mobile";

  // Mobile mode clamps the canvas to a phone aspect so framing is accurate.
  const canvasBox: React.CSSProperties = mobile
    ? { width: "min(46vh, 420px)", aspectRatio: "390 / 844", margin: "0 auto" }
    : { width: "100%", height: "100%" };

  const btn = (active: boolean): React.CSSProperties => ({
    background: active ? "#ff4f00" : "#1a1c1f",
    color: active ? "#0d0e10" : "#cfd4da",
    border: "1px solid #333",
    borderRadius: 0,
    padding: "5px 9px",
    fontSize: 11,
    fontFamily: "monospace",
    cursor: "pointer",
    fontWeight: 600,
  });

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 40 }}>
      {/* canvas (phone-clamped in mobile mode, centered on a dark stage) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: mobile ? "#16181b" : "transparent",
        }}
      >
        <div style={{ ...canvasBox, position: "relative" }}>
          <Canvas
            camera={{ position: [0, 0, 6], fov: VFOV_DEG, near: 0.1, far: 50 }}
            dpr={[1, 1.5]}
            gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
            onPointerMissed={() => setSelectedId(null)}
          >
            <TunerScene
              arrangement={arrangement}
              store={store}
              loaded={loaded}
              selectedId={selectedId}
              mode={mode}
              onSelect={setSelectedId}
              registerRef={registerRef}
              selObj={selObj}
              onGizmoChange={onGizmoChange}
              resetKey={resetKey}
            />
          </Canvas>
        </div>
      </div>

      {/* control panel */}
      <div
        style={{
          position: "absolute",
          top: 84,
          right: 16,
          width: 278,
          maxHeight: "calc(100vh - 100px)",
          overflow: "auto",
          background: "rgba(13,14,16,0.92)",
          backdropFilter: "blur(8px)",
          border: "1px solid #333",
          color: "#e7eaee",
          font: "12px/1.4 monospace",
          padding: 12,
          zIndex: 41,
        }}
      >
        <div style={{ fontWeight: 700, letterSpacing: "0.12em", color: "#ff4f00", marginBottom: 10 }}>
          HOBBIES TUNER
        </div>

        {/* arrangement toggle */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <button
            style={{ ...btn(!mobile), flex: 1 }}
            onClick={() => {
              setSelObj(null);
              setArrangement("desktop");
            }}
          >
            Desktop
          </button>
          <button
            style={{ ...btn(mobile), flex: 1 }}
            onClick={() => {
              setSelObj(null);
              setArrangement("mobile");
            }}
          >
            Mobile
          </button>
        </div>

        {/* object list */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginBottom: 10 }}>
          {HOBBIES.map((h) => (
            <button
              key={h.id}
              style={{ ...btn(selectedId === h.id), textAlign: "left", overflow: "hidden", whiteSpace: "nowrap" }}
              onClick={() => setSelectedId(h.id)}
              title={h.label}
            >
              {h.label}
            </button>
          ))}
        </div>

        {/* mode */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <button style={{ ...btn(mode === "translate"), flex: 1 }} onClick={() => setMode("translate")}>
            Move (T)
          </button>
          <button style={{ ...btn(mode === "rotate"), flex: 1 }} onClick={() => setMode("rotate")}>
            Rotate (R)
          </button>
          <button style={{ ...btn(mode === "scale"), flex: 1 }} onClick={() => setMode("scale")}>
            Scale (G)
          </button>
        </div>

        {/* numeric editors */}
        {sel ? (
          <div style={{ borderTop: "1px solid #333", paddingTop: 8, marginBottom: 8 }}>
            <div style={{ color: "#ff4f00", marginBottom: 6, fontWeight: 600 }}>
              {HOBBIES.find((h) => h.id === selectedId)?.label}
            </div>
            <NumRow
              label="pos"
              step={0.02}
              values={sel.pos.map(r3)}
              onChange={(i, v) => applyEdit("pos", i, v)}
            />
            <NumRow
              label="rot°"
              step={1}
              values={sel.rot.map(deg)}
              onChange={(i, v) => applyEdit("rot", i, v)}
            />
            <NumRow
              label="scale"
              step={0.02}
              values={[r3(sel.scale)]}
              onChange={(_, v) => applyEdit("scale", 0, v)}
            />
          </div>
        ) : (
          <div style={{ color: "#9aa3ad", marginBottom: 8 }}>Click an object to select it.</div>
        )}

        {/* view + export */}
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <button style={{ ...btn(false), flex: 1 }} onClick={() => setResetKey((n) => n + 1)}>
            Reset view
          </button>
        </div>
        <button
          style={{ ...btn(copied === "desktop"), width: "100%", marginBottom: 6 }}
          onClick={() => exportCode("desktop")}
        >
          {copied === "desktop" ? "Copied ✓" : "Copy desktop LAYOUT"}
        </button>
        <button
          style={{ ...btn(copied === "mobile"), width: "100%" }}
          onClick={() => exportCode("mobile")}
        >
          {copied === "mobile" ? "Copied ✓" : "Copy mobile POS_PORTRAIT"}
        </button>

        <div style={{ color: "#6b727a", marginTop: 10, fontSize: 10 }}>
          click object or list to select · drag gizmo or type values · R/T/G switch
          mode · drag empty space = orbit
        </div>
      </div>
    </div>
  );
}

export default HobbiesTuner;
