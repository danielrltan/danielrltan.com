/**
 * seamBus: tiny, typed, mutable anchors that one scene writes inside its own
 * frame and a seam reads at measure/render time. No React state, no events.
 *
 * Keep it this small (spec §4.6). Cross-scene anchor buses for hobby props,
 * cups or tiles were rejected (§8): they couple scenes frame to frame.
 */
export const seamBus: {
  /** CRT centre (px) relative to .mac-sticky at the landed pose (W2 writes on refresh/land; the relay reads it). */
  crtLocal: { x: number; y: number; w: number } | null;
  /** Last podium build progress (W5 writes; debug only). */
  podiumP: number;
} = { crtLocal: null, podiumP: 0 };
