import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // Relative asset URLs, resolved against <base href> in index.html, so one build serves at any path prefix.
  base: "./",
  plugins: [react()],
  resolve: { alias: { "@ctx/shared": path.resolve(__dirname, "../shared/src/index.ts") } },
  server: {
    port: 5173,
    proxy: { "/ws": { target: "ws://localhost:3000", ws: true }, "/api": "http://localhost:3000", "/slides": "http://localhost:3000" },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
