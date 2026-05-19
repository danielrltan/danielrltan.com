import { useEffect } from "react";
import { isSignatureBrushReady, paintSignatureAt } from "./paint";

/**
 * Replays a captured signature through the PaintTrail brush after a
 * trigger fires. Loads `/signature.json` once on mount; if the file
 * isn't present (404) it's a no-op — useful while the JSON hasn't
 * been recorded yet.
 *
 * The recorded events use normalized (nx, ny) ∈ [0, 1] coordinates
 * within the gesture's bounding box. We project those into a target
 * rect: 92% of the viewport width, centered, vertically nudged so the
 * signature reads as "behind the room" (the room sits at viewport
 * centre at the iso pose, so the signature sweeps across the surround
 * around it).
 *
 * Multi-stroke handling: `down` events reset the previous-point
 * tracker so the brush doesn't interpolate across the lift gap; only
 * `move` events stamp paint at the original recorded timestamps.
 */

interface NormalizedEvent {
  type: "down" | "move" | "up";
  t: number;
  nx: number;
  ny: number;
}
interface SignatureJSON {
  totalDuration: number;
  events: NormalizedEvent[];
}

interface Props {
  /** When this flips true, the replay starts (with a small delay). */
  trigger: boolean;
  /** Delay in ms after trigger before kicking off the replay. */
  delayMs?: number;
}

const TARGET_WIDTH_RATIO = 1.15; // GIANT — slightly past viewport edges
const TARGET_ASPECT_LOCK = true;
const VERTICAL_NUDGE = 0;
/** Horizontal shift as a fraction of viewport width. Positive = right. */
const HORIZONTAL_NUDGE_RATIO = 0.04;
const REPLAY_RADIUS_BASE = 60; // mean brush radius; modulated by velocity below
const STEP_PX = 5;
/**
 * Natural-pen size variation. Real pens deposit more ink when moving
 * slowly (the tip dwells in one spot) and less when moving fast (the
 * tip skims). We replicate that by scaling the brush radius inversely
 * with the recorded pointer velocity:
 *   vel ≤ MIN → radius × MAX_MULT  (fat strokes at hesitations / loops)
 *   vel ≥ MAX → radius × MIN_MULT  (thin strokes on fast sweeps)
 *   in between → linear interpolation
 *
 * Velocity is measured in normalized-units / ms (we don't convert to
 * world px because the threshold values are tuned against the recorded
 * gesture's native scale, so this stays viewport-size independent).
 */
// Velocity range calibrated against the recorded signature data.
// Original gesture has typical velocities in the 0.0005–0.008 n.u./ms
// range across its strokes; previous values (0.0002–0.0020) put
// almost everything past VEL_MAX, leaving the entire signature drawn
// with the "fast" alpha knock-down and rendering nearly invisible.
const VEL_MIN = 0.0008; // slow zone — careful loops and hesitations
const VEL_MAX = 0.0100; // fast zone — the t-crossbar sweep
const SIZE_MULT_AT_MIN_VEL = 1.25; // fat
const SIZE_MULT_AT_MAX_VEL = 0.55; // thin
/**
 * Per-stamp alpha multiplier at the velocity extremes. Real pens
 * deposit less ink when sweeping fast — the tip skims rather than
 * sits. Without this, fast strokes (like the crossbar of a "t" drawn
 * with a single fast horizontal sweep) build up to the same density
 * as a slow careful loop and read as a stuck marker.
 */
const ALPHA_MULT_AT_MIN_VEL = 1.0; // full ink at hesitations
const ALPHA_MULT_AT_MAX_VEL = 0.45; // skim / dry-pen on fast sweeps
/**
 * Replay speed multiplier. The recorded gesture takes ~3.4s; at 2.2×
 * it draws in ~1.5s, fast enough to feel like an intentional flourish
 * without losing the rhythmic hesitations between strokes (the lifts
 * still scale proportionally).
 */
const SPEED_MULT = 2.2;

export function SignatureReplay({ trigger, delayMs = 0 }: Props) {
  useEffect(() => {
    if (!trigger) return;
    let cancelled = false;
    let raf = 0;
    let started = false;

    (async () => {
      let sig: SignatureJSON | null = null;
      try {
        const r = await fetch("/signature.json");
        if (!r.ok) return;
        sig = (await r.json()) as SignatureJSON;
      } catch {
        return;
      }
      if (cancelled || !sig) return;

      // Pre-compute target rect from current viewport.
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Bounding box of the normalized signature is always [0,1] x [0,1],
      // but the natural aspect ratio comes from the original capture's
      // bounding box width/height. We don't store that explicitly post-
      // normalization, so derive it from the actual events: nx range is
      // always 0..1 but the displayed aspect depends on the original w/h.
      // Approximate from max nx vs max ny scaled by capture viewport;
      // we baked that into the JSON's bounds before normalizing, so we
      // can recover it by reading from the bounds field at replay time.
      // (See buildJSON in SignatureCapture.)
      // The events alone don't carry aspect → use the bounds from the
      // JSON if present, otherwise assume the gesture was widescreen.
      const bounds = (sig as unknown as {
        bounds?: { minX: number; minY: number; maxX: number; maxY: number };
      }).bounds;
      const captureW = bounds ? bounds.maxX - bounds.minX : 1000;
      const captureH = bounds ? bounds.maxY - bounds.minY : 300;
      const aspect = captureW / Math.max(1, captureH);

      let targetW = vw * TARGET_WIDTH_RATIO;
      let targetH = TARGET_ASPECT_LOCK ? targetW / aspect : vh * 0.5;
      // Don't let the signature exceed 80% of viewport height — even at
      // 92% width, a tall signature would clip the top/bottom edges.
      const maxH = vh * 0.8;
      if (targetH > maxH) {
        targetH = maxH;
        targetW = targetH * aspect;
      }
      const x0 = (vw - targetW) / 2 + vw * HORIZONTAL_NUDGE_RATIO;
      const y0 = (vh - targetH) / 2 + VERTICAL_NUDGE;

      const projectX = (nx: number) => x0 + nx * targetW;
      const projectY = (ny: number) => y0 + ny * targetH;

      const startWhenReady = () => {
        if (started || cancelled) return;
        if (!isSignatureBrushReady()) {
          // PaintTrail may mount a frame after us; retry next rAF.
          raf = requestAnimationFrame(startWhenReady);
          return;
        }
        started = true;
        const startWallMs = performance.now() + delayMs;
        let nextIdx = 0;
        let lastX: number | null = null;
        let lastY: number | null = null;
        // Track the previous event's normalized coords + timestamp so
        // we can compute the original signing velocity and modulate
        // brush size like a real pen.
        let prevNx = 0;
        let prevNy = 0;
        let prevT = 0;
        let hasPrev = false;

        // Maps event-local velocity in n.u./ms to a 0..1 fast-ness
        // factor (clamped, linear between VEL_MIN and VEL_MAX). Both
        // brush radius and per-stamp alpha are interpolated against
        // this same factor so the variations move together.
        const velocityFactor = (vel: number): number =>
          Math.max(0, Math.min(1, (vel - VEL_MIN) / (VEL_MAX - VEL_MIN)));
        const velocityRadius = (factor: number): number =>
          REPLAY_RADIUS_BASE *
          (SIZE_MULT_AT_MIN_VEL +
            (SIZE_MULT_AT_MAX_VEL - SIZE_MULT_AT_MIN_VEL) * factor);
        const velocityAlpha = (factor: number): number =>
          ALPHA_MULT_AT_MIN_VEL +
          (ALPHA_MULT_AT_MAX_VEL - ALPHA_MULT_AT_MIN_VEL) * factor;

        const tick = () => {
          if (cancelled || !sig) return;
          const elapsed = (performance.now() - startWallMs) * SPEED_MULT;
          if (elapsed < 0) {
            raf = requestAnimationFrame(tick);
            return;
          }
          while (
            nextIdx < sig.events.length &&
            sig.events[nextIdx]!.t <= elapsed
          ) {
            const ev = sig.events[nextIdx]!;
            const px = projectX(ev.nx);
            const py = projectY(ev.ny);

            // Velocity in n.u./ms from the previously-recorded event.
            // Drives both brush size AND per-stamp alpha: slow strokes
            // are fat + saturated (hesitating pen, lots of ink); fast
            // strokes are thin + light (skimming pen, dry-ink look).
            let radius = REPLAY_RADIUS_BASE;
            let alphaMult = 1;
            if (hasPrev && ev.type !== "down") {
              const dnx = ev.nx - prevNx;
              const dny = ev.ny - prevNy;
              const ddt = Math.max(1, ev.t - prevT);
              const vel = Math.hypot(dnx, dny) / ddt;
              const f = velocityFactor(vel);
              radius = velocityRadius(f);
              alphaMult = velocityAlpha(f);
            }

            if (ev.type === "down") {
              lastX = px;
              lastY = py;
              paintSignatureAt(px, py, radius, alphaMult);
            } else if (ev.type === "move") {
              if (lastX != null && lastY != null) {
                const dx = px - lastX;
                const dy = py - lastY;
                const dist = Math.hypot(dx, dy);
                const steps = Math.max(1, Math.ceil(dist / STEP_PX));
                for (let i = 1; i <= steps; i++) {
                  const t = i / steps;
                  paintSignatureAt(
                    lastX + dx * t,
                    lastY + dy * t,
                    radius,
                    alphaMult,
                  );
                }
              } else {
                paintSignatureAt(px, py, radius, alphaMult);
              }
              lastX = px;
              lastY = py;
            } else if (ev.type === "up") {
              // Lift the pen — break the interpolation chain so the
              // next "down" starts fresh.
              lastX = null;
              lastY = null;
            }

            prevNx = ev.nx;
            prevNy = ev.ny;
            prevT = ev.t;
            hasPrev = true;
            nextIdx++;
          }
          if (nextIdx < sig.events.length) {
            raf = requestAnimationFrame(tick);
          }
        };
        raf = requestAnimationFrame(tick);
      };

      raf = requestAnimationFrame(startWhenReady);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [trigger, delayMs]);

  return null;
}
