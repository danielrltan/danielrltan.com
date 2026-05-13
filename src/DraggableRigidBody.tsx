import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import {
  CuboidCollider,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { useSceneReadyRef, useSetMoveableHover } from "./SceneState";

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
const RB_DYNAMIC = 0;

const STIFFNESS = 150;
const DAMPING = 15;

const HELD_LINEAR_DAMPING = 0.1;
const HELD_ANGULAR_DAMPING = 0.4;
const REST_LINEAR_DAMPING = 1.5;
const REST_ANGULAR_DAMPING = 2.0;

const RESTITUTION = 0.2;
const FRICTION = 0.7;

const ACTIVATION_CHECK_INTERVAL = 0.05;
const ACTIVATION_STARTUP_DELAY = 0.5;
const SUPPORT_RAY_DISTANCE = 0.35;
const SUPPORT_RAY_EPS = 0.005;
const PROXIMITY_SQ = 0.4 * 0.4;
const SUPPORT_MISS_THRESHOLD = 3;

const MIN_MASS = 0.5;

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
  const halfHeight = half[1];
  const useCuboid =
    half[0] < TINY_THRESHOLD &&
    half[1] < TINY_THRESHOLD &&
    half[2] < TINY_THRESHOLD;
  const rb = useRef<RapierRigidBody | null>(null);
  const dragging = useRef(false);
  const [activated, setActivated] = useState(false);
  const activatedRef = useRef(false);
  const checkAccum = useRef(0);
  const elapsedTime = useRef(0);
  const supportMisses = useRef(0);

  const plane = useRef(new THREE.Plane());
  const cursorTarget = useRef(new THREE.Vector3());

  const grabLocal = useRef(new THREE.Vector3());
  const tmpQuat = useRef(new THREE.Quaternion());
  const tmpInvQuat = useRef(new THREE.Quaternion());
  const tmpWorldGrab = useRef(new THREE.Vector3());
  const tmpCamDir = useRef(new THREE.Vector3());
  const tmpClickPoint = useRef(new THREE.Vector3());

  const { camera, raycaster, pointer, controls } = useThree();
  const { rapier, world } = useRapier();
  const sceneReadyRef = useSceneReadyRef();
  const setMoveableHover = useSetMoveableHover();

  useEffect(() => {
    activatedRef.current = activated;
  }, [activated]);

  useEffect(() => {
    bodyRegistry.set(name, {
      getPosition: () => (rb.current ? rb.current.translation() : null),
      isActivated: () => activatedRef.current,
      activate: () => {
        if (activatedRef.current || !rb.current) return;
        activatedRef.current = true;
        setActivated(true);
        rb.current.setBodyType(RB_DYNAMIC, true);
        const mass = rb.current.mass();
        if (mass < MIN_MASS) {
          rb.current.setAdditionalMass(MIN_MASS - mass, true);
        }
      },
    });
    return () => {
      bodyRegistry.delete(name);
    };
  }, [name]);

  const activateNow = () => {
    if (activatedRef.current || !rb.current) return;
    activatedRef.current = true;
    setActivated(true);
    rb.current.setBodyType(RB_DYNAMIC, true);
    const mass = rb.current.mass();
    if (mass < MIN_MASS) {
      rb.current.setAdditionalMass(MIN_MASS - mass, true);
    }
  };

  useFrame((_, dt) => {
    if (!rb.current) return;

    if (!activated) {
      elapsedTime.current += dt;
      if (elapsedTime.current < ACTIVATION_STARTUP_DELAY) return;

      checkAccum.current += dt;
      if (checkAccum.current < ACTIVATION_CHECK_INTERVAL) return;
      checkAccum.current = 0;

      const pos = rb.current.translation();

      const rayOrigin = {
        x: pos.x,
        y: pos.y - halfHeight - SUPPORT_RAY_EPS,
        z: pos.z,
      };
      const ray = new rapier.Ray(rayOrigin, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(
        ray,
        SUPPORT_RAY_DISTANCE,
        true,
        undefined,
        undefined,
        undefined,
        rb.current,
      );
      if (!hit) {
        supportMisses.current++;
        if (supportMisses.current >= SUPPORT_MISS_THRESHOLD) {
          activateNow();
        }
      } else {
        supportMisses.current = 0;
      }

      if (proximityActivate) {
        for (const [otherName, entry] of bodyRegistry) {
          if (otherName === name) continue;
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

  return (
    <RigidBody
      ref={rb}
      name={name}
      type={activated ? "dynamic" : "fixed"}
      position={position}
      colliders={useCuboid ? false : "hull"}
      restitution={RESTITUTION}
      friction={FRICTION}
      linearDamping={REST_LINEAR_DAMPING}
      angularDamping={REST_ANGULAR_DAMPING}
      gravityScale={activated ? 1 : 0}
      canSleep
      ccd
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