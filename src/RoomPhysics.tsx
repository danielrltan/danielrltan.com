import { Physics } from "@react-three/rapier";
import { Room } from "./Room";

/**
 * Lazy boundary for the rapier physics chunk. This module is the ONLY
 * static importer of @react-three/rapier (and, through Room, of the
 * Drawer / DraggableRigidBody helpers), so Rollup bundles the entire
 * 2.3 MB rapier WASM payload behind this dynamic import instead of the
 * boot-critical graph. App lazy-mounts it inside the room canvas's
 * existing <Suspense>.
 *
 * Mobile: keep the Physics provider mounted (Room's <RigidBody>s
 * require it) but pause the sim. PERF: also pause once the room is
 * asleep (scrolled out): a running Rapier step calls invalidate()
 * every frame, which is what kept the room canvas rendering at full
 * rate behind the invisible layer even under frameloop="demand".
 * Pausing it lets the demand loop actually idle on Mac / Work / Other.
 */
export default function RoomPhysics({
  paused,
  roomResetKey,
}: {
  paused: boolean;
  roomResetKey: number;
}) {
  return (
    <Physics
      paused={paused}
      gravity={[0, -9.81, 0]}
      timeStep={1 / 60}
      numSolverIterations={3}
      numInternalPgsIterations={1}
      allowedLinearError={0.0025}
      contactNaturalFrequency={22}
    >
      <Room key={roomResetKey} />
    </Physics>
  );
}
