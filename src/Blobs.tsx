/**
 * Slow-drifting ambient blob field in the off-white surround. Each
 * blob is a heavily-blurred radial gradient on its own absolutely-
 * positioned div, given a long-period CSS keyframe animation that
 * translates it around its anchor point. Five blobs at varying
 * sizes / colours / periods give the background a constant subtle
 * motion without ever locking into a recognisable pattern.
 *
 * Stacking order:
 *   wrapper bg (off-white)
 *   Blobs (this)                      ← first wrapper child
 *   SignatureCanvas
 *   PaintTrail canvas
 *   R3F canvas (room)
 *   HUD
 *
 * pointer-events off — purely decorative, the cursor passes through.
 */

interface BlobConfig {
  /** Radial-gradient inner colour. Outer is fully transparent. */
  color: string;
  /** Square size in viewport-width units, e.g. "32vw". */
  size: string;
  /** Anchor position; the animation translates around this. */
  top: string;
  left: string;
  /** keyframes name (declared in the inline <style> below). */
  animation: string;
  /** Animation duration, in seconds. Long → reads as drift, not motion. */
  durationSec: number;
  /** Negative delay so the field isn't synchronised at mount. */
  delaySec: number;
  /** 0..1 base opacity for the blob's centre. */
  opacity: number;
}

// Bauhaus warm palette — primary cat-icon orange, lighter peach, deeper
// rust, plus two off-tones for variation. Kept inside the orange family
// (no greens, no purples) so the blob field reads as one coherent warm
// wash rather than a rainbow.
const BLOBS: BlobConfig[] = [
  {
    color: "rgba(255, 120, 66, 0.55)",
    size: "38vw",
    top: "8%",
    left: "10%",
    animation: "blob-drift-a",
    durationSec: 34,
    delaySec: 0,
    opacity: 1,
  },
  {
    color: "rgba(255, 176, 119, 0.6)",
    size: "32vw",
    top: "55%",
    left: "62%",
    animation: "blob-drift-b",
    durationSec: 42,
    delaySec: -8,
    opacity: 1,
  },
  {
    color: "rgba(255, 140, 80, 0.45)",
    size: "44vw",
    top: "60%",
    left: "5%",
    animation: "blob-drift-c",
    durationSec: 38,
    delaySec: -16,
    opacity: 1,
  },
  {
    color: "rgba(220, 100, 50, 0.40)",
    size: "26vw",
    top: "12%",
    left: "70%",
    animation: "blob-drift-d",
    durationSec: 30,
    delaySec: -22,
    opacity: 1,
  },
  {
    color: "rgba(255, 200, 140, 0.55)",
    size: "30vw",
    top: "35%",
    left: "38%",
    animation: "blob-drift-e",
    durationSec: 46,
    delaySec: -5,
    opacity: 0.8,
  },
];

const KEYFRAMES = `
@keyframes blob-drift-a {
  0%   { transform: translate3d(0, 0, 0); }
  25%  { transform: translate3d(8vw, -4vw, 0); }
  50%  { transform: translate3d(-3vw, 6vw, 0); }
  75%  { transform: translate3d(-7vw, -3vw, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
@keyframes blob-drift-b {
  0%   { transform: translate3d(0, 0, 0); }
  33%  { transform: translate3d(-9vw, 5vw, 0); }
  66%  { transform: translate3d(6vw, -7vw, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
@keyframes blob-drift-c {
  0%   { transform: translate3d(0, 0, 0); }
  40%  { transform: translate3d(5vw, -8vw, 0); }
  70%  { transform: translate3d(-4vw, 4vw, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
@keyframes blob-drift-d {
  0%   { transform: translate3d(0, 0, 0); }
  30%  { transform: translate3d(-6vw, -4vw, 0); }
  60%  { transform: translate3d(4vw, 6vw, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
@keyframes blob-drift-e {
  0%   { transform: translate3d(0, 0, 0); }
  50%  { transform: translate3d(7vw, 5vw, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
`;

export function Blobs() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <style>{KEYFRAMES}</style>
      {BLOBS.map((b, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: b.top,
            left: b.left,
            width: b.size,
            height: b.size,
            background: `radial-gradient(circle, ${b.color} 0%, rgba(0,0,0,0) 65%)`,
            // Heavy blur + low opacity = soft ambient colour wash. Without
            // the blur the gradient still reads but it looks like a
            // graphic disc rather than a cloud of colour.
            filter: "blur(60px)",
            opacity: b.opacity,
            // ease-in-out so the motion has natural pauses at extremes,
            // not constant linear drift.
            animation: `${b.animation} ${b.durationSec}s ease-in-out ${b.delaySec}s infinite`,
            willChange: "transform",
          }}
        />
      ))}
    </div>
  );
}
