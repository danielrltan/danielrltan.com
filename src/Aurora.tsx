import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Fullscreen warm aurora rendered as the first thing in the R3F scene
 * tree. A unit plane drawn at NDC z=1 (far plane) with a simplex-noise
 * fragment shader that warps toward the pointer. Reads as "daylight
 * following you" — gives the cream wrapper subtle motion without
 * pulling focus from the room.
 *
 * Renders with `depthTest: false` and `renderOrder: -1` so opaque scene
 * meshes (the loading cover, the room itself) overdraw it cleanly.
 */
const AURORA_BASE = new THREE.Color("#f0e6d6");
const AURORA_WARM = new THREE.Color("#e8c298");
const AURORA_GLOW = new THREE.Color("#f8d8a8");

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Geometry is a unit plane (args [2, 2]) in [-1, 1] xy → already in
    // NDC; force clip-space z=1 so the quad sits at the far plane.
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec2 uMouse;          // 0..1 in screen UV
  uniform float uAspect;        // width / height
  uniform vec3 uBase;
  uniform vec3 uWarm;
  uniform vec3 uGlow;

  // Simplex 2D noise — Ashima Arts / Stefan Gustavson, MIT.
  vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  // Cheap two-octave fbm for the aurora streaks.
  float fbm(vec2 p) {
    float a = snoise(p) * 0.5 + 0.5;
    float b = snoise(p * 2.0 + 17.3) * 0.25;
    return a + b;
  }

  void main() {
    // Aspect-correct UV so noise cells stay square and mouse distance
    // reads in screen-uniform units rather than stretched by viewport.
    vec2 uv = vUv;
    uv.x *= uAspect;
    vec2 mouseUv = uMouse;
    mouseUv.x *= uAspect;

    // Drift the noise field slowly over time. Two layers at different
    // scales + offsets sum into the aurora streaks.
    float t = uTime * 0.04;
    vec2 q = uv * 1.8 + vec2(t, t * 0.6);
    float n = fbm(q);

    // Hot spot lerps toward the mouse with a soft falloff. Larger
    // radius (0.55) means the spot is generous — feels like ambient
    // daylight rather than a flashlight cone.
    float d = distance(uv, mouseUv);
    float spot = smoothstep(0.55, 0.0, d);

    // Mix the cream base toward the warm midtone using the noise field,
    // then add the bright glow color weighted by the mouse spotlight.
    vec3 col = mix(uBase, uWarm, n * 0.55);
    col = mix(col, uGlow, spot * (0.20 + n * 0.18));

    // Vignette pulls the corners back toward base so the spotlight
    // reads stronger relative to the surround.
    vec2 c = vUv - 0.5;
    float vig = 1.0 - smoothstep(0.55, 0.95, length(c));
    col = mix(uBase, col, mix(0.7, 1.0, vig));

    gl_FragColor = vec4(col, 1.0);
  }
`;

interface Props {
  /** 0..1 — opacity. Set to 0 during loading so the cover dome shows
   *  pure cream, fades to 1 alongside the climax. */
  opacity?: number;
}

export function Aurora({ opacity = 1 }: Props) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const { size } = useThree();

  // Pointer in screen-UV (0..1, origin bottom-left to match shader vUv).
  // R3F's `mouse` is NDC -1..1; we track via direct window listener so
  // the aurora keeps responding while drei `<Html>` portals intercept
  // R3F's own pointer plumbing.
  const mouseUvRef = useRef(new THREE.Vector2(0.5, 0.5));

  // Window-level pointer tracking.
  useMemo(() => {
    if (typeof window === "undefined") return;
    const onMove = (e: PointerEvent) => {
      mouseUvRef.current.x = e.clientX / window.innerWidth;
      mouseUvRef.current.y = 1 - e.clientY / window.innerHeight;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    // No cleanup — this component lives for the page's lifetime.
  }, []);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: size.width / Math.max(1, size.height) },
      uBase: { value: AURORA_BASE.clone() },
      uWarm: { value: AURORA_WARM.clone() },
      uGlow: { value: AURORA_GLOW.clone() },
    }),
    // size.width/height intentionally NOT in deps — we update uAspect
    // in useFrame instead, so a resize doesn't rebuild the uniforms
    // object (which would re-create the material).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Smooth the pointer with a critically-damped lerp so the spotlight
  // reads as heavy / intentional rather than chasing the cursor 1:1.
  const smoothMouse = useRef(new THREE.Vector2(0.5, 0.5));

  useFrame((_, dt) => {
    if (!matRef.current) return;
    const lerpRate = 1 - Math.exp(-dt * 4); // ~4 Hz response
    smoothMouse.current.lerp(mouseUvRef.current, lerpRate);
    matRef.current.uniforms.uMouse.value.copy(smoothMouse.current);
    matRef.current.uniforms.uTime.value += dt;
    matRef.current.uniforms.uAspect.value =
      size.width / Math.max(1, size.height);
    matRef.current.opacity = opacity;
  });

  return (
    <mesh frustumCulled={false} renderOrder={-1}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        // Opaque + depthTest:true with the vertex shader pinning the
        // quad to NDC z=1 (the far plane). Aurora sits behind everything
        // via natural depth: any opaque scene mesh draws on top. A
        // `transparent:true` material would land in the transparent
        // pass AFTER opaque meshes and would draw OVER the room.
        transparent={false}
        depthTest={true}
        depthWrite={false}
      />
    </mesh>
  );
}
