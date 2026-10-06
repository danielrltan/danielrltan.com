/**
 * The ten interests shown in the Play section. One roster feeds both the
 * accessible list in Other.tsx (label + caption) and the 3D cluster in
 * HobbiesScene.tsx (id + file).
 *
 * `id` is an opaque, STABLE key (it drives HobbiesScene's LAYOUT /
 * POS_PORTRAIT lookups) and deliberately does NOT have to match `file`:
 * belt→glove.glb (Kickboxing), shoe→boot.glb (Fashion) and yarn→donut.glb
 * (3D Modelling) were re-modelled from new .blend drops and keeping the ids
 * avoided churning the layout maps.
 */
import { outBackSoft, seg } from "../seams/curves";

export interface Hobby {
  id: string;
  /** GLB under /public/hobbies/. */
  file: string;
  label: string;
  /** One-line note, carried by the sr-only accessible list. */
  caption: string;
}

export const HOBBIES: readonly Hobby[] = [
  { id: "belt",     file: "glove.glb",    label: "Kickboxing",   caption: "gloves up, the discipline of throwing a clean combination and taking the hit." },
  { id: "piano",    file: "piano.glb",    label: "Piano",        caption: "an hour at the keys before anyone else is up." },
  { id: "pc",       file: "gpu.glb",      label: "Workstation",  caption: "the desk is the workshop is the lab is the rabbit hole." },
  { id: "shoe",     file: "boot.glb",     label: "Fashion",      caption: "a fit is a sentence. Punctuation matters." },
  { id: "keyboard", file: "keyboard.glb", label: "Keyboards",    caption: "tactile under the fingers, loud in the room. on purpose." },
  { id: "cursor",   file: "cursor.glb",   label: "Design",       caption: "obsession over the line weight no one will ever notice." },
  { id: "car",      file: "car.glb",      label: "Cars",         caption: "spool, whistle, dump: the soundtrack of a good morning." },
  { id: "yarn",     file: "donut.glb",    label: "3D Modelling", caption: "started with the Blender donut, stayed for the topology." },
  { id: "luggage",  file: "luggage.glb",  label: "Travel",       caption: "the carry-on is packed by Thursday for a Saturday I haven't booked." },
  { id: "ski",      file: "ski.glb",      label: "Skiing",       caption: "blue light, edges biting, the mountain quiet under it all." },
];

/**
 * SEAM MOTION STORE (seam overhaul 2026-10-06, spec §5.4/§5.5; owner: "one
 * workstation, one signal, never stopping"): the Play section no longer holds.
 * Two scroll seams in Other.tsx drive the cluster instead, and this is the one
 * place they meet the scene:
 * - `arrival` (work → play, "zero-g arrival"): 0 = the props are below the
 *   fold, 1 = home. They rise in a left-to-right wave as the section comes up.
 * - `doors` (play → honours): 0 = closed, 1 = the props have parted like
 *   elevator doors to make room for the trophy wall.
 * Both are pure functions of scroll progress (or of a short one-shot tween on
 * touch), so the scene applies them as RENDER-TIME offsets on top of the drift
 * sim and never writes them into body state: a cut jump or a scroll back up
 * lands on exactly the same frame.
 *
 * It lives here, not in HobbiesScene.tsx, so Other.tsx can drive it without
 * pulling three / R3F out of the lazy scene chunk, and so the values exist
 * before the canvas mounts (a late mount picks them up on its first frame).
 * `window.__hobbies` mirrors it for the acceptance probes and smoke.
 */
export interface HobbiesMotion {
  /** 0..1 zero-g arrival (1 = props at home). */
  arrival: number;
  /** 0..1 door parting (0 = closed). */
  doors: number;
  /** Rise depth as a fraction of the visible half-height: 1.3 on the scroll-linked
   *  desktop seam, 0.9 on the touch one-shot (a shorter, quicker lift). */
  depthK: number;
  /** World depth of the rise (depthK x visible half-height), written by the scene. */
  D: number;
  /** Per-body wave rank 0..1 (left to right), written by the scene per arrangement. */
  ranks: number[];
  /** Largest current downward offset (world units): debug / acceptance only. */
  maxYOffset: number;
}

export const hobbiesMotion: HobbiesMotion = {
  arrival: 1,
  doors: 0,
  depthK: 1.3,
  D: 0,
  // The leftmost and rightmost props always exist, so these two ranks bound the
  // wave until the scene reports the real ten.
  ranks: [0, 1],
  maxYOffset: 0,
};

// Wave timing: each prop's rise spans 65% of the seam and starts 35% x its
// rank in, so the left edge leads and the right edge lands last, together at 1.
const WAVE_LAG = 0.35;
const WAVE_SPAN = 0.65;
// Each prop eases in on outBackSoft (seams/curves: overshoot <= 1.06), so the
// props settle with a tiny bob, never a bounce.
/** This prop's own arrival progress (0..1) at seam arrival `arrival`. */
export function arrivalOf(rank: number, arrival: number): number {
  return seg(arrival, WAVE_LAG * rank, WAVE_LAG * rank + WAVE_SPAN);
}

/** Downward lift of a prop as a fraction of D: 1 = a full D below home, 0 = home
 *  (slightly negative through the soft overshoot). Pure. */
export function liftOf(rank: number, arrival: number): number {
  return 1 - outBackSoft(arrivalOf(rank, arrival));
}

let wake: (() => void) | null = null;
/** The scene registers its demand-loop invalidate here (null on unmount). */
export function setHobbiesWake(f: (() => void) | null): void {
  wake = f;
}

/** Recompute the debug mirror (maxYOffset) from the current values. Pure
 *  bookkeeping: no wake, so the scene may call it from inside a frame. */
export function refreshHobbiesMirror(): void {
  const m = hobbiesMotion;
  let max = -Infinity;
  for (const r of m.ranks) max = Math.max(max, liftOf(r, m.arrival));
  m.maxYOffset = m.D * max;
}

/** Arrival / doors changed: refresh the mirror and wake the demand loop
 *  (frameloop='demand' draws nothing on its own, so every change must ask). */
export function hobbiesChanged(): void {
  refreshHobbiesMirror();
  wake?.();
}

if (typeof window !== "undefined") {
  (window as Window & { __hobbies?: HobbiesMotion }).__hobbies = hobbiesMotion;
}
