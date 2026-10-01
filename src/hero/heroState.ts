/**
 * Shared hero state.
 *
 * `heroState` is a plain mutable object (no re-renders), written by the hero
 * wipe controller (heroWipe.ts) and read per frame by the WebGL ring:
 *   - culled: the hero layer is fully hidden (iris cleared / fade done), so the
 *     ring stops all GPU work.
 *   - wiping: the pixel iris is on screen (0 < scrollY < iris end). The ring
 *     renders at display rate then, instead of pausing on scroll / 24fps.
 * Replaces the ring reading a per-frame :root CSS var.
 *
 * `heroHandoff` is a tiny latched store for the hero -> About handoff, read by
 * About (subscribe / useSyncExternalStore). Both flags only ever go false ->
 * true in a session:
 *   - armed: About's arrival trio (banner, name card, room render) may reveal.
 *     Set while the hero is still settled and opaque (hero-composed, the first
 *     scroll, or a load at an offset), so the reveal and the room image's first
 *     paint happen under the hero, never in the iris's first frames.
 *   - cue: About's "ABOUT" scramble decode starts. Set once the iris is about a
 *     third open (desktop), or when the hero fade starts (mobile / reduced
 *     motion), so the decode plays where it can be seen.
 */
export const heroState = {
  culled: false,
  wiping: false,
};

type Flag = "armed" | "cue";
const flags: Record<Flag, boolean> = { armed: false, cue: false };
const subs = new Set<() => void>();

export const heroHandoff = {
  get armed() {
    return flags.armed;
  },
  get cue() {
    return flags.cue;
  },
  set(flag: Flag) {
    if (flags[flag]) return;
    flags[flag] = true;
    subs.forEach((f) => f());
  },
  subscribe(cb: () => void) {
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  },
};
