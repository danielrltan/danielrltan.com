# Design System: Cool retro-futurism

**This file mirrors the design rules encoded in `src/index.css :root`.**
Future Claude sessions: read both. The .css block-comment is the
canonical source; this `.md` is an indexable copy for grep / search.

---

## Vibe

Retro-futurism. Apple/IBM mid-80s industrial design swatches, Teenage
Engineering spec sheets, NASA program documentation. Crisp, slightly
cold, technical. **Cool white surfaces, near-black ink, signature
orange accent.** That is the whole palette.

---

## Hard rules

1. **NO warm cream backgrounds. Ever.** If you see `#f4f1ea`,
   `#f8f6f3`, `#fbf8f4`, `#f8f5ee`, `#f4dec0`, `#fff8ec`, etc., it is
   a bug. Replace with `var(--bg-page)` or `var(--bg-surface)`.
2. **Use the tokens, not raw hex.** New UI pulls from `var(--*)` in
   `src/index.css :root`. Raw hex only when extending the system on
   purpose (and then add a token).
3. **Ink alphas: cool stack.** `rgba(13, 14, 16, ...)`. Legacy
   `rgba(26, 23, 20, ...)` (walnut) and `rgba(21, 23, 26, ...)` should
   be converted on sight.
4. **Orange `#ff4f00` (International Orange) is the only chromatic colour
   in UI.** This is now the brand accent, replacing the old `#e87040`
   terracotta. No teals, purples, secondary accents. White + ink + orange.
   Period.

---

## Tokens

### Surfaces

| Token | Hex | Use |
|---|---|---|
| `--bg-page` | `#eef0f3` | Cool off-white wrapper (body, app-wrapper) |
| `--bg-surface` | `#ffffff` | Pure white cards / panels |
| `--bg-elevated` | `#f7f8fa` | Slight elevation tint |
| `--bg-deep` | `#d8dade` | Deeper cool grey (footer / out-of-grid bands) |

### Ink

| Token | Value | Use |
|---|---|---|
| `--ink` | `#0d0e10` | Primary text, near-black cool cast |
| `--ink-muted` | `rgba(13,14,16,0.62)` | Secondary text, meta |
| `--ink-faint` | `rgba(13,14,16,0.32)` | Low-emphasis |
| `--ink-hairline` | `rgba(13,14,16,0.10)` | Borders, dividers |

### Accent

| Token | Value | Use |
|---|---|---|
| `--accent` | `#ff4f00` | Base orange (International Orange): links, tags, highlights |
| `--accent-hot` | `#ff6a2a` | Hover / active state |
| `--accent-tint` | `rgba(255,79,0,0.10)` | Soft fills (chip backplates, hover fills) |

Small accent text uses `--accent-text` (accent mixed 66% toward ink,
~5:1 on the page) and big display numbers `--accent-text-lg` (85%, ~3.4:1);
`--accent-deep` is the darkened orange for large display text.

### Legacy alias

`--wrapper-ink` aliases `--ink`. Prefer the new name in new CSS.

---

## Type

| Token | Family | Use |
|---|---|---|
| `--font-display` / `--font-body` | Geist | Headings, body |
| `--font-mono` | Geist (no monospace face; tabular-nums) | HUD labels, meta, tags |
| `--font-dot` | Offbit Dot | Hero name, section markers (loud, sparing) |
| `--font-pixel` | Offbit (solid) | Retro feel without dot rendering |

**Scale (long-form sections)**

| Token | Size |
|---|---|
| `--fs-mono` | `11px` |
| `--fs-meta` | `13px` |
| `--fs-sub` | `14px` |
| `--fs-body` | `16px` |
| `--fs-body-lg` | `17px` |

Section headers share `--hdr-num` (the tiny section number) and
`--hdr-title` (the giant pixel wordmark), set in `sections.css`.

**HUD micro-scale:** `--text-xs` 10, `--text-base` 12.

**Labels: no tracked all-caps sans.** The owner rejected small uppercase,
letter-spaced Geist labels (2026-10-05). Labels and eyebrows use the room
callout's voice: Offbit Bold, lowercase, `--fs-label` (16) or `--fs-label-sm`
(14), `letter-spacing: 0.01em`. Dates, roles and readouts use Geist 500 at
`--fs-meta`, sentence case, no tracking. Big pixel display type (section
wordmarks, names, values) and the diegetic Mac CRT text keep their caps.

---

## Spacing / radii / motion

- **Spacing:** `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-4h` 20, `--space-5` 24, `--space-6` 32, `--space-7` 48, `--space-8` 64.
- **Radii:** none. Every surface is sharp-cornered (`border-radius: 0`).
- **Easings:** `--ease-out` `cubic-bezier(0.22, 1, 0.36, 1)`, `--ease-soft` `cubic-bezier(0.2, 0.7, 0.2, 1)`.
- **Durations:** `--t-fast` 180ms, `--t-base` 280ms, `--t-slow` 540ms (full motion scale in **Motion** below).

---

## Component norms

### Chip

Used by: the section dial, brand tile, JumpToTop, project tags.

```css
background: var(--bg-surface);            /* or var(--bg-page) */
border: 1px solid var(--ink-hairline);
border-radius: 0;
```

The blur-glass pill was retired with the pixel pass.

### Card

Used by: `.section-card`, `.project-card`, `.play-item`.

```css
background: var(--bg-surface);            /* or var(--bg-elevated) for secondary */
border: 1px solid var(--ink-hairline);
box-shadow:
  0 1px 0 rgba(13, 14, 16, 0.04),
  0 24px 48px -32px rgba(194, 61, 0, 0.10);  /* warm orange-cast shadow OK */
```

All cards keep sharp corners (TE/industrial).

### Button (primary, `.btn-pill`)

```css
border: 1px solid var(--accent);
color: var(--accent);
background: transparent;
font-family: var(--font-body);
font-size: 14px;
font-weight: 600;
/* sentence case, no tracking */
padding: 14px 24px;
border-radius: 0;

/* hover */
background: var(--accent);
color: var(--bg-surface);
```

---

## Loading screen

`html.loading-active` paints the wrapper `var(--accent)` (orange) so
the boot loader's orange field has no gap during loading. The cool
retro-futurism palette resumes the instant `loading-active` drops.

Verified: cool-white wrapper transitions cleanly from orange when
the loader completes. No flash.

---

## When you find a deviation

Fix it. Add a one-line comment explaining what you replaced. The user
explicitly rejected warm cream as the top-priority colour issue:

> "im seeing so much colour mismatch here. i want a cool contrast
> between the orange and the white background for a retro-futurism
> vibe. however, im seeing warm white backgrounds. it looks all over
> the place with no design system in place."

That's the brief. Cool white + ink + orange. Hold the line.

---

## Motion

The rules below are the durable summary of the 2026 motion overhaul. (Its
working spec, `.scratch/motion-spec.md`, is a local planning file and is not
committed; everything a contributor needs is here and in the code comments.)
CSS tokens are on `:root` in `src/index.css`; the JS mirror is
`src/motion.ts` (same names, seconds). Programmatic scroll goes through
`src/scroll.ts`, which also records the Lenis tuning history.

### The five rules

1. **One smoother per signal.** Lenis (0.6 s expo-out) is the only wheel
   smoother. No numeric ScrollTrigger `scrub`, no CSS `transition` on any
   property JS writes every scroll frame, no chasing lerps stacked on scroll.
   Rate caps are fine.
2. **Scroll-linked or time-based, never both on one element.** Things you can
   rest halfway through (the hero dive, the Mac orbit, trains, the Work fill)
   are scroll-linked. Arrivals and acknowledgements (reveals, handoffs, drops,
   HUD) are time-based, triggered once by a threshold.
3. **Programmatic scroll never uses the wheel curve.** Use `scrollToY()` /
   `jumpToSection()` presets (ease-in-out, duration scaled to distance).
   Jumps over 3 viewports cut behind `.scroll-cover`. Native
   `behavior: "smooth"` is banned.
4. **Every JS follower is dt-based:** `damp(cur, target, DECAY.x, dt)` with
   `dt <= 0.1 s` (`clampDt`), `stepSpring` for springs. No per-frame lerp
   constants, so 60 Hz and 120 Hz feel the same.
5. **Tokens are additive.** Never change an existing token's value; add a new
   name. Owners migrate their own call sites.

### Tokens

| token | value | use |
|---|---|---|
| `--t-press` | 120ms | press/active feedback, tiny hover fills |
| `--t-fast` | 180ms | hovers (`--hover-dur`), exits (`--exit-dur`) |
| `--t-base` | 280ms | HUD/chrome entrances (`--chrome-dur`) |
| `--t-med` | 400ms | mid reveal step |
| `--t-morph` | 420ms | layout morphs (grid rows, height) |
| `--t-slow` | 540ms | reveals (`--reveal-dur`) |
| `--t-handoff` | 320ms | hero to About clear |
| `--t-cover-in` / `--t-cover-out` | 120ms / 200ms | scroll cover |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | default: entrances, hovers, reveals |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | both ends on screen: morphs, travel |
| `--ease-in` | `cubic-bezier(0.55, 0, 1, 0.45)` | exits (`--exit-ease`) |
| `--ease-bounce` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | overshoot pop |
| `--ease-steps-4` | `steps(4, jump-end)` | pixel-voice opacity steps |
| `--stagger` / `--stagger-max` | 60ms / 5 | `delay = min(var(--i), var(--stagger-max)) * var(--stagger)` |
| `--reveal-lift` / `--chrome-lift` | 16px / 8px | reveal and chrome travel |

`--ease-soft` and `--ease-entrance` are legacy: keep them, but use
`--reveal-ease` / `--ease-out` in new CSS.

Snap rule for an ad-hoc duration: <=150ms `--t-press`, 151-220 `--t-fast`,
221-320 `--t-base`, 321-450 `--t-med` (layout morphs `--t-morph`), 451-700
`--t-slow`. Ambient loops (marquees, bobs, stepped dither) are exempt.

Stagger idiom:
`transition-delay: calc(min(var(--i, 0), var(--stagger-max)) * var(--stagger));`

### Scroll core (`src/scroll.ts`)

- `scrollToY(y | el, { preset })`: `"glide"` (default, inOutCubic, 0.45-0.9 s
  by distance), `"nudge"` (short outCubic), `"jump"` (glide under 3 viewports,
  covered cut beyond).
- `jumpToSection(indexOrLabel)`: lands on the section's `pinId` trigger (now
  a softHold hold trigger, below) at its `data-jump-progress` attribute
  (wins) or the registry `jumpProgress`; otherwise on the section's doc top.
- `lockScroll(reason)` / `unlockScroll(reason)`: named locks ("loader",
  "menu", "jump:<seq>"). A smooth request while locked becomes an instant cut.
- `onScrollJump(cb)`: on a cut's `end`, snap followers to the target in the
  same frame.
- Reduced motion: every programmatic scroll is instant, no cover, and Lenis
  wheel smoothing is off. The global CSS net zeroes durations and delays,
  except on `.pin-spacer` and its pinned child (`transition-property: none`):
  a 0.01 ms transition on a spacer's height made ScrollTrigger measure every
  later pin one spacer early. No section pins any more (seams, below), so
  this only guards a future GSAP pin.
- Refresh order: every `ScrollTrigger.refresh()` sorts triggers by
  `refreshPriority`, then DOM order (scroll.ts), so a trigger created late by
  a breakpoint flip still measures the layout above it. Don't add per-trigger
  priorities. A viewport resize restores the same section beat (hold
  progress; `isHoldTrigger` makes measureGeom read a hold like a pin) in one
  global handler; don't add per-section resize restores.
- Touch-primary devices (`MQ.touchPrimary`) run with NO Lenis: native
  scrolling end to end (Lenis's non-passive touch listeners blocked the
  compositor). `getLenis()` is null there; always handle null. Smooth
  programmatic scrolls run on a small rAF tween in scroll.ts, and a held lock
  blocks touch panning with its own temporary touchmove guard.

### Seams (`src/seams/`, overhaul 2026-10-06)

Owner brief: section boundaries never stop the page. Something on screen
moves 1:1 with the wheel at every boundary, so there are no GSAP section pins
(`git grep "pin: true" src/` stays empty). Each boundary is a seam: one
scroll-linked hand-off from the section above to the one below.

- **`mountSeam` / `useSeam` (seam.ts)** is the only way a seam binds to
  scroll: one non-scrub ScrollTrigger (`seam:<id>`) on an IN-FLOW trigger
  (never a sticky element: its start is wrong after a refresh). No numeric
  scrub, no pin, no snap, no `refreshPriority`. Layout is read only in
  `measure()` (onRefreshInit); `render(p)` is a pure write of progress, so a
  seam reverses exactly and lands right after a cut jump (`ctx.jumping`;
  `cross` one-shots latch silently). `final()` is the static end state for
  reduced motion and for a gate that is off with no `fallback`.
  `window.__seams[id]` mirrors `{ p, active, mode }` in every build.
- **Touch and phones** get time-based variants (`oneShot`, a WAAPI play or a
  class toggle on a line crossing), never a per-frame JS transform: touch
  scroll is threaded and a scroll-linked write lags it.
- **Holds** replace pins: a tall in-flow section root with an inner
  `position: sticky; top: 0; height: 100svh` stage (`.about-hold`,
  `.mac-sticky`, `.bp-hold`, `.photos-stage`, `.keypad-hold`). The hold
  length is a CSS token (`--seam-mac-hold`, `--seam-bp-hold`,
  `--seam-photos-hold`, `--seam-about-cover`, `--footer-h`); no JS
  duplicates it.
- **`softHold` (softHold.ts, math in holdMath.ts)** writes a small
  `translate` on the stage around each sticky edge so its velocity ramps
  linearly over L = min(0.3 x viewport, 0.4 x hold): C1 engage and release, nothing
  left over after the zone (no page-tone strip; it replaced softRelease,
  whose permanent -L/2 left one). The keypad engages only (it never
  releases). It also creates the hold trigger: a NON-pinning ScrollTrigger
  over the sticky span with the id the old pin used (`mac-pin`, `bp-pin`,
  `photos-pin`, `keypad-pin`), registered in holds.ts so `jumpToSection` and
  the resize restore treat it like a pin.
- **`src/seams/stack.css`** owns ALL cross-section geometry (root heights,
  the sheets' negative margins, z-index, overflow); section CSS owns only its
  internals. Every rule is keyed on a `data-seam-stack` attribute that only
  that section's own code sets, and a cross-section rule needs BOTH flags
  (adjacent-sibling combinator), so reverting one section's commit turns off
  exactly its seam. Two sections are sheets: Projects rises over a still
  About, and the footer rides over the stuck keypad.
- **Gates** (CSS in stack.css mirrors `SEAM_MQ` in motion.ts exactly):
  `desk` = width > 900 and height > 500, motion OK (About curtain, Mac hold,
  Honours dwell); `wide` = width > 768 and height > 500, motion OK (keypad
  under the footer); `motion` = no reduced motion (the Recents hold, every
  width); `fine` = desk and not touch-primary (scroll-linked DOM writes such
  as the relay pixel, the arrow swivel, the drum). Reduced motion: no holds,
  no sheets, plain flow, every seam at `final()`.
- **Sticky containment:** nothing between a sticky stage and `<html>` may be
  `overflow: hidden | auto | scroll` (it binds the sticky to that box and it
  never sticks). Use `overflow: clip`.
- **The overlay rule:** the page has at most ONE fixed cross-section layer,
  `#seam-layer` (SeamLayer.tsx: a sibling of `<main>`, z 12, pointer-events
  none, `fine` gate only). A seam takes it with `claimOverlay(id)` and gives
  it back with `releaseOverlay(id)`; it stays `visibility: hidden` the rest of
  the time. Its single claimant is the Projects to Work relay pixel. Never add
  a per-seam fixed layer: stacked fixed layers are what made the old
  boundaries read as bars.
- **`seamBus`** (bus.ts) carries the few anchors one scene writes and a seam
  reads at measure time (the CRT centre). Keep it that small; no per-frame
  cross-scene coupling.
- Smoke (`scripts/smoke-test.mjs`) guards the contract: no pin-spacers, About
  still under the sheet, the overlay idle at rest, no strip after the Recents
  release, the keypad under the footer, every footer row printed at the end.

## Breakpoints and mobile

One set of media queries, `MQ` in `src/motion.ts` (`matches(q)` for a
one-off read, `useMedia(q)` / `useFinePointer()` from `src/useMedia.ts` for
React). CSS mirrors them by hand; keep the two in lockstep.

| Name | Query | Use for |
| --- | --- | --- |
| `phone` | `(max-width: 768px)` | portrait phone layout |
| `shortLandscape` | `(orientation: landscape) and (max-height: 500px)` | a phone on its side, any width |
| `compact` | `phone` OR `shortLandscape` | "is this a phone": `useIsMobile()`, the touch HUD, 2D fallbacks, no idle GLB prefetch |
| `narrow` | `(max-width: 900px)` OR `shortLandscape` | the stacked About / Work / Projects cut-over |
| `finePointer` | `(hover: hover) and (pointer: fine)` | custom cursors, hover-only effects |
| `touchPrimary` | `(hover: none) and (pointer: coarse)` | input-engine choices (no Lenis, menu DPR 1) |

CSS for `compact`: `@media (max-width: 768px), (orientation: landscape) and (max-height: 500px)`.

Rules:

- Width is layout, pointer is input. Never gate a cursor or a hover effect on
  width: a narrow desktop window still has a mouse, and an iPad in landscape
  does not. `MoveableCursor` / `PanCursor` mount on `useFinePointer()`; the OS
  cursor is hidden only by the `html.custom-cursor` rule under the same query.
- Every `:hover` rule lives inside `@media (hover: hover)` (a tap leaves
  `:hover` stuck on touch). Keep `:focus-visible` outside it, and give touch
  an `:active` cue where the hover was the only feedback.
- Full-height boxes use `svh` (with a `vh` line before it as the fallback), so
  they don't jump as the mobile URL bar shows and hides.
- Fixed chrome offsets are `max(<gap>px, env(safe-area-inset-<side>, 0px) +
  <n>px)` at EVERY width, not only on phones: a phone on its side carries its
  notch on the left or right, whatever layout it gets.
- Tap targets are >= 44 x 44 px after any transform (drei `<Html>` labels are
  scaled down on phones: grow the hit box with an invisible `::before`, not
  the type).
