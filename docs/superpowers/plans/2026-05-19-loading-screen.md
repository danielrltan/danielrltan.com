# Loading screen (self-assembling room) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `src/LoadingScreen.tsx` (blinking-cat overlay) with a self-assembling-room loader: amber wireframe AABBs from a baked manifest snap into place in 5 spatial waves while `room.glb` streams in, then scaffolding falls away to reveal the textured scene at the iso pose.

**Architecture:**
1. **Build step** (`scripts/bake-wireframes.mjs`): converts `data/scene_manifest.json` (a copy of Daniel's Blender export) → `public/wireframes.json` (a small file containing per-mesh `{name, center, half, phase}` in three.js Y-up coordinates). Wired into `predev`/`prebuild`.
2. **Runtime** (`src/loading/`): an `AssemblyController` orchestrates a `WireframeRoom` (R3F line segments inside the existing Canvas, outside the `<Suspense fallback={null}>` so they render while the GLB streams) and an `AssemblyHUD` (DOM bar + counter + cycling status line). Two hooks aggregate timeline + bytes + frame-stability signals. The climax fades wireframes out as the real `<Room />` mounts behind them.
3. **App integration:** `src/App.tsx` swaps `<LoadingScreen />` for the new components.

**Tech Stack:** TypeScript, React 19, R3F, drei (`useProgress`), three.js `LineBasicMaterial`, vanilla Node ESM for the bake script (no new deps).

**Spec:** `docs/superpowers/specs/2026-05-19-loading-screen-design.md`

---

## File Structure

**Create:**
- `data/scene_manifest.json` — copy of Daniel's Blender manifest, committed to repo (~30 kB).
- `scripts/bake-wireframes.mjs` — Node ESM script, runs at `predev`/`prebuild`.
- `public/wireframes.json` — generated artifact, committed.
- `src/loading/types.ts` — shared types (`WireframeMesh`, `WireframeManifest`, `AssemblyState`).
- `src/loading/useWireframeManifest.ts` — fetches `/wireframes.json` once, module-level promise cache.
- `src/loading/useAssemblyProgress.ts` — RAF-driven aggregator of timeline + drei `useProgress` + frame-stability. Emits React state at ~10 Hz.
- `src/loading/WireframeRoom.tsx` — R3F `<lineSegments>` per manifest entry. Owns its own per-mesh pop-in animation.
- `src/loading/AssemblyHUD.tsx` — DOM overlay: hairline bar + bytes counter + cycling `resolving · <name>` line.
- `src/loading/AssemblyController.tsx` — composes the two; gates them on `AssemblyState`; runs the climax handoff.
- `src/loading/index.ts` — barrel.

**Modify:**
- `src/App.tsx` — remove `LoadingScreen` import + `<LoadingScreen />`; add `<AssemblyController>` wrapping `<AssemblyHUD>` outside the Canvas and `<WireframeRoom>` inside the Canvas (sibling of the loading-Suspense, NOT inside it).
- `package.json` — add `predev` and `prebuild` scripts.

**Delete:**
- `src/LoadingScreen.tsx` (after verifying nothing else imports it).

**Untouched:**
- `index.html` `#boot-screen` (still bridges the JS-parse gap).
- `index.css` `html.loading-active .moveable-cursor` rule (controller adds/removes the class).
- IntroController, Room, MoveableCursor, all post-load behavior.
- `public/images/cat.svg`, `cat_blink.svg` (still used as favicon — leave them).

---

## Task 1: Stage manifest in repo

**Files:**
- Create: `data/scene_manifest.json` (copied from `C:\Users\Daniel\Documents\WEBSITEROOM\scene_manifest.json`)
- Modify: `.gitignore` (only if `data/` is already excluded — verify first)

- [ ] **Step 1.1: Copy the manifest into the repo**

```bash
mkdir -p data
cp "C:/Users/Daniel/Documents/WEBSITEROOM/scene_manifest.json" data/scene_manifest.json
```

- [ ] **Step 1.2: Verify it's in tracked location and not gitignored**

```bash
git check-ignore data/scene_manifest.json && echo "GITIGNORED — fix .gitignore" || echo "OK — tracked"
ls -lh data/scene_manifest.json
```

Expected: `OK — tracked` and a file size in the tens of kB.

- [ ] **Step 1.3: Commit**

```bash
git add data/scene_manifest.json
git commit -m "data: stage Blender scene manifest in repo for build-time bake"
```

---

## Task 2: Write the bake script

**Files:**
- Create: `scripts/bake-wireframes.mjs`

The script reads `data/scene_manifest.json`, converts Blender Z-up coordinates to three.js Y-up, classifies each mesh into one of 5 phases by name, and emits `public/wireframes.json`.

- [ ] **Step 2.1: Create the script**

```javascript
// scripts/bake-wireframes.mjs
//
// Reads the Blender scene manifest, converts each entry into a
// three.js-coordinates wireframe descriptor, classifies it into one of
// 5 spatial assembly phases by name, and writes public/wireframes.json.
//
// Runs at `predev` and `prebuild`. Output is committed to git so dev
// servers don't need to re-bake on every clone.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const SRC = resolve(REPO_ROOT, "data/scene_manifest.json");
const DST = resolve(REPO_ROOT, "public/wireframes.json");

// Phase 1: floor + walls + room shell
// Phase 2: large furniture (bed, desk, shelf, dresser, lamp poles)
// Phase 3: electronics + on-desk hardware (monitor, keyboard, PC)
// Phase 4: interactive / mid-size props (clk_*, dr_*, th_*)
// Phase 5: decor + detail (posters, vinyl, mushroom bulbs, plushies)
const PHASE_RULES = [
  {
    phase: 1,
    test: (n) =>
      n === "floor" ||
      n === "wallpanel" ||
      n.startsWith("wall_") ||
      n === "windowsill" ||
      n === "curtains" ||
      n === "rug_main",
  },
  {
    phase: 2,
    test: (n) =>
      n === "desk" ||
      n === "shelf" ||
      n === "dresser" ||
      n === "headboard" ||
      n === "bed_blanket" ||
      n.startsWith("bed_") ||
      n.startsWith("desk_") ||
      n.startsWith("dresser_") ||
      n === "floor_lamp" ||
      n === "chair",
  },
  {
    phase: 3,
    test: (n) =>
      n.startsWith("monitor_") ||
      n.startsWith("keyboard_") ||
      n.startsWith("pc_") ||
      n.startsWith("clk_monitor") ||
      n === "screen" ||
      n === "mousepad_static",
  },
  {
    phase: 4,
    test: (n) =>
      n.startsWith("clk_") ||
      n.startsWith("dr_") ||
      n.startsWith("th_") ||
      n.startsWith("board_"),
  },
  { phase: 5, test: () => true }, // catch-all (posters, vinyl, decor)
];

function phaseFor(name) {
  for (const r of PHASE_RULES) if (r.test(name)) return r.phase;
  return 5;
}

// Blender (Z-up, right-handed) → three.js (Y-up, right-handed):
//   blender (x, y, z) → three (x, z, -y)
// Sizes (dimensions) are positive in all axes; they swap the same way:
//   blender (dx, dy, dz) → three (dx, dz, dy)
function blenderPosToThree([x, y, z]) {
  return [x, z, -y];
}
function blenderSizeToThree([dx, dy, dz]) {
  return [dx, dz, dy];
}

// Names we never want as wireframes. These are NOT in the loaded scene
// from Blender's perspective (key_*), or are scaffolding-only objects
// (sun_target), or render as a single tiny box that adds clutter.
const SKIP_EXACT = new Set([
  "sun_target",
  "mushroom_bulb_1",
  "mushroom_bulb_2",
  "mushroom_bulb_3",
  "mushroom_bulb_4",
]);
const SKIP_PREFIXES = ["key_", "light_"];

function shouldSkip(name) {
  if (SKIP_EXACT.has(name)) return true;
  return SKIP_PREFIXES.some((p) => name.startsWith(p));
}

function main() {
  const manifest = JSON.parse(readFileSync(SRC, "utf8"));
  const collection = manifest.collections?.["Scene Collection"];
  if (!Array.isArray(collection)) {
    throw new Error(
      `Expected manifest.collections["Scene Collection"] array, got ${typeof collection}`,
    );
  }

  const meshes = [];
  for (const entry of collection) {
    if (!entry?.name || !entry.world_loc || !entry.dimensions) continue;
    if (shouldSkip(entry.name)) continue;
    const center = blenderPosToThree(entry.world_loc).map((v) =>
      Number(v.toFixed(4)),
    );
    const dims = blenderSizeToThree(entry.dimensions);
    const half = dims.map((d) => Number((d / 2).toFixed(4)));
    if (half.some((h) => h <= 0)) continue;
    meshes.push({
      name: entry.name,
      center,
      half,
      phase: phaseFor(entry.name),
    });
  }

  // Stable sort: phase ascending, name alphabetical within phase.
  // Determinism keeps the committed JSON diff-minimal across re-runs.
  meshes.sort((a, b) => a.phase - b.phase || a.name.localeCompare(b.name));

  const out = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceSha: manifest.export_hash ?? null,
    meshes,
  };

  mkdirSync(dirname(DST), { recursive: true });
  writeFileSync(DST, JSON.stringify(out, null, 2) + "\n");

  const byPhase = meshes.reduce((acc, m) => {
    acc[m.phase] = (acc[m.phase] || 0) + 1;
    return acc;
  }, {});
  console.log(`Wrote ${meshes.length} meshes to ${DST}`);
  console.log("  by phase:", byPhase);
}

main();
```

- [ ] **Step 2.2: Run the script**

```bash
node scripts/bake-wireframes.mjs
```

Expected output:
- `Wrote N meshes to E:\Documents\portfolioweb\public\wireframes.json` (N is roughly 100–140; the manifest has 162 entries but we skip `key_*` and `light_*`)
- `by phase: { '1': ..., '2': ..., '3': ..., '4': ..., '5': ... }` with no phase empty.

- [ ] **Step 2.3: Spot-check the JSON**

```bash
node -e "const m=require('./public/wireframes.json'); console.log('total:',m.meshes.length); console.log('first:',JSON.stringify(m.meshes[0],null,2)); console.log('phases:',[...new Set(m.meshes.map(x=>x.phase))].sort());"
```

Expected:
- `total: 100`-ish
- A `first:` block with `name`, `center` (3 floats), `half` (3 positive floats), `phase` (1–5).
- `phases: [1, 2, 3, 4, 5]` (all five present).

- [ ] **Step 2.4: Commit**

```bash
git add scripts/bake-wireframes.mjs public/wireframes.json
git commit -m "build: bake wireframes.json from scene manifest"
```

---

## Task 3: Wire bake into npm scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 3.1: Add `predev` and `prebuild` scripts**

In `package.json`, the `"scripts"` object currently contains:
```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "typecheck": "tsc -b"
}
```

Replace with:
```json
"scripts": {
  "bake-wireframes": "node scripts/bake-wireframes.mjs",
  "predev": "npm run bake-wireframes",
  "prebuild": "npm run bake-wireframes",
  "dev": "vite",
  "build": "tsc -b && vite build",
  "preview": "vite preview",
  "typecheck": "tsc -b"
}
```

- [ ] **Step 3.2: Verify the hook fires**

```bash
npm run dev
```

Expected:
- First lines of output include `> portfolioweb@0.0.0 predev` and `Wrote N meshes to .../public/wireframes.json`
- Vite then starts as normal. Kill it with Ctrl-C.

- [ ] **Step 3.3: Commit**

```bash
git add package.json
git commit -m "build: bake wireframes on predev and prebuild"
```

---

## Task 4: Shared types

**Files:**
- Create: `src/loading/types.ts`

- [ ] **Step 4.1: Create the file**

```typescript
// src/loading/types.ts

export interface WireframeMesh {
  name: string;
  center: [number, number, number];
  half: [number, number, number];
  /** 1..5 — spatial assembly wave this mesh belongs to. */
  phase: number;
}

export interface WireframeManifest {
  version: number;
  generatedAt: string;
  sourceSha: string | null;
  meshes: WireframeMesh[];
}

export interface AssemblyState {
  /** 0..1 — driven by Date.now() since mount, paused while tab hidden. */
  timelinePct: number;
  /** 0..1 — bytes / total. Stays at 1 once load completes. */
  bytePct: number;
  /** min(timelinePct, bytePct) — what the visible bar shows. */
  combinedPct: number;
  /** 1..5 — current spatial phase. Derived from combinedPct via THRESHOLDS. */
  phase: number;
  /** Total bytes streamed so far (rounded to 0.1 MB for display). */
  bytesMB: number;
  /** True once timeline finished AND assets ready AND 30 stable frames. */
  climaxReady: boolean;
  /** True once the climax fade has fully completed (wireframes gone). */
  climaxDone: boolean;
}

export const TIMELINE_FLOOR_MS = 2400;
export const STABLE_FRAMES_REQUIRED = 30;
export const STABLE_FRAME_BUDGET_MS = 22;
export const CLIMAX_DURATION_MS = 400;
export const POST_CLIMAX_HUD_FADE_MS = 320;
/** GLB size in MB — display-only. Real bytes come from useProgress. */
export const GLB_TOTAL_MB = 27.4;
/** combinedPct thresholds that unlock each phase. Index = phase - 1. */
export const PHASE_THRESHOLDS = [0.0, 0.15, 0.4, 0.6, 0.8];
```

- [ ] **Step 4.2: Type-check**

```bash
npm run typecheck
```

Expected: completes with no errors.

- [ ] **Step 4.3: Commit**

```bash
git add src/loading/types.ts
git commit -m "loading: shared types + tuning constants"
```

---

## Task 5: Manifest hook

**Files:**
- Create: `src/loading/useWireframeManifest.ts`

- [ ] **Step 5.1: Create the hook**

```typescript
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
```

- [ ] **Step 5.2: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add src/loading/useWireframeManifest.ts
git commit -m "loading: useWireframeManifest hook"
```

---

## Task 6: Progress hook

**Files:**
- Create: `src/loading/useAssemblyProgress.ts`

This hook is the orchestration brain. It runs one RAF loop, computes `AssemblyState` every frame internally via refs, and pushes a React state update at most every 100ms (or on phase change / climax flip). That cadence is plenty for DOM consumers and avoids re-rendering R3F on every frame.

- [ ] **Step 6.1: Create the hook**

```typescript
// src/loading/useAssemblyProgress.ts
import { useEffect, useRef, useState } from "react";
import { useProgress } from "@react-three/drei";
import {
  type AssemblyState,
  CLIMAX_DURATION_MS,
  GLB_TOTAL_MB,
  PHASE_THRESHOLDS,
  POST_CLIMAX_HUD_FADE_MS,
  STABLE_FRAMES_REQUIRED,
  STABLE_FRAME_BUDGET_MS,
  TIMELINE_FLOOR_MS,
} from "./types";

const STATE_UPDATE_INTERVAL_MS = 100;

function derivePhase(combinedPct: number): number {
  for (let i = PHASE_THRESHOLDS.length - 1; i >= 0; i--) {
    if (combinedPct >= PHASE_THRESHOLDS[i]!) return i + 1;
  }
  return 1;
}

export function useAssemblyProgress(): AssemblyState {
  const { progress, active } = useProgress();

  // Mirror drei values into refs so the RAF loop reads fresh values
  // without re-subscribing on every render.
  const progressRef = useRef(progress);
  const activeRef = useRef(active);
  progressRef.current = progress;
  activeRef.current = active;

  const [state, setState] = useState<AssemblyState>({
    timelinePct: 0,
    bytePct: 0,
    combinedPct: 0,
    phase: 1,
    bytesMB: 0,
    climaxReady: false,
    climaxDone: false,
  });

  const startRef = useRef(performance.now());
  const pausedAtRef = useRef<number | null>(null);
  const pausedTotalRef = useRef(0);
  const stableFramesRef = useRef(0);
  const lastFrameRef = useRef(performance.now());
  const lastEmitRef = useRef(0);
  const lastPhaseRef = useRef(1);
  const lastClimaxReadyRef = useRef(false);
  const lastClimaxDoneRef = useRef(false);
  const climaxStartRef = useRef<number | null>(null);

  // Pause timeline while tab is hidden. Bytes keep accumulating in
  // the background fetch; only the choreography pauses.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        pausedAtRef.current = performance.now();
      } else if (pausedAtRef.current != null) {
        pausedTotalRef.current += performance.now() - pausedAtRef.current;
        pausedAtRef.current = null;
        lastFrameRef.current = performance.now();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const paused = pausedAtRef.current != null;

      const dt = now - lastFrameRef.current;
      lastFrameRef.current = now;
      if (!paused) {
        if (dt < STABLE_FRAME_BUDGET_MS) stableFramesRef.current++;
        else stableFramesRef.current = 0;
      }

      if (!paused) {
        const elapsed = now - startRef.current - pausedTotalRef.current;
        const timelinePct = Math.min(1, elapsed / TIMELINE_FLOOR_MS);

        // While drei is loading, progress is the bytes percentage.
        // Once `active` goes false the load is done — pin to 100.
        const driveByte = activeRef.current ? progressRef.current / 100 : 1;
        const bytePct = Math.max(0, Math.min(1, driveByte));
        const combinedPct = Math.min(timelinePct, bytePct);
        const phase = derivePhase(combinedPct);

        const climaxReady =
          timelinePct >= 1 &&
          !activeRef.current &&
          progressRef.current >= 100 &&
          stableFramesRef.current >= STABLE_FRAMES_REQUIRED;

        if (climaxReady && climaxStartRef.current == null) {
          climaxStartRef.current = now;
        }
        const climaxDone =
          climaxStartRef.current != null &&
          now - climaxStartRef.current >=
            CLIMAX_DURATION_MS + POST_CLIMAX_HUD_FADE_MS;

        const shouldEmit =
          now - lastEmitRef.current >= STATE_UPDATE_INTERVAL_MS ||
          phase !== lastPhaseRef.current ||
          (climaxReady && !lastClimaxReadyRef.current) ||
          (climaxDone && !lastClimaxDoneRef.current);

        if (shouldEmit) {
          lastEmitRef.current = now;
          lastPhaseRef.current = phase;
          lastClimaxReadyRef.current = climaxReady;
          lastClimaxDoneRef.current = climaxDone;
          setState({
            timelinePct,
            bytePct,
            combinedPct,
            phase,
            bytesMB: Math.round(bytePct * GLB_TOTAL_MB * 10) / 10,
            climaxReady,
            climaxDone,
          });
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // State is intentionally not in deps — using refs to avoid resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
```

- [ ] **Step 6.2: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6.3: Commit**

```bash
git add src/loading/useAssemblyProgress.ts
git commit -m "loading: useAssemblyProgress aggregator"
```

---

## Task 7: WireframeRoom (R3F)

**Files:**
- Create: `src/loading/WireframeRoom.tsx`

Renders one `<lineSegments>` per manifest entry. Each line segments uses `EdgesGeometry` on a unit `BoxGeometry`, scaled by the manifest's `half` extents. Per-mesh appearance is staggered within the active phase via a hashed delay; uniform-driven opacity + scale animation is per-mesh.

To stay frame-cheap with 100+ boxes: one shared `BoxGeometry` + `EdgesGeometry`, one shared `LineBasicMaterial` template that's cloned per box (so each can have its own opacity). All animation lives in a single `useFrame` that walks the refs.

- [ ] **Step 7.1: Create the component**

```typescript
// src/loading/WireframeRoom.tsx
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useWireframeManifest } from "./useWireframeManifest";
import {
  type AssemblyState,
  CLIMAX_DURATION_MS,
  PHASE_THRESHOLDS,
} from "./types";

/** Shared geometry — one unit cube, scaled per mesh via the line's scale. */
const UNIT_BOX = new THREE.BoxGeometry(2, 2, 2);
const UNIT_EDGES = new THREE.EdgesGeometry(UNIT_BOX);

const WIREFRAME_COLOR = new THREE.Color("#ff7842");

/**
 * Deterministic 0..1 hash from a string. Used to randomize per-mesh
 * appearance delay within a phase so the wave reads as organic rather
 * than rasterised.
 */
function hashName(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

interface LineEntry {
  mesh: THREE.LineSegments;
  material: THREE.LineBasicMaterial;
  phaseStart: number; // combinedPct at which this mesh starts appearing
  phaseEnd: number; // combinedPct at which it's fully resolved
}

interface Props {
  state: AssemblyState;
}

export function WireframeRoom({ state }: Props) {
  const manifest = useWireframeManifest();
  const groupRef = useRef<THREE.Group>(null);

  // Build line entries once when the manifest arrives.
  const entries = useMemo<LineEntry[]>(() => {
    if (!manifest) return [];
    const out: LineEntry[] = [];
    for (const m of manifest.meshes) {
      const material = new THREE.LineBasicMaterial({
        color: WIREFRAME_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.LineSegments(UNIT_EDGES, material);
      mesh.position.set(m.center[0], m.center[1], m.center[2]);
      // EdgesGeometry was built on a (2,2,2) cube; scaling by half gives
      // the desired AABB extents directly. scale 0 at start.
      mesh.scale.set(0, 0, 0);
      mesh.userData.targetScale = [m.half[0], m.half[1], m.half[2]];

      // Distribute appearance time uniformly across the phase's window.
      const phaseIdx = m.phase - 1;
      const lo = PHASE_THRESHOLDS[phaseIdx]!;
      const hi = PHASE_THRESHOLDS[phaseIdx + 1] ?? 1;
      const jitter = hashName(m.name);
      const start = lo + (hi - lo) * jitter * 0.85;
      const end = start + 0.08; // 8% of overall combinedPct to fully resolve

      out.push({ mesh, material, phaseStart: start, phaseEnd: end });
    }
    return out;
  }, [manifest]);

  // Mount/unmount the lines into the group.
  useEffect(() => {
    const g = groupRef.current;
    if (!g) return;
    for (const e of entries) g.add(e.mesh);
    return () => {
      for (const e of entries) {
        g.remove(e.mesh);
        e.material.dispose();
      }
    };
  }, [entries]);

  // Per-frame animation driver — reads from `state` via ref to avoid
  // re-running this effect on every state update.
  const stateRef = useRef(state);
  stateRef.current = state;
  const climaxStartedAtRef = useRef<number | null>(null);

  useFrame(() => {
    const s = stateRef.current;
    if (entries.length === 0) return;

    // Track when the climax began so we can drive a local fade timer.
    if (s.climaxReady && climaxStartedAtRef.current == null) {
      climaxStartedAtRef.current = performance.now();
    }
    const climaxT =
      climaxStartedAtRef.current != null
        ? Math.min(
            1,
            (performance.now() - climaxStartedAtRef.current) /
              CLIMAX_DURATION_MS,
          )
        : 0;
    const climaxOut = 1 - easeInCubic(climaxT); // 1 → 0

    for (const e of entries) {
      const { mesh, material } = e;
      // Pre-climax: pop-in driven by combinedPct.
      let local = 0; // 0 = invisible, 1 = fully present
      if (s.combinedPct >= e.phaseEnd) local = 1;
      else if (s.combinedPct > e.phaseStart) {
        const t = (s.combinedPct - e.phaseStart) / (e.phaseEnd - e.phaseStart);
        local = easeOutBack(t);
      }

      // Climax: uniformly fade and shrink toward center.
      const visible = local * climaxOut;
      material.opacity = visible;
      const [sx, sy, sz] = mesh.userData.targetScale as [number, number, number];
      mesh.scale.set(sx * visible, sy * visible, sz * visible);
      mesh.visible = visible > 0.001;
    }
  });

  return <group ref={groupRef} />;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeInCubic(t: number): number {
  return t * t * t;
}
```

- [ ] **Step 7.2: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7.3: Temporarily mount inside Canvas for visual smoke test**

Edit `src/App.tsx`. Just above the existing `<Suspense fallback={null}>` (inside `<SceneStateProvider>`, around line 622), add:

```tsx
{/* TEMP smoke test — remove in Task 9 */}
<WireframeRoom state={{
  timelinePct: 1, bytePct: 1, combinedPct: 1, phase: 5,
  bytesMB: 27.4, climaxReady: false, climaxDone: false,
}} />
```

And add the import at the top:

```tsx
import { WireframeRoom } from "./loading/WireframeRoom";
```

- [ ] **Step 7.4: Run dev server, verify visually**

```bash
npm run dev
```

Open the URL in browser. Expected:
- All wireframe AABBs visible in amber, overlaid on the loaded room (since `combinedPct: 1` forces them all visible).
- Boxes are correctly positioned (each surrounds the real mesh it represents).

**If the wireframes are spatially WRONG (rotated, mirrored, offset):** the Blender→three.js axis conversion in the bake script is incorrect. The likely fix is in `scripts/bake-wireframes.mjs` — swap or negate components in `blenderPosToThree` / `blenderSizeToThree`. Common variants to try:
- `(x, z, -y)` (current spec, default Blender→Y-up exporter)
- `(x, z, y)` (no negation)
- `(-x, z, y)` (mirrored)

Re-run `npm run bake-wireframes` after each tweak, refresh the browser. Once aligned, proceed.

- [ ] **Step 7.5: Remove the smoke test block**

Revert the `<WireframeRoom ... />` and import added in Step 7.3 (they'll be re-added properly in Task 9).

- [ ] **Step 7.6: Commit**

```bash
git add src/loading/WireframeRoom.tsx
git commit -m "loading: WireframeRoom (R3F line-segments wireframes)"
```

If you changed the bake script for axis correction, add a separate commit:

```bash
git add scripts/bake-wireframes.mjs public/wireframes.json
git commit -m "build: fix Blender → three.js axis conversion for wireframes"
```

---

## Task 8: AssemblyHUD (DOM)

**Files:**
- Create: `src/loading/AssemblyHUD.tsx`

DOM overlay rendered outside the Canvas. Three elements: hairline progress bar, `resolving · <name>` line, bytes counter. All fade out together when `state.climaxReady` flips true.

- [ ] **Step 8.1: Create the component**

```typescript
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
```

- [ ] **Step 8.2: Type-check**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 8.3: Commit**

```bash
git add src/loading/AssemblyHUD.tsx
git commit -m "loading: AssemblyHUD overlay"
```

---

## Task 9: AssemblyController + integrate into App

**Files:**
- Create: `src/loading/AssemblyController.tsx`
- Create: `src/loading/index.ts`
- Modify: `src/App.tsx`

The controller is the public surface. It owns the progress hook, manages the `loading-active` class, and exposes two slots: one for inside-Canvas (`WireframeRoom`) and one for outside-Canvas (`AssemblyHUD`). To keep `App.tsx` clean we expose these as two separate named components that share state via a Context.

- [ ] **Step 9.1: Create the controller**

```typescript
// src/loading/AssemblyController.tsx
import { createContext, useContext, useEffect, useState } from "react";
import { AssemblyHUD } from "./AssemblyHUD";
import { useAssemblyProgress } from "./useAssemblyProgress";
import { WireframeRoom } from "./WireframeRoom";
import type { AssemblyState } from "./types";

const AssemblyCtx = createContext<AssemblyState | null>(null);

function useAssembly(): AssemblyState {
  const v = useContext(AssemblyCtx);
  if (!v) throw new Error("AssemblyContext missing — wrap with <AssemblyProvider>");
  return v;
}

/**
 * Wraps the app with a single source of truth for assembly state.
 * `AssemblyHUDSlot` and `AssemblyWireframesSlot` consume from it.
 *
 * Place this around BOTH the Canvas and the HUD overlay in App.
 */
export function AssemblyProvider({ children }: { children: React.ReactNode }) {
  const state = useAssemblyProgress();

  // Hide the custom MoveableCursor while the HUD is opaque — same
  // mechanism the old LoadingScreen used. Lifted the moment the climax
  // fade kicks in so the cursor reappears in sync with the room.
  useEffect(() => {
    if (state.climaxReady) {
      document.documentElement.classList.remove("loading-active");
    } else {
      document.documentElement.classList.add("loading-active");
    }
    return () => {
      document.documentElement.classList.remove("loading-active");
    };
  }, [state.climaxReady]);

  // Remove the static #boot-screen the moment React mounts (same as
  // old LoadingScreen behavior).
  useEffect(() => {
    const bs = document.getElementById("boot-screen");
    if (bs && bs.parentNode) bs.parentNode.removeChild(bs);
  }, []);

  return <AssemblyCtx.Provider value={state}>{children}</AssemblyCtx.Provider>;
}

/**
 * R3F-side slot — mounts inside the Canvas, as a sibling of the
 * `<Suspense fallback={null}>` that gates the real room. Renders
 * nothing once the climax has fully completed.
 */
export function AssemblyWireframesSlot() {
  const state = useAssembly();
  if (state.climaxDone) return null;
  return <WireframeRoom state={state} />;
}

/**
 * DOM-side slot — mounts outside the Canvas. Renders nothing once
 * the climax fade has completed.
 */
export function AssemblyHUDSlot() {
  const state = useAssembly();
  if (state.climaxDone) return null;
  return <AssemblyHUD state={state} />;
}
```

- [ ] **Step 9.2: Create the barrel**

```typescript
// src/loading/index.ts
export {
  AssemblyProvider,
  AssemblyWireframesSlot,
  AssemblyHUDSlot,
} from "./AssemblyController";
export type { AssemblyState, WireframeMesh, WireframeManifest } from "./types";
```

- [ ] **Step 9.3: Wire into App.tsx**

In `src/App.tsx`:

1. Remove the import on line 21:
   ```tsx
   import { LoadingScreen } from "./LoadingScreen";
   ```
   Replace with:
   ```tsx
   import {
     AssemblyProvider,
     AssemblyHUDSlot,
     AssemblyWireframesSlot,
   } from "./loading";
   ```

2. Find the `<LoadingScreen />` usage (around line 923 — the only callsite). Delete that line entirely.

3. Wrap the entire root `<div>` (the one with `style={{ position: "absolute", inset: 0, background: "#330a05", ... }}` at line 516) in `<AssemblyProvider>`. The new top-level structure becomes:

   ```tsx
   return (
     <AssemblyProvider>
       <div
         style={{
           position: "absolute",
           inset: 0,
           background: "#330a05",
           cursor: deskViewActive ? "auto" : "none",
         }}
         onClick={startTransition}
         onPointerEnter={...}
         onPointerLeave={...}
       >
         {/* ... existing content unchanged ... */}
         <AssemblyHUDSlot />
       </div>
     </AssemblyProvider>
   );
   ```

   The `<AssemblyHUDSlot />` goes near the bottom of the wrapper div, just after the `<MoveableCursor />` line (around line 749) — it's the highest-zIndex thing and should mount last.

4. Inside the Canvas, add `<AssemblyWireframesSlot />` as a sibling of the existing `<Suspense fallback={null}>` block (NOT inside it). The relevant slice changes from:

   ```tsx
   <SceneStateProvider value={...}>
     <Suspense fallback={null}>
       <Lighting />
       ...
     </Suspense>
   </SceneStateProvider>
   ```

   to:

   ```tsx
   <SceneStateProvider value={...}>
     <AssemblyWireframesSlot />
     <Suspense fallback={null}>
       <Lighting />
       ...
     </Suspense>
   </SceneStateProvider>
   ```

   The wireframes have no Suspense-triggering dependencies, so they render immediately on Canvas mount while the GLB Suspense is still resolving.

- [ ] **Step 9.4: Run the dev server end-to-end**

```bash
npm run dev
```

Open in browser with **devtools network throttling set to Fast 3G** (so the GLB takes 5–10 s and you can actually see the wireframe choreography). Expected:

1. First paint: static `#boot-screen` "loading" pulse (warm maroon).
2. React mounts: maroon HUD with hairline bar + bytes counter + `resolving · <name>` line. Camera is at iso preview pose, wireframes start appearing in waves.
3. As bytes stream in, the bar fills. Status line cycles through resolved mesh names. Wireframes pop in phase by phase.
4. When the GLB finishes parsing and 30 stable frames elapse: HUD fades out, wireframes shrink to their centers and fade, real textured room fades in behind them (no flash, no jank).
5. After the climax: "click to begin" prompt is visible, room is interactive on click.

Test the warm load: refresh the page (GLB is now cached). Same choreography should play in full — the byte counter races to `27.4 / 27.4 MB` in the first ~150 ms, but the wireframe waves still take the full timeline floor.

- [ ] **Step 9.5: Commit**

```bash
git add src/loading/AssemblyController.tsx src/loading/index.ts src/App.tsx
git commit -m "loading: wire AssemblyProvider into App, replace LoadingScreen"
```

---

## Task 10: Reduced-motion + final cleanup

**Files:**
- Modify: `src/loading/WireframeRoom.tsx`
- Modify: `src/loading/useAssemblyProgress.ts`
- Delete: `src/LoadingScreen.tsx`

- [ ] **Step 10.1: Respect `prefers-reduced-motion` in WireframeRoom**

Add this just before the `useFrame` call in `src/loading/WireframeRoom.tsx`:

```typescript
const reducedMotion = useMemo(
  () =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  [],
);
```

Then in the `useFrame` body, replace the per-mesh `local` computation with:

```typescript
let local = 0;
if (reducedMotion) {
  // Single wave at combinedPct >= 0.3 — no per-mesh stagger, linear opacity.
  if (s.combinedPct >= 0.3) {
    local = Math.min(1, (s.combinedPct - 0.3) / 0.3);
  }
} else if (s.combinedPct >= e.phaseEnd) {
  local = 1;
} else if (s.combinedPct > e.phaseStart) {
  const t = (s.combinedPct - e.phaseStart) / (e.phaseEnd - e.phaseStart);
  local = easeOutBack(t);
}
```

- [ ] **Step 10.2: Verify nothing else imports LoadingScreen**

```bash
git grep -n "LoadingScreen" -- 'src/**' || echo "no references"
```

Expected: only the `src/LoadingScreen.tsx` file itself, or `no references`.

- [ ] **Step 10.3: Delete the old LoadingScreen**

```bash
git rm src/LoadingScreen.tsx
```

- [ ] **Step 10.4: Type-check + run dev**

```bash
npm run typecheck
npm run dev
```

Expected: typecheck passes. Dev server runs. Smoke-test the full load once more (refresh page, watch the assembly). No console errors.

- [ ] **Step 10.5: Test reduced-motion**

In Chrome DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion" → `reduce`. Refresh the page. Expected: wireframes fade in as one wave around the 30% mark rather than the staggered phase-by-phase pop-in. Climax still works the same.

- [ ] **Step 10.6: Commit**

```bash
git add src/loading/WireframeRoom.tsx
git commit -m "loading: respect prefers-reduced-motion in wireframe choreography"
git commit -am "loading: delete old LoadingScreen overlay (replaced by self-assembly)"
```

(Two separate commits — one for the feature tweak, one for the deletion.)

---

## Task 11: Error fallback for missing `wireframes.json`

**Files:**
- Modify: `src/loading/WireframeRoom.tsx`
- Modify: `src/loading/AssemblyHUD.tsx`

If `/wireframes.json` is missing (e.g. someone forgot to run the bake), the HUD should still work; the wireframes layer just becomes a no-op.

- [ ] **Step 11.1: Verify the existing fallback path**

`useWireframeManifest` already returns `null` on fetch failure. `WireframeRoom` already returns `<group />` with no children when `entries.length === 0`. `AssemblyHUD` already shows the bar + bytes counter without depending on the manifest (the only manifest dep is the `resolving · <name>` line, which gracefully falls back to `resolving · scene` when `resolvedName` is empty).

- [ ] **Step 11.2: Simulate the failure**

Temporarily rename:
```bash
mv public/wireframes.json public/wireframes.json.bak
```

Then `npm run dev` and refresh. Expected:
- HUD shows bar + counter + `resolving · scene`. No wireframes.
- Console shows a 404 for `/wireframes.json` — that's the trade-off; it doesn't break.
- After the climax, the real room appears as normal.

- [ ] **Step 11.3: Restore the file**

```bash
mv public/wireframes.json.bak public/wireframes.json
```

- [ ] **Step 11.4: (Optional) silence the 404 in production**

This is intentional — leaving the 404 visible is a useful signal that the bake step was skipped. No commit needed for this task unless visual issues showed up in 11.2.

---

## Task 12: Final QA

- [ ] **Step 12.1: Cold-load test on throttled connection**

Devtools → Network → "Slow 4G" → hard refresh. Expected: full ~2.5–10 s assembly experience. Bar matches `min(timeline, bytes)`. No frozen states.

- [ ] **Step 12.2: Warm-load test**

Refresh without throttling. Expected: bytes race to 27.4 in ~150 ms; assembly still plays in full ~2.4 s.

- [ ] **Step 12.3: Tab-pause test**

While load is in progress, switch tabs for ~3 s, come back. Expected: timeline paused while away (no "everything resolves while you blinked"), resumed cleanly.

- [ ] **Step 12.4: Type-check + build**

```bash
npm run typecheck
npm run build
```

Expected: both succeed. The build's prebuild step re-bakes `wireframes.json`; verify no diff if `data/scene_manifest.json` hasn't changed:

```bash
git diff -- public/wireframes.json
```

Expected: no diff (only `generatedAt` changes, which is fine if it appears in the diff — that's acceptable).

- [ ] **Step 12.5: Note any deferred follow-ups**

If anything went sideways in 7.4 (axis conversion), 9.4 (climax handoff timing), or 10.5 (reduced motion), capture as a follow-up. Don't fix on this branch; ship what works.

---

## Self-Review Notes

- **Coverage:** every section of the spec maps to a task — bake script (T2/3), real-progress wiring (T6), wireframe choreography (T7), climax (T7/9), readout (T8), watermark continuity (no task needed — App's existing watermark renders through automatically), edge cases (T10/11), App.tsx integration (T9), cleanup (T10).
- **Open question from spec** ("commit `wireframes.json` to git vs. emit at build time"): committed path is in the plan — simpler, no surprises in CI.
- **No new dependencies.** No vitest, no `@gltf-transform/core`, no anything else. The bake script reads JSON; the runtime uses three.js / R3F already in use.
- **Verification mode:** no unit tests because the project has none and the failure modes are visual. Each task has a concrete "run X, expect Y" verification step.
