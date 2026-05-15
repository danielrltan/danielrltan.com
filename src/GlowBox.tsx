import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { useDeskViewActiveRef, useSceneReadyRef } from "./SceneState";

interface Props {
  /** AABB half-extents of the body the glow surrounds, in body-local space. */
  half: readonly [number, number, number];
  /** Pointer-hover state from the parent. */
  hover: boolean;
  /**
   * Optional ref whose `.current` should be set to `1` on click. The
   * component decays it back to `0` over ~285ms and adds it on top of
   * the smooth intensity — the visual "shockwave" click feedback.
   */
  shockwaveRef?: RefObject<number>;
  /**
   * If true, the glow stays visible at low intensity even without hover
   * (used for the keyboard so the user knows it's interactive). Otherwise
   * the glow only shows on hover.
   */
  alwaysOn?: boolean;
  /** Extra world-space padding added on all sides of the AABB. */
  padding?: number;
  /** Corner rounding radius. */
  radius?: number;
  /**
   * Amplitude of an idle (no-hover) breathing pulse, as a fraction of
   * full intensity. 0 = no idle pulse (default, matches keyboard glow
   * behaviour). Used for the monitor glow so it visibly breathes.
   */
  idlePulseDepth?: number;
  /** Idle pulse cycles per second × 2π. Default 3.0 ≈ ~0.5 Hz. */
  idlePulseRate?: number;
}

// Tuning constants — shared across every glow so they breathe in sync.
const BASE_INTENSITY = 0.6;
const HOVER_BONUS = .6;
const HOVER_PULSE_DEPTH = 0.5;
const PULSE_RATE = 3.0;
const SHOCKWAVE_DECAY = 6;
const FADE_RATE = 0.025;

/**
 * Rounded-box hover glow. Inverted-hull style (BackSide + slightly larger
 * than the body's AABB), with a fragment shader bright enough to trigger
 * the bloom pass. Intensity smoothly fades on hover, pulses on a sine
 * wave while hovered, and adds a one-shot burst on click via `shockwaveRef`.
 */
export function GlowBox({
  half,
  hover,
  shockwaveRef,
  alwaysOn = false,
  padding = 0.01,
  radius = 0.025,
  idlePulseDepth = 0,
  idlePulseRate = PULSE_RATE,
}: Props) {
  // Read each frame — these refs flip without re-rendering, so a render-time
  // boolean would stay stale (glow staying visible after entering desk view).
  const sceneReadyRef = useSceneReadyRef();
  const deskViewActiveRef = useDeskViewActiveRef();

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          // > 1.0 pushes the fragment above the bloom luminance threshold.
          glow: { value: 3.0 },
          glowColor: { value: new THREE.Color(1.0, 0.96, 0.88) },
          pulse: { value: 1.0 },
          intensity: { value: 0.0 },
        },
        vertexShader: `
          void main() {
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float glow;
          uniform vec3 glowColor;
          uniform float pulse;
          uniform float intensity;
          void main() {
            vec3 color = glowColor * glow * pulse * intensity;
            gl_FragColor = vec4(color, intensity);
          }
        `,
        side: THREE.BackSide,
        depthWrite: false,
        transparent: true,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => () => material.dispose(), [material]);

  // Two smoothed channels so the breath (base) and the hover boost
  // (hover) can be combined without one inheriting the other's
  // behaviour: base pulses with idleFactor; hover adds a flat,
  // unmodulated bonus on top so the "I'm hovered" cue stays steady.
  const baseRef = useRef(0);
  const hoverRef = useRef(0);

  useFrame((state, dt) => {
    const u = material.uniforms;
    // Refs are read here (not at render time) so the glow reacts to the
    // scene-ready / desk-view transitions without needing a re-render.
    const enabled =
      sceneReadyRef?.current === true && deskViewActiveRef?.current !== true;
    const base = alwaysOn ? BASE_INTENSITY : 0;
    baseRef.current = THREE.MathUtils.lerp(
      baseRef.current,
      enabled ? base : 0,
      FADE_RATE,
    );
    hoverRef.current = THREE.MathUtils.lerp(
      hoverRef.current,
      enabled && hover ? HOVER_BONUS : 0,
      FADE_RATE,
    );
    if (shockwaveRef) {
      shockwaveRef.current = Math.max(
        0,
        shockwaveRef.current - dt * SHOCKWAVE_DECAY,
      );
    }
    const shock = shockwaveRef?.current ?? 0;

    // Idle pulse modulates the BASE intensity only. Hover bonus is
    // additive and constant so hovering reads as a sustained brightness
    // step that doesn't blink with the breath.
    const idleFactor =
      enabled && idlePulseDepth > 0
        ? 1 + idlePulseDepth * Math.sin(state.clock.elapsedTime * idlePulseRate)
        : 1;
    u.intensity.value = baseRef.current * idleFactor + hoverRef.current + shock;

    // Hover-only colour pulse (the original keyboard-style "tap" pulse,
    // scales in with hover). Kept as a `pulse` shader uniform so it
    // doesn't affect the alpha breathing above.
    const hoverProgress = THREE.MathUtils.clamp(
      hoverRef.current / HOVER_BONUS,
      0,
      1,
    );
    const hoverPulse =
      HOVER_PULSE_DEPTH *
      hoverProgress *
      Math.sin(state.clock.elapsedTime * PULSE_RATE);
    u.pulse.value = 1.0 + hoverPulse;
  });

  const size: [number, number, number] = [
    half[0] * 2 + padding,
    half[1] * 2 + padding,
    half[2] * 2 + padding,
  ];

  return (
    <RoundedBox
      args={size}
      radius={radius}
      smoothness={4}
      material={material}
      renderOrder={1000}
      frustumCulled={false}
    />
  );
}
