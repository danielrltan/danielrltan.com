/**
 * Recents photo tags, keyed by the WebP filename `npm run photos` writes into
 * public/photos/. Kept here (not in manifest.json) because the photo script
 * regenerates the manifest from photos-inbox/ on every run. A photo missing
 * from this map just shows its number, no tag.
 */
export const RECENTS_TAGS: Record<string, string> = {
  "fullsizerender.webp": "life",
  "image-2026-06-08-at-1-23-pm.webp": "cars",
  "image-2026-06-08-at-1-27-pm.webp": "life",
  "image-2026-06-08-at-1-30-pm.webp": "travel",
  "img-0294.webp": "work",
  "img-0787.webp": "travel",
  "img-0788.webp": "travel",
  "img-1002.webp": "food",
  "img-1093.webp": "life",
  "img-1358.webp": "work",
  "img-1403.webp": "cars",
  "img-1548.webp": "life",
  "img-1599.webp": "life",
  "img-1676.webp": "cars",
  "img-1785.webp": "cars",
  "img-1981.webp": "food",
  "img-2058.webp": "ski",
  "img-2083.webp": "ski",
  "img-2085.webp": "life",
  "img-2379.webp": "room",
  "img-2441.webp": "travel",
  "img-2545.webp": "travel",
  "img-2669.webp": "travel",
  "img-2792.webp": "travel",
  "img-2904.webp": "cars",
  "img-2918.webp": "travel",
  "img-2932.webp": "cars",
  "img-3033.webp": "travel",
  "img-3233.webp": "food",
  "img-3293.webp": "work",
  "img-3377.webp": "food",
  "img-3379.webp": "travel",
  "img-3929.webp": "cars",
  "img-3998.webp": "cars",
  "img-5060.webp": "food",
  "img-5100.webp": "travel",
};
