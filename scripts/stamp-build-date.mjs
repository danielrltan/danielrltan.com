// scripts/stamp-build-date.mjs
//
// Runs as `postbuild`: stamps the REAL build time into the deployed
// artifacts so search engines get honest freshness signals exactly as
// often as the site actually ships.
//
//   1. dist/sitemap.xml  — <lastmod> on every <url> entry.
//   2. dist/index.html   — `dateModified` on the schema.org WebSite node.
//
// Operates on dist/ ONLY (never the public/ or index.html sources), so
// builds don't dirty the working tree. Every Vercel deploy rebuilds, so
// the stamped date is truthful: a deploy IS a modification. Do NOT
// repurpose this to fake freshness on a schedule without deploys —
// Google ignores lastmod from sitemaps it has caught lying.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = resolve(fileURLToPath(import.meta.url), "../../dist");
const now = new Date();
// <lastmod> accepts full W3C datetime; date-only keeps the sitemap tidy.
const isoDate = now.toISOString().slice(0, 10);
const isoFull = now.toISOString();

// ----- sitemap.xml: insert or replace <lastmod> per <url> -------------------
const sitemapPath = resolve(DIST, "sitemap.xml");
if (existsSync(sitemapPath)) {
  let xml = readFileSync(sitemapPath, "utf8");
  if (xml.includes("<lastmod>")) {
    xml = xml.replace(/<lastmod>[^<]*<\/lastmod>/g, `<lastmod>${isoDate}</lastmod>`);
  } else {
    xml = xml.replace(
      /(<loc>[^<]*<\/loc>)/g,
      `$1\n    <lastmod>${isoDate}</lastmod>`,
    );
  }
  writeFileSync(sitemapPath, xml);
  console.log(`stamped dist/sitemap.xml lastmod=${isoDate}`);
} else {
  console.warn("dist/sitemap.xml not found; skipped");
}

// ----- index.html: dateModified on the schema.org WebSite node --------------
const htmlPath = resolve(DIST, "index.html");
if (existsSync(htmlPath)) {
  const html = readFileSync(htmlPath, "utf8");
  const re = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/;
  const m = html.match(re);
  if (m) {
    // Parse + mutate + re-serialize: keeps this robust against source
    // formatting changes (vs. a brittle string splice).
    const data = JSON.parse(m[2]);
    const site = data["@graph"]?.find((n) => n["@type"] === "WebSite");
    if (site) {
      site.dateModified = isoFull;
      const json = JSON.stringify(data, null, 2);
      writeFileSync(htmlPath, html.replace(re, `$1\n${json}\n    $3`));
      console.log(`stamped dist/index.html dateModified=${isoFull}`);
    } else {
      console.warn("WebSite node not found in ld+json; skipped");
    }
  } else {
    console.warn("ld+json block not found in dist/index.html; skipped");
  }
} else {
  console.warn("dist/index.html not found; skipped");
}
