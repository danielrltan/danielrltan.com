# Offbit font files

The site serves the `.woff2` files (`src/index.css`, and the Bold preload in
`index.html`). The `.ttf` files are the Power Type sources they are built
from; nothing links to them.

The TTFs are mostly TrueType hinting, which a pixel face doesn't need, so the
WOFF2s keep every glyph and drop the hints (Bold: 343 KB TTF -> 20 KB):

```sh
pip install fonttools brotli
for f in OffBit-Bold OffBit-Regular OffBit-DotBold OffBit-Dot; do
  pyftsubset $f.ttf --unicodes='*' --glyphs='*' --layout-features='*' \
    --name-IDs='*' --name-languages='*' --notdef-outline --no-hinting \
    --flavor=woff2 --output-file=$f.woff2
done
```
