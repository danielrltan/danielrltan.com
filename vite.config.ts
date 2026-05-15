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
        // Split heavy vendor groups into their own chunks so:
        //   1. The first paint only parses what the room needs (three+r3f).
        //   2. The OS bundle (postprocessing + OS UI) loads in parallel and
        //      is cached separately across deploys that don't touch them.
        manualChunks: (id) => {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@react-three/rapier") || id.includes("@dimforge"))
            return "rapier";
          if (id.includes("postprocessing")) return "post";
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
