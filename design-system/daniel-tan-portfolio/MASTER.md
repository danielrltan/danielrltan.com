# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Daniel Tan Portfolio
**Generated:** 2026-05-24 16:34:35
**Category:** Gaming

---

## Global Rules

### Color Palette

> CORRECTED to the project's CANONICAL tokens (the auto-generated retro-
> futurism defaults of blue #2563EB + Archivo were WRONG for this repo).
> Source of truth: src/index.css :root + src/styles/design-system.md.
> Cool retro-futurism: cool white surfaces, near-black cool ink, ONE
> accent (orange). NO blue. NO warm cream.

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Page background | `#eef0f3` | `--bg-page` |
| Surface (cards/panels) | `#ffffff` | `--bg-surface` |
| Elevated | `#f7f8fa` | `--bg-elevated` |
| Ink (text) | `#0d0e10` | `--ink` |
| Ink muted (≥4.5:1) | `rgba(13,14,16,0.62)` | `--ink-muted` |
| Ink hairline | `rgba(13,14,16,0.10)` | `--ink-hairline` |
| Accent | `#e87040` | `--accent` |
| Accent hot (hover) | `#ff6a2a` | `--accent-hot` |

**Color Notes:** Cool white + ink + a single orange accent. Orange is the
ONLY chromatic color. CONTRAST CAVEAT: `#e87040` on `#eef0f3` is ~2.64:1,
fails 4.5:1 for SMALL text. Only use accent as small text where it is NOT
the sole information carrier (it duplicates an adjacent high-contrast
label). For accent-colored body/label text that must pass AA, darken via a
dedicated `--accent-text` token rather than the base accent.

### Typography

- **Heading/Display Font:** Geist (var(--font-display))
- **Body Font:** Geist (var(--font-body))
- **Mono Font:** JetBrains Mono (var(--font-mono)): eyebrows, labels, meta
- **Mood:** editorial, technical, retro-futurism, confident
- **Do NOT** introduce Archivo / Space Grotesk / Inter. Use the existing project fonts only.

### Spacing Variables

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

> NOTE: examples below use the CORRECTED project tokens, not the
> generator's blue defaults.

### Buttons

```css
/* Primary Button: accent fill */
.btn-primary {
  background: var(--accent);            /* #e87040 */
  color: var(--bg-surface);             /* #fff, white on accent ~3.1:1, OK for large/bold only */
  padding: 12px 24px;
  border-radius: var(--r-chip, 999px);
  font-weight: 600;
  transition: background 200ms var(--ease-out, ease), transform 200ms ease;
  cursor: pointer;
}
.btn-primary:hover { background: var(--accent-hot); }      /* color shift, NOT layout-shifting scale */
.btn-primary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

/* Secondary Button: ink outline */
.btn-secondary {
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--ink-hairline);
  padding: 12px 24px;
  border-radius: var(--r-chip, 999px);
  font-weight: 600;
  transition: border-color 200ms ease, color 200ms ease;
  cursor: pointer;
}
.btn-secondary:hover { border-color: var(--accent); color: var(--accent); }
.btn-secondary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
```

### Cards

```css
.card {
  background: var(--bg-surface);        /* #fff */
  border: 1px solid var(--ink-hairline);
  border-radius: var(--r-card, 14px);
  padding: 24px;
  transition: border-color 200ms ease, box-shadow 200ms ease;
  cursor: pointer;
}
.card:hover { border-color: var(--accent); }   /* color/border feedback, no transform-shift */
```

### Inputs

```css
.input {
  padding: 12px 16px;
  background: var(--bg-surface);
  border: 1px solid var(--ink-hairline);
  border-radius: var(--r-card, 14px);
  color: var(--ink);
  font-size: 16px;                      /* ≥16px avoids iOS zoom */
  transition: border-color 200ms ease;
}
.input:focus-visible {
  border-color: var(--accent);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-tint, rgba(232,112,64,0.12));
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Retro-Futurism

**Keywords:** Vintage sci-fi, 80s aesthetic, neon glow, geometric patterns, CRT scanlines, pixel art, cyberpunk, synthwave

**Best For:** Gaming, entertainment, music platforms, tech brands, artistic projects, nostalgic, cyberpunk

**Key Effects:** CRT scanlines (::before overlay), neon glow (text-shadow+box-shadow), glitch effects (skew/offset keyframes)

### Page Pattern

**Pattern Name:** Portfolio Grid

- **Conversion Strategy:**  hover overlay info,  lightbox view, Visuals first. Filter by category. Fast loading essential.
- **CTA Placement:** Project Card Hover + Footer Contact
- **Section Order:** 1. Hero (Name/Role), 2. Project Grid (Masonry), 3. About/Philosophy, 4. Contact

---

## Anti-Patterns (Do NOT Use)

- ❌ Minimalist design
- ❌ Static assets

### Additional Forbidden Patterns

- ❌ **Emojis as icons**: Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer**: All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers**: Avoid scale transforms that shift layout
- ❌ **Low contrast text**: Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes**: Always use transitions (150-300ms)
- ❌ **Invisible focus states**: Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
