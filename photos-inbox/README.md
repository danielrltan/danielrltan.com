# photos-inbox

Drag your photos (or a whole exported iOS album) **into this folder**, then run:

```
npm run photos
```

That optimizes everything into `public/photos/` (web WebP, resized, EXIF-rotated)
and rebuilds `public/photos/manifest.json`. Commit `public/photos/` and push — the
"Off the clock / Photos" reel reads the manifest at runtime.

- Accepts: HEIC/HEIF (iPhone), JPG, PNG, WebP, TIFF.
- Ignores: Live-Photo videos (.mov/.mp4), edit sidecars (.aae), hidden/system files.
- This folder is the **full source set**: re-running mirrors it (drop a photo to add,
  delete one to remove), then re-run + push.
- Raw originals here are **gitignored** — only the optimized `public/photos/` is committed.
- Sweet spot: ~24–30 strong photos. More than ~40 gets heavy/repetitive in the reel.
