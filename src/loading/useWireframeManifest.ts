// src/loading/useWireframeManifest.ts
import { useEffect, useState } from "react";
import type { WireframeManifest } from "./types";

/**
 * Module-level promise so concurrent consumers share one fetch and
 * remounts (e.g. dev HMR) don't re-fetch. Resolves to `null` on
 * network/parse failure — consumers fall back to a no-wireframe HUD.
 */
let cached: Promise<WireframeManifest | null> | null = null;

function fetchManifest(): Promise<WireframeManifest | null> {
  if (cached) return cached;
  cached = fetch("/wireframes.json", { cache: "force-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<WireframeManifest>) : null))
    .catch(() => null);
  return cached;
}

export function useWireframeManifest(): WireframeManifest | null {
  const [data, setData] = useState<WireframeManifest | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchManifest().then((d) => {
      if (!cancelled) setData(d);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return data;
}
