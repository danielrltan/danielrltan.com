# Portfolio Redesign: Curiosity Cabinet

## Concept

Every section is a different *object*. The connecting tissue is Daniel, not a unified world. The user is "walking through a curiosity cabinet" of things he made, each one its own self-contained interactive moment. The room (currently the centerpiece) gets demoted to a single beat (About) so each other section can have its own visual identity.

## Section inventory

| # | Section | Object | Notes |
|---|---|---|---|
| 1 | Hero | **3D extruded signature** | Replaces the existing wireframe loading screen. The signature draws itself on the orange loading background, then expands and transitions into 3D when the page is ready. |
| 2 | About | **The Room** (unchanged) | Wireframe-assembly cover dome + climax logic is removed since the loading is now signature-based. |
| 3 | Skills + Projects | **Retro-futurism Macintosh** | Fused into one cinematic section. Logos orbit a dormant Mac → Mac descends → CRT boots → desktop reveals project rows → click expands a side card → logos disintegrate during transition. |
| 4 | Work | **Animated HTML timeline** | Pure HTML / no 3D. Cards animate in on scroll. Current job pinned, past jobs with achievement metrics, "Download Résumé" CTA at bottom. Acts as the page's "rest beat." |
| 5 | Photos (was Play) | **3D photo carousel** | Horizontal axis, slow rotation driven by scroll (~¼ revolution per viewport). Click a photo for an enlarged modal. |
| 6 | Other | **Desk + scrolling photo trains** | 3D desk with clickable hobby objects (tooltip on click). Above the desk, 3-4 horizontal HTML rows of photos scroll in opposite directions as the user scrolls vertically. Explicit 3D-plus-HTML hybrid. |
| 7 | Contact | **Keypad** (unchanged) | Existing GSAP pin + drop-in animation already polished. |

`SectionTransition` (the marquee bridge currently between Other and Keypad) stays for now.

## Section designs

### 1. Hero: 3D signature

**State machine:**

1. **Boot** (page loads, body bg `#e87040`, no JS run yet).
2. **Loading**: full-viewport orange background. Signature draws itself in WHITE, at half the current `SignatureReplay` stroke thickness, centered on the viewport.
3. **Climax gate** fires when:
   - signature animation has completed,
   - all assets (`/room.glb` etc.) have loaded,
   - a few stable frames have passed.
4. **Transition**: signature expands to its final hero size (centered) and morphs from 2D SVG strokes to 3D extruded geometry, where each stroke becomes a tube along its path. Orange background fades to wrapper-bg cream.
5. **Resting**: signature stays drawn. Cursor parallax tilts it ±~5° around X/Y. A point light tracks the cursor (projected to a plane at the signature's depth), sweeping highlights across the metallic-style material.

**Re-entry**: scrolling back to the top from elsewhere doesn't redraw the signature. It's already there.

**Technical notes:**

- Signature stroke data is already captured in `public/signature.json`.
- 2D draw-in uses the existing `paint.ts` / `SignatureReplay.tsx` machinery, scaled and re-positioned.
- 3D version: convert each stroke's polyline into a `THREE.CatmullRomCurve3`, render with `THREE.TubeGeometry` (radius proportional to the original stroke width). Material: `MeshStandardMaterial` with metalness ~0.6, roughness ~0.3, orange-tinted base color.
- Cursor light: a `PointLight` whose world position is the cursor's screen-to-world projection at the signature's z-plane.

### 2. About: Room (cleanup)

Remove from `src/loading/`:
- `WireframeRoom.tsx` (the wireframe-assembly cover dome + line meshes)
- The climax logic in `AssemblyHUD.tsx` that drives the orange-print sequence

Keep `useAssemblyProgress` since the hero needs an "are we ready?" signal, but simplify: just track `bytePct` and a stable-frame counter. The boolean `climaxDone` (or new equivalent like `ready`) drives the hero's 2D-to-3D transition.

The Room itself in `src/Room.tsx` is unchanged. About-section content (right-column copy) is unchanged.

### 3. Skills + Projects: Macintosh

One scroll-pinned section (similar mechanism to Keypad):

**Pin range**: ~2 viewports of scroll while pinned, to give the cinematic sequence room.

**Animation timeline (driven by pin progress 0..1):**

| Progress | Beat |
|---|---|
| 0.00 – 0.15 | Logos orbit slowly around an empty point. Mac sits dormant in upper-left, faint. |
| 0.15 – 0.40 | Mac descends to the orbit's center plane. Soft landing with contact shadow. |
| 0.40 – 0.50 | CRT screen flicks on. Boot sequence types out line by line. |
| 0.50 – 0.65 | Desktop appears: 4-6 project tiles arranged in rows on the screen. |
| 0.50 – 0.75 | Logos pixel-disintegrate (each logo dissolves into ~30 tiny cubes that drift apart and fade out). |
| 0.75 – 1.00 | Mac sits with desktop visible. Cursor parallax on the whole rig. User can click project tiles → side card expands (overlay HTML). |

**3D Macintosh**: built programmatically with primitives. Box body, slightly tapered, glass-front rectangle for screen, small base, classic single floppy slot. Orange power LED. ~10 polys total, keeping the file size negligible (no GLB).

**Logos**: simple text-on-plane sprites (`React`, `TypeScript`, `Three.js`, `Blender`, `Figma`, `Rapier`, `GSAP`, `Vite`) arranged in a horizontal ring around the Mac. Each logo is a `BoxGeometry` with rounded corners and text texture, ~0.6 world units across.

**Disintegration**: when triggered, each logo decomposes into a grid of ~5x5 small boxes that get random velocities outward, fade alpha to 0 over ~1s.

**Screen content**: an `<Html>` overlay (from `@react-three/drei`) positioned to match the CRT's screen rectangle. Standard HTML/CSS for the boot text and project tiles. Click handler on each project tile opens a side card.

**Side card**: a fixed-position HTML panel sliding in from the right with project case study (title, description, screenshot, links). Closed via X or ESC.

### 4. Work: HTML timeline

Pure HTML section, scroll-driven via `IntersectionObserver` + CSS animations:

- Container: vertical timeline running down the right column (the standard portfolio-section layout).
- Each role is a card with:
  - Company name + logo placeholder
  - Role + dates
  - 2-3 bullet achievements with numeric metrics
- Cards animate in from the right as they enter viewport (translate + opacity, ~400ms, easeOutCubic).
- "Currently @ X" card pinned to the top of the visible list, styled distinctly (orange accent border, "CURRENT" tag).
- Bottom: a "📄 Download Résumé" button linking to `/resume/Daniel_Tan_Resume.pdf` (assuming it exists in `/public/resume/`).

No 3D, no Three.js for this section. Pure CSS + IntersectionObserver.

### 5. Photos: 3D carousel

3D scene in its own R3F Canvas (like the keypad).

- 8-12 photo planes arranged in a horizontal ring at a fixed radius (~4 world units) around a vertical Y axis.
- Each plane faces outward radially.
- Scene rotation around Y is driven by scroll progress through the section: 1 full revolution per ~3 viewports of scroll.
- Soft top-down lighting.
- Photo planes use `MeshBasicMaterial` with image textures.
- Click handler on each plane opens a centered modal showing the full photo + caption.
- Modal: HTML overlay outside the canvas, dismissed by click outside or ESC.

Placeholder content: a `/public/images/photos/` directory with stand-in photos until real ones are added.

### 6. Other: Desk + photo trains

Single section with two layers in the same viewport:

**3D layer (bottom 50% of viewport)**:
- 3D desk model (built programmatically: box + legs, light wood texture).
- 5-7 small objects on the desk surface: camera, basketball, headphones, books, coffee mug, etc.
- Each object is hoverable (cursor changes, slight scale-up).
- Click an object → an HTML tooltip appears anchored to the object's screen position, with 1-2 sentence hobby description. Click outside to dismiss.

**HTML layer (top 50% of viewport)**:
- 3-4 horizontal rows stacked vertically.
- Each row is a "train" of photos sliding horizontally.
- Row 1 → scrolls left-to-right at speed 1.
- Row 2 → scrolls right-to-left at speed 0.8.
- Row 3 → scrolls left-to-right at speed 1.2.
- The horizontal scroll position of each row is driven by the user's vertical scroll position within the section (not autoplay). This is the "indication of scrolling" the user wants.
- Photos are achievements/screenshots/fun moments. Small (~80-120px tall), many per row.

Section background: continuous (no hard divider between the two layers).

### 7. Contact: Keypad

Unchanged from current state.

## Cross-cutting decisions

- **Loading is now the Hero**. The current `WireframeRoom.tsx` + `AssemblyController` orange-print sequence is replaced. `AssemblyProvider` stays as a thin "are assets loaded?" context but no longer drives wireframe assembly.
- **`SectionTransition`** (the marquee bridge) stays between Other and Contact.
- **Implementation order**: Hero (foundation) → About cleanup → Work (quick HTML win) → Photos → Other → Skills+Projects (most complex). Each milestone independently testable.
- **Performance budget**: each section's own scene/canvas is OK (we already have two: Room + Keypad). Adding two more (Hero signature + Photo carousel + Other desk + Macintosh) means 5-6 simultaneous canvases. Mitigation: lazy-mount each section's canvas via `IntersectionObserver` (same pattern Keypad already uses).
- **Mobile**: each section degrades sensibly. 3D effects keep but lower DPR. Photo trains may simplify to fewer rows. Hero signature stays 3D but parallax disabled (no cursor on mobile).

## Out of scope

- Replacing the room model
- Restyling the right-column portfolio copy
- New navigation (sections are still scroll-based)
- Mobile-specific UX redesign (sections degrade automatically, not bespoke mobile layouts)
