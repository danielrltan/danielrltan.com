// src/loading/AssemblyHUD.tsx
import { useEffect, useRef, useState } from "react";
import { useWireframeManifest } from "./useWireframeManifest";
import {
  type AssemblyState,
  GLB_TOTAL_MB,
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
        background: "#330a05",
        color: "var(--hud-amber)",
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
            background: "rgba(255, 120, 66, 0.18)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${state.combinedPct * 100}%`,
              background: "var(--hud-amber)",
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
            color: "rgba(255, 176, 119, 0.85)",
          }}
        >
          <span>
            resolving{" "}
            <span style={{ color: "var(--hud-amber)" }}>· {resolvedName || "scene"}</span>
          </span>
          <span>
            {state.bytesMB.toFixed(1)} / {GLB_TOTAL_MB} MB
          </span>
        </div>
      </div>
    </div>
  );
}
