import { useEffect, useRef } from "react";
import { MQ, matches } from "../../motion";
import { heroState } from "../heroState";
import type { SignatureData } from "../signatureGeometry";
import type { SigBox } from "./layout";
import { SignatureHero } from "./signatureHero";

/**
 * Mounts the WebGL signature hero (signatureHero.ts). Lazy-loaded by
 * HeroSignature, so three.js stays off the first-paint path; the static
 * fallback (low tier / reduced motion) never loads it at all.
 */
interface Props {
  data: SignatureData;
  /** True once the loader lifts: the signature starts drawing itself in. */
  start: boolean;
  onLayout: (box: SigBox) => void;
}

// Read once: the sim + DPR budgets are baked in at mount (as the old ring did).
const COARSE = matches(MQ.compact) || !matches(MQ.finePointer);

/** The hero is the resting screen: not covered, not diving into About. */
function heroActive(): boolean {
  return (
    !heroState.culled &&
    !document.hidden &&
    !document.documentElement.hasAttribute("data-hero-diving")
  );
}

export default function HeroSigScene({ data, start, onLayout }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<SignatureHero | null>(null);
  const layoutRef = useRef(onLayout);
  layoutRef.current = onLayout;

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const scene = new SignatureHero({
      host,
      canvas,
      data,
      coarse: COARSE,
      onLayout: (box) => layoutRef.current(box),
      shouldRender: () => !heroState.culled && !document.hidden,
      isActive: heroActive,
    });
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [data]);

  useEffect(() => {
    if (start) sceneRef.current?.start();
  }, [start, data]);

  return (
    <div className="hero-sig-stage" ref={hostRef} aria-hidden>
      <canvas className="hero-sig-canvas" ref={canvasRef} />
    </div>
  );
}
