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
4. **Orange `#e87040` is the only chromatic colour in UI.** No teals,
   purples, secondary accents. White + ink + orange. Period.

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
| `--accent` | `#e87040` | Base orange: links, tags, highlights |
| `--accent-hot` | `#ff6a2a` | Hover / active state |
| `--accent-tint` | `rgba(232,112,64,0.10)` | Soft fills (chip backplates, hover fills) |

### Legacy aliases

`--wrapper-bg`, `--wrapper-bg-soft`, `--wrapper-bg-deep`,
`--wrapper-ink`, `--wrapper-ink-soft`, `--wrapper-ink-faint`,
`--accent-soft`: all alias to the new tokens. Prefer the new names
in new CSS.

---

## Type

| Token | Family | Use |
|---|---|---|
| `--font-display` / `--font-body` | Geist | Headings, body |
| `--font-mono` | JetBrains Mono | HUD labels, meta, tags |
| `--font-dot` | Offbit Dot | Hero name, section markers (loud, sparing) |
| `--font-pixel` | Offbit (solid) | Retro feel without dot rendering |

**Scale (long-form sections)**

| Token | Size |
|---|---|
| `--fs-mono` | `11px` |
| `--fs-meta` | `13px` |
| `--fs-body` | `16px` |
| `--fs-lead` | `clamp(20px, 2.1vw, 28px)` |
| `--fs-h2` | `clamp(48px, 7.5vw, 108px)` |
| `--fs-h1` | `clamp(72px, 13vw, 220px)` |

**HUD micro-scale:** `--text-xs` 10, `--text-sm` 11, `--text-base` 12.
Trackings: `--tracking-wide` 2px, `--tracking-wider` 3px, `--tracking-widest` 4px.

---

## Spacing / radii / motion

- **Spacing:** `--space-1` 4, `--space-2` 8, `--space-3` 12, `--space-4` 16, `--space-5` 24, `--space-6` 32, `--space-7` 48, `--space-8` 64, `--space-9` 96.
- **Radii:** `--r-chip` 999px (pills), `--r-card` 14px, `--r-card-lg` 20px.
- **Easings:** `--ease-out` `cubic-bezier(0.22, 1, 0.36, 1)`, `--ease-soft` `cubic-bezier(0.2, 0.7, 0.2, 1)`.
- **Durations:** `--t-fast` 180ms, `--t-base` 280ms, `--t-slow` 540ms.

---

## Component norms

### Chip / pill

Used by: StatusBar pill, brand chip, JumpToTop, hero eyebrow.

```css
background: rgba(238, 240, 243, 0.82);
backdrop-filter: blur(10px) saturate(120%);
border: 1px solid var(--ink-hairline);
border-radius: var(--r-chip);
box-shadow:
  0 1px 0 rgba(255, 255, 255, 0.5) inset,
  0 8px 24px -16px rgba(13, 14, 16, 0.25);
```

### Card

Used by: `.section-card`, `.project-card`, `.play-item`.

```css
background: var(--bg-surface);            /* or var(--bg-elevated) for secondary */
border: 1px solid var(--ink-hairline);
box-shadow:
  0 1px 0 rgba(13, 14, 16, 0.04),
  0 24px 48px -32px rgba(180, 80, 30, 0.10);  /* warm orange-cast shadow OK */
```

Existing cards keep sharp corners (TE/industrial). New cards use
`border-radius: var(--r-card)` unless there's a reason to break it.

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
the orange cover-dome has no gap during loading. The cool retro-
futurism palette resumes the instant `loading-active` drops.

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
