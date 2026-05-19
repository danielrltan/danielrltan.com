# Loading screen: self-assembling room

**Date:** 2026-05-19
**Author:** Daniel R.L. Tan (with Claude)
**Status:** approved by user, ready for implementation plan
**Replaces:** `src/LoadingScreen.tsx` (blinking-cat overlay)

## Goal

Turn the loading screen from "thing you wait through" into an opening shot of the portfolio. While `room.glb` (~27 MB) streams in, the user watches the room visibly build itself out of amber wireframe AABBs — one mesh at a time — locked at the exact iso pose they'll see "click to begin" from. When the GLB finishes parsing, the scaffolding falls away and the textured room is revealed in place.

This is the brand-defining first ~2.5 seconds of the site. Loading is the experience, not a barrier to it.

## User experience (the shot)

```
t=0          page first paints — static #boot-screen from index.html
             (warm maroon, pulsing "loading")

t=~100ms     React mounts, fetches /wireframes.json (one round trip, <10 kB)
             Boot-screen removed. Canvas mounted at final iso pose.

t=~150ms    Phase 1: floor + walls wireframe-snap into place
             Phase 2: large furniture (bed, desk, shelf, dresser)
             Phase 3: electronics (monitor, keyboard, PC tower)
             Phase 4: small props (lamps, mirror, plushies, books)
             Phase 5: detail/decor (posters, vinyl, mushroom bulbs, cat)

             During phases: amber AABBs pop in with a snappy ease-out-back.
             Auto-cycling status line shows the most-recent mesh name.
             Bytes counter ticks up below it.

t=~2.4s     Climax begins (gated on: timeline ≥ 2.4s AND GLB loaded
             AND 30 stable frames — same gate as today's LoadingScreen).
             Real textured meshes fade in BEHIND the wireframes over 400ms.
             Wireframes collapse uniformly (all at once, not staggered) —
             scale lerps from 1.0 to 0.0 around each box's center while
             opacity goes to 0, over the same 400ms window. Status row
             and progress bar cross-fade out on the same curve so the
             whole HUD vanishes as one piece.

t=~2.9s     "click to begin" prompt fades in.
             Existing IntroController takes over on click.
```

Watermark "Daniel Tan" is visible throughout at its existing alpha (0.06), bleeding off the edges — same as post-load. No new brand chrome.

Camera: locked at `START_POS` / `START_LOOK_AT` (the post-intro iso pose). No drift, no breathing, no parallax. The room moves; the camera doesn't.

Sound: silent. Audio unlock waits for the click-to-begin gesture, as today.

## Real-progress wiring

The screen advertises real progress on two channels:

1. **Bytes counter** — driven by `THREE.LoadingManager.onProgress` fired during the GLB fetch. Reads `X.X / 27.4 MB` in monospace below the progress bar.
2. **Resolved mesh name** — driven by the `parsed` callback hook on `GLTFLoader` (or, simpler, by walking `gltf.scene` once parse completes and emitting names on the same schedule as the wireframe waves).

Wireframe choreography is **timeline-driven with a real-progress floor.** Each phase has a target timeline trigger (e.g. phase 3 at t=1.2s). The phase actually fires at `max(timelineTrigger, byteProgressTrigger)` — so on slow connections the assembly pauses dramatically while bytes catch up, and on fast/cached loads the timeline floor still gives the full ~2.5s show. The bar shows `min(timeline%, bytes%)` so it never lies in either direction.

The **climax gate** is unchanged from today's LoadingScreen: needs `useProgress.active === false`, `progress === 100`, and 30 consecutive frames under 22ms. This is what actually catches the shader-compile / texture-upload stutter at the end of the load. The climax animation can't start until that gate clears.

If real load is faster than the 2.4s minimum: extra time is spent in phase 5 (a longer "detail pass") rather than holding on a finished build, so movement stays alive until the climax. The byte counter shows real bytes — on a cached warm load it races to `27.4 / 27.4 MB` in the first ~150 ms and then sits at that value while the rest of the choreography plays. The status line ("resolving · `<mesh_name>`") is the always-alive element and keeps cycling regardless of byte state.

If real load is slower than the minimum: phases stall at byte thresholds. The status line keeps cycling through resolved mesh names so the screen never feels frozen.

## Wireframe data

The wireframes are R3F `<lineSegments>` with `EdgesGeometry(BoxGeometry(...))` placed at world positions read from a build-time bake file: `public/wireframes.json`.

**Format:**

```json
{
  "version": 1,
  "meshes": [
    { "name": "bed_frame", "center": [x, y, z], "half": [hx, hy, hz], "phase": 2 },
    { "name": "desk",      "center": [x, y, z], "half": [hx, hy, hz], "phase": 2 },
    ...
  ]
}
```

**Bake script:** `scripts/bake-wireframes.mjs` reads `public/room.glb`, walks every top-level named object, computes world-space AABB via `THREE.Box3().setFromObject(obj)`, and emits the JSON. Phase assignment is hand-curated via a small lookup table in the same script keyed on name prefixes (`wall*` → 1, `bed*|desk|shelf|dresser` → 2, etc.) so adding a new mesh in Blender doesn't reshuffle the choreography. Runs as `prebuild` and `predev` in `package.json` so the JSON stays in sync with the GLB.

**Why bake, not parse the existing `scene_manifest.json`:** the manifest is in Blender's Z-up coordinates and lives outside the repo (`C:\Users\Daniel\Documents\WEBSITEROOM\`). Baking from the actual exported GLB guarantees the wireframes are in three.js coordinates and match exactly what the user will see.

Estimated size: ~5–15 kB minified JSON for 162 meshes. Loads in one round trip well before the first wireframe needs to appear.

## Component architecture

```
src/LoadingScreen.tsx                ← REPLACED entirely
src/loading/                         ← NEW directory
├── WireframeRoom.tsx                R3F-side: renders one <lineSegments>
│                                    per manifest entry, gates visibility
│                                    on `phase` + assembly progress.
├── AssemblyController.tsx           Drives the timeline + byte progress
│                                    loop. Owns: phase advancement,
│                                    climax gate, fade-to-real handoff.
│                                    Renders nothing; exposes context.
├── AssemblyHUD.tsx                  DOM overlay: progress bar, byte
│                                    counter, status line. CSS-only
│                                    fade-out on climax.
├── useWireframeManifest.ts          Fetches /wireframes.json once,
│                                    caches in module-level promise.
└── useAssemblyProgress.ts           Reads from drei's useProgress
                                     + LoadingManager.onProgress + RAF
                                     frame-stability watchdog. Exposes
                                     { phase, bytePct, timelinePct,
                                       latestMeshName, climaxReady }.

scripts/bake-wireframes.mjs          NEW. Run at predev/prebuild.

src/App.tsx                          MODIFIED: replace <LoadingScreen />
                                     with the new components (HUD
                                     overlay + R3F wireframes added to
                                     the Canvas tree).
```

`WireframeRoom` mounts inside the existing `<Canvas>` so it shares the camera, depth buffer, and view matrix. When the real GLB resolves and `<Room>` mounts behind it, the two are perfectly aligned with no projection math. As the climax progresses, an `opacity` uniform on the wireframes' `LineBasicMaterial` fades them out while `Room`'s normal mount-fade fades it in.

`AssemblyController` is the single source of truth for "where are we in the choreography." Both `WireframeRoom` and `AssemblyHUD` consume from it via a small context. This isolates the gnarly timeline/bytes/frame-stability state to one file.

## Color and type

All values match existing portfolio palette — nothing new:

- Background: `#330a05` (wrapper's existing maroon; LoadingScreen's bg today)
- Wireframe color: `#ff7842` (the same amber used for the monitor glow, boot-screen text, scroll prompt)
- Wireframe glow: rgba(255, 120, 66, 0.35) outer shadow, rgba(255, 120, 66, 0.18) inner fill
- Bar / counter: `var(--hud-amber)` and `rgba(255, 120, 66, 0.85)` for dim labels
- Status text: `var(--font-mono)`, uppercase, `var(--tracking-widest)`
- Watermark: untouched from App.tsx (`rgba(255, 176, 119, 0.06)`)

The visual companion mockup used `#0c0a09` charcoal for contrast in the preview cards; production uses the established `#330a05` maroon so the loading screen flows directly into the room background.

## Edge cases

| Case | Behavior |
|---|---|
| `prefers-reduced-motion` | All wireframes fade in together in one wave at t=300ms. No per-mesh stagger, no ease-out-back. Climax shortens to a hard 200ms cross-fade. Bytes counter still shows real progress. |
| Tab inactive during load | `document.visibilityState !== "visible"` pauses the timeline. Bytes counter keeps updating from the background fetch. On resume, the timeline picks up from where it paused. Avoids the "everything resolves while you blink" issue when returning to the tab. |
| `wireframes.json` 404 | Skip the wireframe layer entirely. Show only the progress bar + byte counter + status line. Still better than today's blinking cat — at least bytes are visible. Log to analytics so it's not silent. |
| `room.glb` 404 | After 10 s with no progress, show: `couldn't load scene · refresh to retry`. Same amber palette. |
| Cold load slower than 10s | Choreography stalls at whatever phase the byte progress allows. No timeout — user can wait as long as they want. |
| `room.glb` cached (warm load) | Bytes finish in <200 ms. Climax gate still requires 30 stable frames + 2.4s timeline floor. So the choreography plays in full; the counter just races to 27.4 MB in the first 150 ms then sits. |
| User clicks before climax | Click is ignored. `click to begin` only appears after climax. (Today's "click to begin" is gated on `sceneReady`; same gate works here.) |
| Old `<LoadingScreen />` import sites | One callsite: `App.tsx`. Cleanup also removes `loading-active` class plumbing and the cat SVG (`cat.svg` / `cat_blink.svg` stay as the favicon — see `index.html` — so don't delete the assets). |

## What we are NOT doing

- No camera motion during the assembly. Locked iso pose.
- No sound. No audio unlock gate.
- No mesh-name console scroll. Single auto-cycling status line.
- No "construction overhead" opening view. The shot is the shot.
- No bytes-driven per-mesh ordering. Phases are hand-curated for spatial narrative; bytes only gate phase advancement on slow connections.
- No fancy easing on the bar — it's a hairline, the wireframes carry the choreography.
- No mobile-specific layout. Same screen, same wireframes; aspect handling falls out of the existing R3F camera setup.

## Implementation notes for the plan

- The current `src/LoadingScreen.tsx` is removed wholesale. The `html.loading-active` class rule in `index.css` (hiding the custom cursor during load) is preserved and applied while the assembly is running.
- `MoveableCursor` already hides via `loading-active`. No change needed there.
- The `#boot-screen` element in `index.html` already pulses warm-amber; it is the visible state for the first ~100ms of every page load (JS-parse gap). Removing it the moment React mounts is unchanged. The new `AssemblyController` mounts immediately after, so there's no visible flash between them.
- `useGLTF.preload(ROOM_URL)` in `Room.tsx` triggers the GLB fetch as soon as the module loads. The bake script and the GLB are both in `/public`, so the existing CDN headers cover both.
- The IntroController, click-to-begin gate, watermark, and post-load behavior are all untouched.

## Open question (defer to implementation)

The bake script could either bundle into the build (`scripts/bake-wireframes.mjs` writes to `public/wireframes.json`, committed to git) or run as a Vite plugin and emit at dev/build time without a committed artifact. Both work. Committed-artifact path is simpler and dev-server-friendly; Vite-plugin path keeps the repo cleaner. Lean toward committed for now; revisit if it churns too often.
