import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Excalidraw ships its own assets/fonts; keep them alongside the bundle.
  build: { outDir: "dist", assetsDir: "assets", emptyOutDir: true },
});
