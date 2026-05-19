import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  CuboidCollider,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as THREE from "three";
import {
  useDeskViewActiveRef,
  useSceneReadyRef,
  useSetMoveableHover,
} from "./SceneState";
import { playOneShot, playTap } from "./audio";

interface Props {
  name: string;
  position: [number, number, number];
  half: [number, number, number];
  throwable?: boolean;
  /**
   * When false, this body only wakes from pointer pick / support-ray miss,
   * not from `bodyRegistry` proximity. Use for meshes parked against fixed
   * neighbours so stray dynamics do not start overlap jitter.
   */
  proximityActivate?: boolean;
  children: ReactNode;
}

const TINY_THRESHOLD = 0.08;

const STIFFNESS = 150;
const DAMPING = 15;

const HELD_LINEAR_DAMPING = 0.1;
const HELD_ANGULAR_DAMPING = 0.4;
/** Slightly higher than typical props so hard throws stop ringing sooner (fewer active solver frames). */
const REST_LINEAR_DAMPING = 2.1;
const REST_ANGULAR_DAMPING = 2.8;

const RESTITUTION = 0.2;
const FRICTION = 0.7;

const ACTIVATION_CHECK_INTERVAL = 0.2;
const ACTIVATION_STARTUP_DELAY = 0.5;
const PROXIMITY_SQ = 0.4 * 0.4;

const MIN_MASS = 0.5;

// ----- Collision sound -----
// Default clip is `tap`. Variation comes from:
//   1. Impact speed → volume.
//   2. AABB volume → base pitch (bigger props pitch the tap down, so a
//      thrown mirror reads as a heavier thump than a dropped pen).
//   3. Per-impact random jitter so identical drops don't sound robotic.
// Specific props can override the clip entirely via NAME_CLIP_OVERRIDES
// (e.g. the cat plush meows instead of tapping).
const COLLISION_MIN_SPEED = 1.4; // below this → no sound (resting / shake / soft contact)
const COLLISION_SPEED_FULL_VOL = 3.5; // speed at which volume maxes out
// Per-body retrigger guard, picked by AABB volume. Large items (mirror,
// chair, blanket) have a long cooldown because they're the ones whose
// contacts stack into machine-gun spam when shaken; small items keep a
// short cooldown so dropping pens / mugs stays responsive.
const COLLISION_THROTTLE_SMALL_MS = 110;
const COLLISION_THROTTLE_LARGE_MS = 420;
const SIZE_LARGE_VOL_THRESHOLD = 0.005; // m³ AABB above this → "large"
const COLLISION_BASE_VOLUME = 0.35; // overall ceiling for tap

// Size-driven base pitch. Operates on log10(AABB volume) so it spans the
// full ~5-order-of-magnitude prop range cleanly. Smaller body → higher
// pitch; larger body → lower pitch.
const COLLISION_PITCH_SMALL = 1.18; // base pitch at the small end
const COLLISION_PITCH_LARGE = 0.7; // base pitch at the large end
const COLLISION_LOG_VOL_MIN = -5; // log10(vol) treated as "as small as it gets"
const COLLISION_LOG_VOL_MAX = -1; // log10(vol) treated as "big prop"
const COLLISION_PITCH_JITTER = 0.08; // ± random shift on top of base each impact

function basePitchForHalf(h: [number, number, number]): number {
  const vol = h[0] * h[1] * h[2] * 8;
  if (vol <= 0) return COLLISION_PITCH_SMALL;
  const log10vol = Math.log10(vol);
  const t = Math.max(
    0,
    Math.min(
      1,
      (log10vol - COLLISION_LOG_VOL_MIN) /
        (COLLISION_LOG_VOL_MAX - COLLISION_LOG_VOL_MIN),
    ),
  );
  return (
    COLLISION_PITCH_SMALL + (COLLISION_PITCH_LARGE - COLLISION_PITCH_SMALL) * t
  );
}

const NAME_CLIP_OVERRIDES: Record<string, "tap" | "cat"> = {
  th_cat_plush: "cat",
};
// Per-clip volume ceiling on top of the speed-scaled envelope.
const CLIP_VOLUME_TRIM: Record<"tap" | "cat", number> = {
  tap: 1.0,
  cat: 0.7, // cat plush mew — toned down so it doesn't overpower the tap mix
};

interface BodyEntry {
  getPosition: () => { x: number; y: number; z: number } | null;
  isActivated: () => boolean;
  activate: () => void;
}
const bodyRegistry = new Map<string, BodyEntry>();

export function DraggableRigidBody({
  name,
  position,
  half,
  children,
  proximityActivate = true,
}: Props) {
  const useCuboid =
    half[0] < TINY_THRESHOLD &&
    half[1] < TINY_THRESHOLD &&
    half[2] < TINY_THRESHOLD;
  const rb = useRef<RapierRigidBody | null>(null);
  const dragging = useRef(false);
  // Activation drives the JSX `type` / `gravityScale` props directly —
  // @react-three/rapier re-applies the `type` prop on every render, so
  // an imperative `setBodyType` would get clobbered by the next render
  // (which is what just broke drag). React is the single driver. The
  // mirror ref `activatedRef` exists so `useFrame` and pointer handlers
  // can read the current value synchronously without waiting for the
  // commit cycle (fixes the one-frame stale-state hole that #7 caught).
  const [activated, setActivated] = useState(false);
  const activatedRef = useRef(false);
  const checkAccum = useRef(0);
  const elapsedTime = useRef(0);
  // Sanity-check state: spawn pose for resets + frame counter so we
  // only run the check every 10 frames (~6 Hz at 60 fps).
  const spawnPos = useRef<[number, number, number]>(position);
  const frameCount = useRef(0);

  const plane = useRef(new THREE.Plane());
  const cursorTarget = useRef(new THREE.Vector3());

  const grabLocal = useRef(new THREE.Vector3());
  const tmpQuat = useRef(new THREE.Quaternion());
  const tmpInvQuat = useRef(new THREE.Quaternion());
  const tmpWorldGrab = useRef(new THREE.Vector3());
  const tmpCamDir = useRef(new THREE.Vector3());
  const tmpClickPoint = useRef(new THREE.Vector3());

  const { camera, raycaster, pointer, controls } = useThree();
  const sceneReadyRef = useSceneReadyRef();
  const deskViewActiveRef = useDeskViewActiveRef();
  const setMoveableHover = useSetMoveableHover();

  const lastCollisionAt = useRef(0);
  const basePitchRef = useRef(basePitchForHalf(half));
  // Pick the per-body throttle from AABB volume once. Large items get
  // the heavy cooldown (they're the ones whose shakes spam); small items
  // stay snappy so dropping a pen / mug feels responsive.
  const bodyThrottleMs = useRef(
    half[0] * half[1] * half[2] * 8 >= SIZE_LARGE_VOL_THRESHOLD
      ? COLLISION_THROTTLE_LARGE_MS
      : COLLISION_THROTTLE_SMALL_MS,
  );
  useEffect(() => {
    basePitchRef.current = basePitchForHalf(half);
    bodyThrottleMs.current =
      half[0] * half[1] * half[2] * 8 >= SIZE_LARGE_VOL_THRESHOLD
        ? COLLISION_THROTTLE_LARGE_MS
        : COLLISION_THROTTLE_SMALL_MS;
  }, [half]);

  const onCollisionEnter = () => {
    if (!sceneReadyRef?.current) return;
    if (!rb.current) return;
    const v = rb.current.linvel();
    const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

    // Named override (cat plush meow) keeps the old pooled path so the
    // clip plays out without being hard-cut by other collisions.
    const overrideClip = NAME_CLIP_OVERRIDES[name];
    if (overrideClip) {
      const now = performance.now();
      if (now - lastCollisionAt.current < bodyThrottleMs.current) return;
      if (speed < COLLISION_MIN_SPEED) return;
      lastCollisionAt.current = now;
      const tRaw = Math.min(
        1,
        (speed - COLLISION_MIN_SPEED) /
          (COLLISION_SPEED_FULL_VOL - COLLISION_MIN_SPEED),
      );
      const jitter = (Math.random() * 2 - 1) * COLLISION_PITCH_JITTER;
      playOneShot(
        overrideClip,
        COLLISION_BASE_VOLUME * CLIP_VOLUME_TRIM[overrideClip] * tRaw,
        1.0 + jitter,
      );
      return;
    }

    // Everything else routes through the purpose-built tap channel,
    // which owns its own single Audio element + cooldown + hard-cut.
    playTap(speed);
  };

  // Single activation path — flips the ref synchronously so `useFrame`
  // / pointer handlers see `activatedRef.current === true` immediately,
  // and schedules the React render that drives the JSX `type` /
  // `gravityScale` flip. The mass adjustment lands in the `useEffect`
  // below, AFTER react-three/rapier has propagated the new type to the
  // underlying Rapier body — otherwise we'd be setting mass on a body
  // that's about to be re-init'd.
  const activateImpl = () => {
    if (activatedRef.current) return;
    activatedRef.current = true;
    setActivated(true);
  };

  // Keep the ref in sync if anything ever sets `activated` outside
  // `activateImpl` (currently nothing does, but cheap insurance).
  useEffect(() => {
    activatedRef.current = activated;
  }, [activated]);

  // Mass adjustment runs after the type flip commits. Tiny props like
  // pens / dice come in under MIN_MASS and feel weightless without
  // this bump — applied imperatively because there's no Rapier prop
  // for "minimum mass". Safe here because by the time this effect runs
  // the body is already dynamic.
  useEffect(() => {
    if (!activated || !rb.current) return;
    const mass = rb.current.mass();
    if (mass < MIN_MASS) {
      rb.current.setAdditionalMass(MIN_MASS - mass, true);
    }
  }, [activated]);

  // Keyed by a stable per-instance id rather than `name` — `name` is
  // taken from a GLB mesh name and is guaranteed unique today, but a
  // future duplicate-name mesh would silently clobber the earlier
  // registration and then its unmount would delete the wrong entry.
  // `useId()` sidesteps that entirely.
  const registryId = useId();
  useEffect(() => {
    bodyRegistry.set(registryId, {
      getPosition: () => (rb.current ? rb.current.translation() : null),
      isActivated: () => activatedRef.current,
      activate: activateImpl,
    });
    return () => {
      bodyRegistry.delete(registryId);
    };
    // `registryId` is stable for the lifetime of the component, and
    // `activateImpl` closes over stable refs only — safe deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryId]);

  const activateNow = activateImpl;

  useFrame((_, dt) => {
    if (!rb.current) return;

    // Read the ref, not the prior React state — the ref is updated
    // synchronously by `activateImpl`, the state was one render behind.
    if (!activatedRef.current) {
      // Support-raycast auto-activation removed — it was the trigger that
      // made pegboard / wall-hung items fall on load (those items have
      // nothing directly below them so the downward ray always misses).
      // Bodies now only wake on pointer click or proximity to an already
      // -activated neighbour; wall-hung items stay fixed until grabbed.
      elapsedTime.current += dt;
      if (elapsedTime.current < ACTIVATION_STARTUP_DELAY) return;

      checkAccum.current += dt;
      if (checkAccum.current < ACTIVATION_CHECK_INTERVAL) return;
      checkAccum.current = 0;

      if (proximityActivate) {
        const pos = rb.current.translation();
        for (const [otherId, entry] of bodyRegistry) {
          if (otherId === registryId) continue;
          if (!entry.isActivated()) continue;
          const otherPos = entry.getPosition();
          if (!otherPos) continue;
          const dx = pos.x - otherPos.x;
          const dy = pos.y - otherPos.y;
          const dz = pos.z - otherPos.z;
          if (dx * dx + dy * dy + dz * dz < PROXIMITY_SQ) {
            activateNow();
            return;
          }
        }
      }
      return;
    }

    // ----- Sanity reset -----
    // Activated, untouched bodies occasionally clip through a wall and
    // free-fall into the void, or Rapier's solver gets a contact stack
    // that drives the body to absurd velocity. Both look bad and stay
    // broken until reload. Every ~6 Hz, check for either condition and
    // teleport the body back to its spawn pose with zeroed velocity.
    frameCount.current++;
    if (!dragging.current && frameCount.current % 10 === 0) {
      const pos = rb.current.translation();
      const vel = rb.current.linvel();
      const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
      const outOfBounds =
        pos.y < -2 ||
        pos.y > 5 ||
        Math.abs(pos.x) > 5 ||
        Math.abs(pos.z) > 5;
      const spazzing = speed > 50;
      if (outOfBounds || spazzing) {
        rb.current.setTranslation(
          {
            x: spawnPos.current[0],
            y: spawnPos.current[1],
            z: spawnPos.current[2],
          },
          true,
        );
        rb.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rb.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }

    if (!dragging.current) return;

    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(plane.current, cursorTarget.current))
      return;

    const pos = rb.current.translation();
    const rot = rb.current.rotation();
    tmpQuat.current.set(rot.x, rot.y, rot.z, rot.w);
    tmpWorldGrab.current
      .copy(grabLocal.current)
      .applyQuaternion(tmpQuat.current);
    tmpWorldGrab.current.x += pos.x;
    tmpWorldGrab.current.y += pos.y;
    tmpWorldGrab.current.z += pos.z;

    const vel = rb.current.linvel();
    const mass = rb.current.mass();
    const k = STIFFNESS * Math.max(mass, MIN_MASS);
    const d = DAMPING * Math.max(mass, MIN_MASS);

    let ix =
      (k * (cursorTarget.current.x - tmpWorldGrab.current.x) -
        d * vel.x) *
      dt;
    let iy =
      (k * (cursorTarget.current.y - tmpWorldGrab.current.y) -
        d * vel.y) *
      dt;
    let iz =
      (k * (cursorTarget.current.z - tmpWorldGrab.current.z) -
        d * vel.z) *
      dt;

    const mag = Math.sqrt(ix * ix + iy * iy + iz * iz);
    const maxImpulse = 2.0;
    if (mag > maxImpulse) {
      const s = maxImpulse / mag;
      ix *= s;
      iy *= s;
      iz *= s;
    }

    if (useCuboid) {
      rb.current.applyImpulse({ x: ix, y: iy, z: iz }, true);
    } else {
      rb.current.applyImpulseAtPoint(
        { x: ix, y: iy, z: iz },
        {
          x: tmpWorldGrab.current.x,
          y: tmpWorldGrab.current.y,
          z: tmpWorldGrab.current.z,
        },
        true,
      );
    }
  });

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!sceneReadyRef?.current) return;
    // Interaction is locked out while seated at the desk.
    if (deskViewActiveRef?.current) return;
    // Left mouse / primary touch only. Middle / right / trackpad-secondary
    // are reserved for OrbitControls (orbit, pan, shift+middle pan).
    if (e.button !== 0) return;
    if (!rb.current) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);

    if (!activated) {
      activateNow();
    }

    const mass = rb.current.mass();
    if (mass < MIN_MASS) {
      rb.current.setAdditionalMass(MIN_MASS - mass, true);
    }

    rb.current.setLinearDamping(HELD_LINEAR_DAMPING);
    rb.current.setAngularDamping(HELD_ANGULAR_DAMPING);

    const pos = rb.current.translation();
    const rot = rb.current.rotation();
    tmpInvQuat.current.set(rot.x, rot.y, rot.z, rot.w).invert();
    grabLocal.current.set(
      e.point.x - pos.x,
      e.point.y - pos.y,
      e.point.z - pos.z,
    );
    grabLocal.current.applyQuaternion(tmpInvQuat.current);

    tmpClickPoint.current.set(e.point.x, e.point.y, e.point.z);
    camera.getWorldDirection(tmpCamDir.current);
    plane.current.setFromNormalAndCoplanarPoint(
      tmpCamDir.current,
      tmpClickPoint.current,
    );

    dragging.current = true;
    if (controls) (controls as { enabled?: boolean }).enabled = false;
  };

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!rb.current || !dragging.current) return;
    e.stopPropagation();
    try {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      // already released
    }

    rb.current.setLinearDamping(REST_LINEAR_DAMPING);
    rb.current.setAngularDamping(REST_ANGULAR_DAMPING);

    dragging.current = false;
    if (controls) (controls as { enabled?: boolean }).enabled = true;
  };

  const onPointerOver = () => {
    if (!sceneReadyRef?.current) return;
    setMoveableHover(true);
  };
  const onPointerOut = () => {
    setMoveableHover(false);
  };

  // CCD only on the tiny cuboid props (wristrest, pens, dice, …). Large
  // hull-based bodies don't tunnel in practice and CCD on those spikes
  // frame time. This keeps the fix targeted to where the bug was visible.
  return (
    <RigidBody
      ref={rb}
      name={name}
      // React-driven body type. @react-three/rapier re-applies these
      // props on every render — imperative `setBodyType` / `setGravityScale`
      // calls get clobbered on the next commit, so they MUST flow
      // through React state (`activated`). The mass adjustment that
      // can't be expressed as a prop lives in `useEffect([activated])`.
      type={activated ? "dynamic" : "fixed"}
      gravityScale={activated ? 1 : 0}
      position={position}
      colliders={useCuboid ? false : "hull"}
      restitution={RESTITUTION}
      friction={FRICTION}
      linearDamping={REST_LINEAR_DAMPING}
      angularDamping={REST_ANGULAR_DAMPING}
      canSleep
      ccd={useCuboid}
      onCollisionEnter={onCollisionEnter}
    >
      {useCuboid && <CuboidCollider args={half} />}
      <group
        onPointerDown={onPointerDown}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        {children}
      </group>
    </RigidBody>
  );
}