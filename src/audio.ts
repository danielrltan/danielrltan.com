/**
 * Tiny audio helper around HTMLAudioElement. Each one-shot clip is pooled
 * so rapid retriggers (e.g. typing) don't cut their own tail. The ambient
 * room tone is a single looping element.
 *
 * No Web Audio API here on purpose — `createMediaElementSource` makes
 * Chrome show the "tab is sharing content" capture indicator, which reads
 * as sketchy on a portfolio. That means we lose the ability to amplify
 * beyond `HTMLAudioElement.volume = 1.0`, so per-call volumes are tuned
 * to be loud enough at native scale (and `MASTER_GAIN` just scales the
 * quieter calls upward — it can't exceed 1.0).
 *
 * Browser autoplay policy rejects `.play()` until the first user gesture,
 * so every call is `.catch`-swallowed; the first interaction unlocks the
 * rest implicitly.
 */

type ClipName =
  | "room_tone"
  | "tap"
  | "keydown"
  | "keyup"
  | "cat"
  | "drawer_open"
  | "drawer_close";

const URLS: Record<ClipName, string> = {
  room_tone: "/sounds/room_tone.mp3",
  tap: "/sounds/tap.mp3",
  keydown: "/sounds/keydown.mp3",
  keyup: "/sounds/keyup.mp3",
  cat: "/sounds/cat.mp3",
  // Cache-bust suffix: the asset contents were updated several times
  // during dev; without this the browser kept serving an older keystroke
  // sample under these names.
  drawer_open: "/sounds/draweropen.mp3?v=2",
  drawer_close: "/sounds/drawerclose.mp3?v=2",
};

const POOL_SIZE = 6;
const pools = new Map<ClipName, HTMLAudioElement[]>();

/**
 * Linear multiplier applied to every requested volume. Caps at 1.0 — this
 * is just here so call sites can pass conservative numbers and have them
 * scaled up to the element's ceiling without each site having to fight
 * with the maximum.
 */
const MASTER_GAIN = 1.8;

function getPooled(name: ClipName): HTMLAudioElement {
  let pool = pools.get(name);
  if (!pool) {
    pool = Array.from({ length: POOL_SIZE }, () => {
      const a = new Audio(URLS[name]);
      a.preload = "auto";
      return a;
    });
    pools.set(name, pool);
  }
  // Prefer a free element so rapid retriggers overlap rather than cut.
  for (const a of pool) {
    if (a.paused || a.ended) return a;
  }
  return pool[0]!;
}

export function playOneShot(
  name: ClipName,
  volume = 1,
  playbackRate = 1,
): void {
  const a = getPooled(name);
  try {
    a.currentTime = 0;
  } catch {
    // Some browsers throw if currentTime is set before metadata loads; ignore.
  }
  a.volume = Math.max(0, Math.min(1, volume * MASTER_GAIN));
  // playbackRate < 1 lowers pitch (and slows the clip slightly — fine for
  // sub-second SFX). Used for the spacebar keydown/keyup tone.
  a.playbackRate = playbackRate;
  a.play().catch(() => {});
}

// ----- Tap collision sound (purpose-built, NOT pooled) -----------------
// Single shared Audio element. Every retrigger hard-cuts the previous
// play, so rapid impacts always sound clean rather than layering into a
// "bones cracking" snare roll. 120 ms cooldown enforces ~8 taps/sec max.
const tapElement = new Audio(URLS.tap);
tapElement.preload = "auto";
let tapLastPlayed = 0;
const TAP_COOLDOWN_MS = 120;
const TAP_MIN_SPEED = 0.5; // ignore micro-bumps
const TAP_SPEED_FULL = 6.0; // m/s where volume saturates

/**
 * Collision tap. `speed` is the magnitude of the rigid body's `linvel()`
 * at the moment of contact — not relative manifold velocity. Caller is
 * expected to invoke this only from `onCollisionEnter` (never `Contact
 * Force` or `IntersectionEnter`).
 */
export function playTap(speed: number): void {
  const now = performance.now();
  if (now - tapLastPlayed < TAP_COOLDOWN_MS) return;
  if (speed < TAP_MIN_SPEED) return;
  tapLastPlayed = now;

  // Hard-cut whatever's still ringing out.
  tapElement.pause();
  try {
    tapElement.currentTime = 0;
  } catch {
    /* metadata not ready — ignore */
  }

  const vol = Math.min(speed / TAP_SPEED_FULL, 1);
  tapElement.volume = Math.max(0, Math.min(1, vol * MASTER_GAIN));
  // ±10% pitch jitter so repeat drops don't sound robotic.
  tapElement.playbackRate = 0.9 + Math.random() * 0.2;
  tapElement.play().catch(() => {});
}

let ambience: HTMLAudioElement | null = null;

export function startAmbience(volume = 0.4): void {
  if (ambience) return;
  ambience = new Audio(URLS.room_tone);
  ambience.loop = true;
  ambience.volume = Math.max(0, Math.min(1, volume * MASTER_GAIN));
  ambience.play().catch(() => {});
}

export function stopAmbience(): void {
  if (!ambience) return;
  ambience.pause();
  ambience = null;
}
