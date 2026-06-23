import { useEffect, useState } from "react";
import { eventsToStrokes, type SignatureData } from "./hero/signatureGeometry";

/**
 * The captured signature as a crisp VECTOR mark.
 *
 * Unlike the hero/footer signature canvases (which stamp a raster brush and
 * have to rescale the brush radius per viewport to avoid going chunky), this
 * renders the gesture as an inline <svg> <path>. The stroke width is expressed
 * in viewBox units (a FRACTION of the gesture's height), with NO
 * `vector-effect: non-scaling-stroke` — so the stroke scales WITH the element.
 * The signature therefore looks identical at 22px and 220px: the
 * stroke-to-letterform ratio is fixed, and it never breaks up or fattens on
 * small screens. This is the fix for "the signature stroke isn't fixed / looks
 * chunky + broken on smaller platforms".
 *
 * Used for the top-left brand mark (replacing the old cat) and reusable
 * anywhere a static, scalable signature is wanted.
 */

// Module-cached parsed path so every instance shares ONE fetch + parse.
type SigPath = { d: string; aspect: number };
let cached: SigPath | null = null;
let inflight: Promise<SigPath | null> | null = null;

function buildPath(data: SignatureData): SigPath {
  const b = data.bounds ?? { minX: 0, minY: 0, maxX: 1000, maxY: 384 };
  const aspect = (b.maxX - b.minX) / Math.max(1, b.maxY - b.minY);
  // Each pen-down→pen-up window is its own sub-path (so the dot on an "i" or a
  // lifted letter stays disconnected). Coords are normalized 0..1; X is scaled
  // by the aspect so a `0 0 aspect 1` viewBox keeps the true proportions.
  const d = eventsToStrokes(data.events)
    .map((s) =>
      s.points
        .map(
          (p, i) =>
            `${i === 0 ? "M" : "L"}${(p.x * aspect).toFixed(4)} ${p.y.toFixed(4)}`,
        )
        .join(" "),
    )
    .join(" ");
  return { d, aspect };
}

async function loadSignature(): Promise<SigPath | null> {
  if (cached) return cached;
  if (!inflight) {
    inflight = (async () => {
      try {
        const r = await fetch("/signature.json");
        if (!r.ok) return null;
        cached = buildPath((await r.json()) as SignatureData);
        return cached;
      } catch {
        return null;
      }
    })();
  }
  return inflight;
}

interface Props {
  /** Rendered height in CSS px; width derives from the signature's aspect. */
  height: number;
  /** Stroke thickness as a fraction of the viewBox height (1.0). Scales with
   *  the rendered size → constant stroke-to-letterform ratio at every size. */
  strokeRatio?: number;
  className?: string;
}

export function SignatureMark({ height, strokeRatio = 0.052, className }: Props) {
  const [path, setPath] = useState<SigPath | null>(cached);
  useEffect(() => {
    if (path) return;
    let alive = true;
    void loadSignature().then((p) => {
      if (alive) setPath(p);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  if (!path) {
    // Reserve the signature's footprint while the gesture loads so the brand
    // mark doesn't reflow when it lands.
    return (
      <span
        className={className}
        style={{ display: "block", height, width: height * 2.6 }}
        aria-hidden="true"
      />
    );
  }

  return (
    <svg
      className={className}
      viewBox={`0 0 ${path.aspect.toFixed(4)} 1`}
      style={{ height, width: "auto", display: "block", overflow: "visible" }}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeRatio}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path.d} />
    </svg>
  );
}
