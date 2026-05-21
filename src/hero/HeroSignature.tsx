import { useEffect, useState } from "react";
import { HeroSignature2D } from "./HeroSignature2D";
import { HeroSignature3D } from "./HeroSignature3D";
import { type SignatureData } from "./signatureGeometry";
import { useAssembly } from "../loading";

/**
 * Hero signature orchestrator — replaces the wireframe loading screen.
 *
 * State machine:
 *   drawing    — 2D canvas drawing the signature in white on orange.
 *                The orange background comes from the wrapper's
 *                `loading-active` CSS; this component itself only
 *                renders the strokes.
 *   transition — drawing complete AND assets loaded. 2D fades out,
 *                3D fades in. Loading-active is removed by
 *                AssemblyController as soon as the assembly state's
 *                `climaxDone` flips (we treat that as our "ready"
 *                signal).
 *   settled    — only the 3D signature is rendered. Cursor parallax +
 *                cursor-tracked point light run continuously.
 */

type Phase = "drawing" | "transition" | "settled";

export function HeroSignature() {
  const [data, setData] = useState<SignatureData | null>(null);
  const [drawingComplete, setDrawingComplete] = useState(false);
  const [phase, setPhase] = useState<Phase>("drawing");
  const assembly = useAssembly();

  // Fetch signature.json once.
  useEffect(() => {
    let cancelled = false;
    fetch("/signature.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setData(d as SignatureData);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Trigger the crossfade when (a) the 2D draw finished AND (b) the
  // loader says we're ready. Both gates required so a cached-asset
  // load doesn't snap to 3D before the signature finishes drawing,
  // and a slow asset load doesn't strand the user on a completed 2D
  // canvas with nothing to do.
  useEffect(() => {
    if (phase !== "drawing") return;
    if (!drawingComplete) return;
    if (!assembly.climaxReady) return;
    setPhase("transition");
    // Crossfade duration matches the CSS transition on the 2D / 3D
    // wrappers. After the fade, drop the 2D canvas entirely.
    const t = window.setTimeout(() => setPhase("settled"), 600);
    return () => window.clearTimeout(t);
  }, [phase, drawingComplete, assembly.climaxReady]);

  const twoDOpacity = phase === "drawing" ? 1 : 0;
  const threeDOpacity = phase === "drawing" ? 0 : 1;
  const renderTwoD = phase !== "settled";

  return (
    <>
      {renderTwoD && (
        <HeroSignature2D
          data={data}
          opacity={twoDOpacity}
          onComplete={() => setDrawingComplete(true)}
        />
      )}
      <HeroSignature3D data={data} opacity={threeDOpacity} />
    </>
  );
}
