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
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@react-three/rapier") || id.includes("@dimforge"))
            return "rapier";
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
          return "vendor";
        },
      },
    },
  },
});
