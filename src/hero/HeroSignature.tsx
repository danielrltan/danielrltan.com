import { useEffect, useState } from "react";
import { HeroSignature2D } from "./HeroSignature2D";
import { HeroSignature3D } from "./HeroSignature3D";
import { type SignatureData } from "./signatureGeometry";
import { useAssembly } from "../loading";
import "./hero-composition.css";

/**
 * Hero composition — the full landing scene. Replaces the
 * standalone 3D signature with an editorial composition:
 *
 *   ┌─ 00 / hero —————————————————────────────────────────────────┐
 *   │                                                              │
 *   │   D A N I E L                                                │
 *   │           R . L . T A N .                                    │
 *   │       [3D signature accent, drawn small, sits in the         │
 *   │        negative space between the wordmark lines]            │
 *   │                                                              │
 *   ├──────── ·  software engineer · toronto · ●  2026  ───────────┤
 *   │                                                  scroll ↓    │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Asymmetric stagger between the two wordmark lines + giant scale,
 * with the signature as a kinetic accent. The 3D signature is now
 * supporting, not the entire hero.
 *
 * State machine — same gates as before (signature draws in white on
 * orange during loading, transitions to 3D once assets + draw both
 * done), but the wordmark composition is always present and animates
 * in on the same `settled` trigger.
 */

type Phase = "drawing" | "transition" | "settled";

export function HeroSignature() {
  const [data, setData] = useState<SignatureData | null>(null);
  const [drawingComplete, setDrawingComplete] = useState(false);
  const [phase, setPhase] = useState<Phase>("drawing");
  const assembly = useAssembly();

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

  useEffect(() => {
    if (phase !== "drawing") return;
    if (!drawingComplete) return;
    if (!assembly.climaxReady) return;
    setPhase("transition");
    const t = window.setTimeout(() => setPhase("settled"), 600);
    return () => window.clearTimeout(t);
  }, [phase, drawingComplete, assembly.climaxReady]);

  const twoDOpacity = phase === "drawing" ? 1 : 0;
  const threeDOpacity = phase === "drawing" ? 0 : 1;
  const renderTwoD = phase !== "settled";
  // The composition wrapper is hidden while the white-on-orange
  // signature draw is in progress (during loading). Once the draw
  // completes we crossfade the whole editorial composition in.
  const compositionVisible = phase !== "drawing";

  return (
    <>
      {renderTwoD && (
        <HeroSignature2D
          data={data}
          opacity={twoDOpacity}
          onComplete={() => setDrawingComplete(true)}
        />
      )}
      <div
        className={`hero-composition${compositionVisible ? " is-visible" : ""}`}
        aria-hidden={!compositionVisible}
      >
        <div className="hero-top">
          <span className="hero-eyebrow">00 / Portfolio &nbsp;&middot;&nbsp; 2026</span>
        </div>

        <div className="hero-wordmark-stack">
          <div className="hero-line hero-line-1">
            <span style={{ animationDelay: "0.18s" }}>D</span>
            <span style={{ animationDelay: "0.22s" }}>a</span>
            <span style={{ animationDelay: "0.26s" }}>n</span>
            <span style={{ animationDelay: "0.30s" }}>i</span>
            <span style={{ animationDelay: "0.34s" }}>e</span>
            <span style={{ animationDelay: "0.38s" }}>l</span>
          </div>
          <div className="hero-signature-slot">
            <HeroSignature3D data={data} opacity={threeDOpacity} />
          </div>
          <div className="hero-line hero-line-2">
            <span style={{ animationDelay: "0.50s" }}>T</span>
            <span style={{ animationDelay: "0.54s" }}>a</span>
            <span style={{ animationDelay: "0.58s" }}>n</span>
            <span style={{ animationDelay: "0.62s" }}>.</span>
          </div>
        </div>

        <div className="hero-bottom">
          <div className="hero-rule" aria-hidden />
          <div className="hero-meta">
            <span>Software engineer</span>
            <span className="hero-meta-dot">/</span>
            <span>Toronto, CA</span>
            <span className="hero-meta-dot">/</span>
            <span>Available 2026</span>
          </div>
          <div className="hero-scroll">
            <span className="hero-scroll-label">Scroll</span>
            <span className="hero-scroll-arrow" aria-hidden>
              ↓
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
