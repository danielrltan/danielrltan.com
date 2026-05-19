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
  // Default cache semantics: lets the browser revalidate per its normal
  // policy. force-cache made dev iteration painful — even after rebaking
  // wireframes.json, the browser served a stale cached copy and skipped
  // the network request entirely. Standard `fetch()` with no cache
  // option respects Cache-Control headers Vite/the CDN sends.
  cached = fetch("/wireframes.json")
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
