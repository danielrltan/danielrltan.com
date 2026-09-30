/**
 * Shared, non-reactive hero state (plain mutable object, no re-renders).
 * Written by the hero wipe controller (heroWipe.ts), read per frame by the
 * WebGL ring so it can stop all GPU work once the hero is no longer visible.
 * Replaces the ring reading a per-frame :root CSS var.
 */
export const heroState = {
  /** true once the hero layer is fully hidden (iris cleared / fade done). */
  culled: false,
};
