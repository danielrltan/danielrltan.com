// src/loading/AssemblyHUD.tsx
import { useEffect, useRef, useState } from "react";
import { useWireframeManifest } from "./useWireframeManifest";
import {
  type AssemblyState,
  PHASE_THRESHOLDS,
  POST_CLIMAX_HUD_FADE_MS,
} from "./types";

interface Props {
  state: AssemblyState;
}

export function AssemblyHUD({ state }: Props) {
  const manifest = useWireframeManifest();
  const [resolvedName, setResolvedName] = useState<string>("");
  const lastIndexRef = useRef(-1);

  // Pick the "current" resolved mesh = the highest-index mesh whose
  // phaseStart is ≤ combinedPct. Cycle through them as combinedPct rises.
  useEffect(() => {
    if (!manifest) return;
    const all = manifest.meshes;
    let candidate = -1;
    for (let i = 0; i < all.length; i++) {
      const phaseIdx = all[i]!.phase - 1;
      const lo = PHASE_THRESHOLDS[phaseIdx]!;
      if (state.combinedPct >= lo) candidate = i;
      else break;
    }
    if (candidate !== lastIndexRef.current && candidate >= 0) {
      lastIndexRef.current = candidate;
      setResolvedName(all[candidate]!.name);
    }
  }, [manifest, state.combinedPct]);

  const fading = state.climaxReady;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        // Orange-print loading: cover dome paints frame orange, HUD is
        // white-on-orange for high-contrast spec-sheet legibility.
        background: "transparent",
        color: "#ffffff",
        fontFamily: "var(--font-mono)",
        zIndex: 9999,
        pointerEvents: fading ? "none" : "auto",
        opacity: fading ? 0 : 1,
        transition: `opacity ${POST_CLIMAX_HUD_FADE_MS}ms ease`,
        cursor: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: "11vh",
          transform: "translateX(-50%)",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          width: "min(360px, 70vw)",
        }}
      >
        <div
          style={{
            height: 1,
            background: "rgba(255, 255, 255, 0.32)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${state.combinedPct * 100}%`,
              background: "#ffffff",
              transition: "width 120ms linear",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: "var(--text-xs)",
            letterSpacing: "var(--tracking-wide)",
            textTransform: "uppercase",
            color: "rgba(255, 255, 255, 0.78)",
          }}
        >
          <span>
            resolving{" "}
            <span style={{ color: "#ffffff" }}>· {resolvedName || "scene"}</span>
          </span>
          <span
            style={{
              fontFamily: 'var(--font-dot)',
              color: '#ffffff',
              fontSize: '15px',
              letterSpacing: '0.04em',
              minWidth: '2.5ch',
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {Math.floor(state.combinedPct * 100)}
          </span>
        </div>
      </div>
    </div>
  );
}
