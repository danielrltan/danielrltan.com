import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Screen-space "spacetime ripple" post-process for the keypad scene.
 *
 * WHY a post-process and not a backdrop effect: earlier versions painted
 * an expanding ring INTO the rice backdrop, which always read as a flat
 * elliptical gradient (the user's repeated "cheap" call). This instead
 * renders the WHOLE scene (backdrop + 3D keypad + screen text) to an
 * offscreen buffer, then a fullscreen pass REFRACTS the entire viewport
 * along expanding concentric rings - so a press visibly warps the keypad
 * itself, the grains, and the screen, like a shockwave through the
 * medium. Nothing is "drawn"; existing pixels are bent.
 *
 * Pipeline (this component OWNS the render loop via a priority-1
 * useFrame; mounting it disables R3F's auto-render):
 *   PASS 1: scene -> linear FBO (no tone map / no encode; three skips
 *           both when the target is a render target).
 *   PASS 2: fullscreen quad -> canvas. Samples the FBO at ripple-
 *           displaced UVs, applies ACES tone mapping + sRGB encode
 *           inline (reproducing the canvas's gl pipeline exactly), with
 *           a touch of chromatic split + caustic lift at each wavefront
 *           for a refractive, glassy read.
 *
 * Reduced motion: KeypadScene never stamps pulses under
 * prefers-reduced-motion, so the displacement stays zero and this
 * degrades to a transparent 1:1 blit.
 */

// Concurrent ripple slots. Rapid presses each take their OWN slot
// (round-robin), so an in-flight wave always completes instead of
// restarting from the middle on spam clicks. 5 slots x ~1.2s life means
// stealing a live slot needs sustained >4 clicks/s, and the stolen slot
// is always the oldest/most-faded one.
export const PULSE_SLOTS = 5;

/** One ripple: start = performance.now() stamp (-1 = idle), origin in
 *  canvas UV (0..1, Y-down to match the cursor convention). */
export interface Pulse {
  start: number;
  strength: number;
  x: number;
  y: number;
}

export interface PulseChannel {
  slots: Pulse[];
  next: number;
  lastAt: number;
}

export function createPulseChannel(): PulseChannel {
  return {
    slots: Array.from({ length: PULSE_SLOTS }, () => ({
      start: -1,
      strength: 0,
      x: 0.5,
      y: 0.5,
    })),
    next: 0,
    lastAt: 0,
  };
}

/** Stamp a new ripple into the next slot (round-robin). Presses within
 *  70ms collapse into one wave: a single gesture can emit pointer +
 *  synthetic events back-to-back, and two waves born a frame apart read
 *  as a glitch, not as two ripples. */
export function stampPulse(
  ch: PulseChannel,
  strength: number,
  x: number,
  y: number,
) {
  const now = performance.now();
  if (now - ch.lastAt < 70) return;
  ch.lastAt = now;
  const slot = ch.slots[ch.next]!;
  slot.start = now;
  slot.strength = strength;
  slot.x = x;
  slot.y = y;
  ch.next = (ch.next + 1) % PULSE_SLOTS;
}

// Seconds a ripple lives before its slot frees. Long, because the wave
// now expands slowly and fades gently (fluid, not snappy).
const PULSE_LIFE = 2.6;

const POST_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const POST_FRAG = /* glsl */ `
  #define N ${PULSE_SLOTS}
  precision highp float;
  uniform sampler2D uScene;
  uniform vec2 uResolution;      // drawing-buffer px (for aspect)
  uniform vec3 uPulses[N];       // x = age (s, <0 idle), yz = origin UV (Y-down)
  uniform float uPulseStr[N];
  uniform float uToneExposure;
  varying vec2 vUv;

  // three.js ACESFilmicToneMapping, inlined (the scene's gl pipeline is
  // ACES @ exposure 1.05; pass 1 renders to an FBO so three applies
  // neither tone map nor encode, we reproduce both here).
  vec3 RRTAndODTFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 ACESFilmic(vec3 color) {
    const mat3 ACESInputMat = mat3(
      0.59719, 0.07600, 0.02840,
      0.35458, 0.90834, 0.13383,
      0.04823, 0.01566, 0.83777
    );
    const mat3 ACESOutputMat = mat3(
      1.60475, -0.10208, -0.00327,
      -0.53108, 1.10813, -0.07276,
      -0.07367, -0.00605, 1.07602
    );
    color *= uToneExposure / 0.6;
    color = ACESInputMat * color;
    color = RRTAndODTFit(color);
    color = ACESOutputMat * color;
    return clamp(color, 0.0, 1.0);
  }
  vec3 lin2srgb(vec3 c) {
    vec3 lo = c * 12.92;
    vec3 hi = 1.055 * pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.4)) - 0.055;
    return mix(lo, hi, step(0.0031308, c));
  }

  void main() {
    float aspect = uResolution.x / max(uResolution.y, 1.0);

    // Accumulate the radial displacement contributed by every live
    // ripple. Each is a finite-width annulus chasing an expanding
    // radius, carrying a few sine oscillations (concentric water rings)
    // in its wake, decaying with age and spreading thinner with radius.
    vec2 disp = vec2(0.0);
    float caustic = 0.0;
    for (int i = 0; i < N; i++) {
      if (uPulses[i].x < 0.0) continue;
      float t = uPulses[i].x;
      // Origin: cursor UV is Y-down; vUv is Y-up. Flip to match.
      vec2 o = vec2(uPulses[i].y, 1.0 - uPulses[i].z);
      vec2 d = (vUv - o) * vec2(aspect, 1.0);
      float r = length(d);
      vec2 dir = r > 1e-4 ? d / r : vec2(0.0);

      // SLOW + FLUID (user: the snappy version was too aggressive). A
      // leisurely expansion (speed 0.55 vs 1.25), a WIDE soft band, a
      // LOW oscillation frequency (broad gentle swells, not tight rings)
      // and a slow gentle decay make it read like a fluid wave through
      // water rather than a sharp shock.
      float front = r - 0.55 * t;          // signed dist to the leading ring
      float w = 0.14;                       // wide soft annulus
      float env = exp(-(front * front) / (2.0 * w * w));
      float osc = sin(front * 26.0);        // broad, fluid swells
      float decay = exp(-t * 1.3) / (1.0 + r * 1.5);
      float amp = 0.013 * uPulseStr[i];

      disp += dir * osc * env * decay * amp;
      caustic += env * decay * uPulseStr[i];
    }

    vec2 suv = vUv + disp;

    // Chromatic refraction: split R/B a hair along the displacement so
    // the wavefront glints like a real lens, not a uniform shift.
    vec2 cdir = length(disp) > 1e-5 ? normalize(disp) : vec2(0.0);
    float camt = min(length(disp) * 0.45, 0.0024);
    vec3 hdr;
    hdr.r = texture2D(uScene, suv + cdir * camt).r;
    hdr.g = texture2D(uScene, suv).g;
    hdr.b = texture2D(uScene, suv - cdir * camt).b;
    float alpha = texture2D(uScene, suv).a;

    // Caustic: a faint brightness lift where the ring focuses light, so
    // the distortion also reads as energy, not just geometry.
    hdr *= 1.0 + clamp(caustic, 0.0, 1.0) * 0.06;

    vec3 col = lin2srgb(ACESFilmic(hdr));
    gl_FragColor = vec4(col, alpha);
  }
`;

interface Props {
  pulsesRef: React.MutableRefObject<PulseChannel>;
  /** MSAA sample count for the offscreen buffer (keypad edges need it;
   *  0 on mobile to save fill-rate). */
  samples?: number;
  /** Exposure to match the Canvas gl.toneMappingExposure. */
  toneExposure?: number;
}

export function RipplePost({
  pulsesRef,
  samples = 4,
  toneExposure = 1.05,
}: Props) {
  const { gl, scene, camera } = useThree();

  const pipeline = useMemo(() => {
    const rt = new THREE.WebGLRenderTarget(2, 2, {
      depthBuffer: true,
      stencilBuffer: false,
      samples,
      // Leave colorSpace linear: pass 1 stores linear HDR (three applies
      // no tone map / encode to a render target), pass 2 does both.
    });
    rt.texture.minFilter = THREE.LinearFilter;
    rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.generateMipmaps = false;

    const mat = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        uScene: { value: rt.texture },
        uResolution: { value: new THREE.Vector2(2, 2) },
        uPulses: {
          value: Array.from(
            { length: PULSE_SLOTS },
            () => new THREE.Vector3(-1, 0.5, 0.5),
          ),
        },
        uPulseStr: { value: new Array(PULSE_SLOTS).fill(0) },
        uToneExposure: { value: toneExposure },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.NoBlending,
    });

    const quadScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    quadScene.add(quad);
    const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    return { rt, mat, quadScene, quad, quadCam };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const _buf = useMemo(() => new THREE.Vector2(), []);

  // priority 1: take over rendering. Mounting this component disables
  // R3F's auto-render, so the two manual passes ARE the frame.
  useFrame(() => {
    // Keep the offscreen buffer matched to the live drawing-buffer size.
    gl.getDrawingBufferSize(_buf);
    if (_buf.x !== pipeline.rt.width || _buf.y !== pipeline.rt.height) {
      pipeline.rt.setSize(Math.max(2, _buf.x), Math.max(2, _buf.y));
      (pipeline.mat.uniforms.uResolution.value as THREE.Vector2).copy(_buf);
    }

    // Roll the ripple ages forward; free expired slots.
    const ch = pulsesRef.current;
    const uP = pipeline.mat.uniforms.uPulses.value as THREE.Vector3[];
    const uS = pipeline.mat.uniforms.uPulseStr.value as number[];
    const now = performance.now();
    for (let i = 0; i < PULSE_SLOTS; i++) {
      const p = ch?.slots[i];
      if (p && p.start > 0) {
        const age = (now - p.start) / 1000;
        if (age < PULSE_LIFE) {
          uP[i]!.set(age, p.x, p.y);
          uS[i] = p.strength;
          continue;
        }
      }
      uP[i]!.x = -1;
      uS[i] = 0;
    }

    // PASS 1: full scene -> linear FBO.
    gl.setRenderTarget(pipeline.rt);
    gl.render(scene, camera);
    // PASS 2: ripple-refract -> canvas.
    gl.setRenderTarget(null);
    gl.render(pipeline.quadScene, pipeline.quadCam);
  }, 1);

  useEffect(() => {
    return () => {
      pipeline.rt.dispose();
      pipeline.mat.dispose();
      pipeline.quad.geometry.dispose();
    };
  }, [pipeline]);

  return null;
}
