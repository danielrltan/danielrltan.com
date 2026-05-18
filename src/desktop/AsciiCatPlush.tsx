import { useEffect, useRef } from "react";
import * as THREE from "three";
import { AsciiEffect, DRACOLoader, GLTFLoader } from "three-stdlib";

interface Props {
  /** CSS pixel size of the square widget (denser char grid at larger sizes). */
  size?: number;
  /** ASCII char colour. CSS color string. */
  color?: string;
  /** Background behind the chars. Transparent by default. */
  background?: string;
  /** Idle rotation speed in rad/sec. */
  rpm?: number;
  /** Which axis (or axes) the model spins around. Default 'y'. */
  axis?: "x" | "y" | "both";
}

/**
 * 3D cat plush from the room GLB, rendered as ASCII text via
 * `AsciiEffect`. Vanilla three.js (not R3F) because the effect wraps the
 * renderer and emits a DOM `<table>`, incompatible with R3F's render
 * loop. The room.glb is HTTP-cached by the time this mounts (the main
 * scene loaded it first), so the only cost here is a one-time parse —
 * well within the boot sequence's 3-second window.
 */
export function AsciiCatPlush({
  size = 220,
  color = "#ff7842",
  background = "transparent",
  rpm = 0.9,
  axis = "y",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
    camera.position.set(0, 0.35, 2.4);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size);

    // `invert: false` — bright pixels (the lit cat) → densest chars,
    // black background → spaces. `invert: true` painted a solid orange
    // box around the cat instead.
    const effect = new AsciiEffect(renderer, " .:-=+*#%@", {
      invert: false,
      resolution: 0.18,
    });
    effect.setSize(size, size);

    const el = effect.domElement;
    el.style.color = color;
    el.style.backgroundColor = background;
    el.style.fontFamily = "var(--font-mono)";
    el.style.fontSize = "7px";
    el.style.lineHeight = "7px";
    el.style.letterSpacing = "0";
    el.style.userSelect = "none";
    el.style.pointerEvents = "none";
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.display = "flex";
    el.style.alignItems = "center";
    el.style.justifyContent = "center";

    container.appendChild(el);

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1.5, 2, 1.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.6);
    rim.position.set(-1.5, 1, -1);
    scene.add(rim);

    let pivot: THREE.Group | null = null;
    let disposed = false;

    // room.glb is Draco-compressed (KHR_draco_mesh_compression). The
    // GLTFLoader needs a DRACOLoader bound to it before .load() or the
    // mesh data comes back empty. gstatic ships the wasm decoder.
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
    );
    loader.setDRACOLoader(draco);

    loader.load(
      "/room.glb",
      (gltf) => {
        if (disposed) return;
        const cat = gltf.scene.getObjectByName("th_cat_plush");
        if (!cat) return;
        const box = new THREE.Box3().setFromObject(cat);
        const center = box.getCenter(new THREE.Vector3());
        const dims = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(dims.x, dims.y, dims.z);
        const scale = 1.3 / maxDim;
        pivot = new THREE.Group();
        cat.position.sub(center);
        // Manual nudge so the rotation pivot sits on the visual body
        // and the bbox-extending tail is effectively ignored. Tune
        // here if the body still orbits off-centre — values are in
        // model units (post-centering, pre-scale).
        const TAIL_OFFSET_X = -.012;
        const TAIL_OFFSET_Y = 0.0;
        const TAIL_OFFSET_Z = 0.0;
        cat.position.x += TAIL_OFFSET_X;
        cat.position.y += TAIL_OFFSET_Y;
        cat.position.z += TAIL_OFFSET_Z;
        cat.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh)
            m.material = new THREE.MeshStandardMaterial({
              color: 0xc8b89a,
              roughness: 0.8,
              metalness: 0,
            });
        });
        pivot.add(cat);
        pivot.scale.setScalar(scale);
        scene.add(pivot);
      },
      undefined,
      () => {
        /* asset miss — leave the ASCII view empty rather than throw */
      },
    );

    let rafId = 0;
    let last = performance.now();
    const animate = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (pivot) {
        // Explicitly pin the un-selected axes to 0 each frame so any
        // initial rotation from the GLB or accumulated drift never
        // leaks into the visual.
        if (axis === "x") {
          pivot.rotation.y = 0;
          pivot.rotation.z = 0;
          pivot.rotation.x += rpm * dt;
        } else if (axis === "y") {
          pivot.rotation.x = 0;
          pivot.rotation.z = 0;
          pivot.rotation.y += rpm * dt;
        } else {
          // both
          pivot.rotation.z = 0;
          pivot.rotation.x += rpm * dt;
          pivot.rotation.y += rpm * dt;
        }
      }
      effect.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      if (el.parentNode === container) container.removeChild(el);
      renderer.dispose();
    };
  }, [size, color, background, rpm, axis]);

  return (
    <div
      ref={containerRef}
      style={{
        width: size,
        height: size,
        position: "relative",
        overflow: "hidden",
      }}
    />
  );
}
