import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Split heavy vendor groups into their own chunks so the first paint
        // only parses what the room+hero need (three+r3f), and large libs are
        // cached separately across deploys that don't touch them. Order
        // matters: the drei rule must precede the generic @react-three rule,
        // or drei would fall into the "three" chunk.
        manualChunks: (id) => {
          // Vite's __vitePreload helper is imported by the entry (it wraps
          // every lazy() dynamic import). Rollup otherwise co-locates it into
          // the `drei` chunk; since drei imports three, that single edge drags
          // BOTH drei and the ~1MB three chunk onto the first-paint/preload
          // path even though no eager code uses them. Pin the helper to the
          // always-eager react-vendor chunk so the entry's static graph never
          // reaches three/drei.
          if (id.includes("preload-helper")) return "react-vendor";
          if (!id.includes("node_modules")) return undefined;
          // drei is large and is referenced by the lazy section scenes; its
          // own chunk lets the browser cache it independently of three core.
          if (id.includes("@react-three/drei")) return "drei";
          // gsap/ScrollTrigger drives the section pins only (not first paint).
          if (id.includes("gsap")) return "gsap";
          if (
            id.includes("@react-three") ||
            id.includes("three-stdlib") ||
            id.includes("/three/")
          )
            return "three";
          if (id.includes("lucide-react")) return "icons";
          // React core in its own long-lived cache chunk.
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          )
            return "react-vendor";
          // Everything else: let Rollup auto-split. A catch-all "vendor" chunk
          // here was the bug behind the "three -> vendor -> three" circular
          // warning AND kept three on the first-paint path: it mixed eager
          // React with three-DEPENDENT libs that drei pulls (troika-three-text,
          // three-mesh-bvh, etc.). Those libs import three, so an eager vendor
          // chunk forced three eager. Returning undefined lets Rollup place
          // those lazy-only deps inside the LAZY scene/drei chunks instead.
          return undefined;
        },
      },
    },
  },
});
