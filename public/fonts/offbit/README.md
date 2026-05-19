# Offbit font files

Drop the Offbit OpenType / WOFF / WOFF2 files here, then the
`@font-face` entries in `src/index.css` will pick them up
automatically. Filenames the CSS expects:

- `Offbit-Regular.{woff2,woff,otf}`
- `Offbit-Bold.{woff2,woff,otf}`
- `OffbitDot-Regular.{woff2,woff,otf}`
- `OffbitDot-Bold.{woff2,woff,otf}`

If your downloaded filenames differ, rename them to match — or
update the `src:` paths in `src/index.css` accordingly.

If multiple formats aren't available, any one of woff2 / woff /
otf is enough; the others can stay absent (they'll 404 silently and
the browser will use whichever it found).

While these files are missing, the font stack falls back to
**Doto** (Google Fonts, similar pixel-dot face) then JetBrains Mono.
