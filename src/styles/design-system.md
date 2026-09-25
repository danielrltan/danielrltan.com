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

---

## Spacing / radii / motion

- **Spacing:** `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-4h` 20, `--space-5` 24, `--space-6` 32, `--space-7` 48, `--space-8` 64.
- **Radii:** none. Every surface is sharp-cornered (`border-radius: 0`).
- **Easings:** `--ease-out` `cubic-bezier(0.22, 1, 0.36, 1)`, `--ease-soft` `cubic-bezier(0.2, 0.7, 0.2, 1)`.
- **Durations:** `--t-fast` 180ms, `--t-base` 280ms, `--t-slow` 540ms.

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
font-family: var(--font-mono);
font-size: 11px;
letter-spacing: 0.18em;
text-transform: uppercase;
font-weight: 600;
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
