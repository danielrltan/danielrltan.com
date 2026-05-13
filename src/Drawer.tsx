import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { RigidBody, type RapierRigidBody } from "@react-three/rapier";
import { useRef } from "react";
import * as THREE from "three";
import { useSceneReadyRef, useSetMoveableHover } from "./SceneState";

export interface DrawerData {
  uuid: string;
  name: string;
  /** Drawer's authored world position — body sits here when fully closed. */
  bodyPos: [number, number, number];
  meshLocalPos: [number, number, number];
  meshLocalQuat: [number, number, number, number];
  meshLocalScale: [number, number, number];
  object: THREE.Object3D;
}

// Drawer slides toward -Z (away from the dresser, which is on the +Z wall).
const MAX_OPEN = 0.3;
const HALFWAY_OFFSET = 0.15;
const SNAP_LERP = 0.15;
const SNAP_EPSILON = 0.001;

const UP = new THREE.Vector3(0, 1, 0);

export function Drawer({ drawer }: { drawer: DrawerData }) {
  const rb = useRef<RapierRigidBody | null>(null);

  const closedZ = drawer.bodyPos[2];
  const openZ = closedZ - MAX_OPEN;
  const halfway = closedZ - HALFWAY_OFFSET;

  // Live drawer Z (clamped to [openZ, closedZ]).
  const currentZ = useRef(closedZ);

  // Drag state.
  const dragging = useRef(false);
  const startPointerZ = useRef(0);
  const startDrawerZ = useRef(closedZ);

  // Snap state.
  const snapping = useRef(false);
  const targetZ = useRef(closedZ);

  const plane = useRef(new THREE.Plane(UP, 0));
  const cursorTarget = useRef(new THREE.Vector3());

  const { camera, raycaster, pointer, controls } = useThree();
  const sceneReadyRef = useSceneReadyRef();
  const setMoveableHover = useSetMoveableHover();

  const applyTranslation = () => {
    if (!rb.current) return;
    rb.current.setNextKinematicTranslation({
      x: drawer.bodyPos[0],
      y: drawer.bodyPos[1],
      z: currentZ.current,
    });
  };

  useFrame(() => {
    if (!rb.current) return;

    if (dragging.current) {
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(plane.current, cursorTarget.current))
        return;

      // Pointer Z delta relative to drag start. Negative dz = pointer moved
      // toward player = drawer opens.
      const deltaZ = cursorTarget.current.z - startPointerZ.current;
      currentZ.current = THREE.MathUtils.clamp(
        startDrawerZ.current + deltaZ,
        openZ,
        closedZ,
      );
      applyTranslation();
      return;
    }

    if (snapping.current) {
      // Lerp ~0.15 per frame until within 0.001 of target.
      currentZ.current = THREE.MathUtils.lerp(
        currentZ.current,
        targetZ.current,
        SNAP_LERP,
      );
      if (Math.abs(currentZ.current - targetZ.current) < SNAP_EPSILON) {
        currentZ.current = targetZ.current;
        snapping.current = false;
      }
      applyTranslation();
    }
  });

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (!sceneReadyRef?.current) return;
    // Left mouse / primary touch only.
    if (e.button !== 0) return;
    if (!rb.current) return;
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);

    // Horizontal drag plane at the drawer's current Y.
    const pos = rb.current.translation();
    plane.current.set(UP, -pos.y);

    raycaster.setFromCamera(pointer, camera);
    if (raycaster.ray.intersectPlane(plane.current, cursorTarget.current)) {
      startPointerZ.current = cursorTarget.current.z;
    }
    // Anchor on the drawer's current (post-snap) Z so grabbing a half-open
    // drawer doesn't snap it back to closed before the user has dragged.
    startDrawerZ.current = currentZ.current;

    dragging.current = true;
    snapping.current = false;
    if (controls) (controls as { enabled?: boolean }).enabled = false;
  };

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    try {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      // already released
    }

    // Snap toward whichever endpoint we're closer to.
    targetZ.current = currentZ.current < halfway ? openZ : closedZ;
    snapping.current = true;

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
      name={drawer.name}
      type="kinematicPosition"
      position={drawer.bodyPos}
      colliders="hull"
    >
      <group
        onPointerDown={onPointerDown}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerOver={onPointerOver}
        onPointerOut={onPointerOut}
      >
        <primitive object={drawer.object} />
      </group>
    </RigidBody>
  );
}
