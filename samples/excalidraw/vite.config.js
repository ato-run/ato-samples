import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The workspace serves the app under /apps/<pane>/, so assets must resolve
  // relative to the entry rather than from the server root.
  base: "./",
  plugins: [react()],
  // Excalidraw ships its own assets/fonts; keep them alongside the bundle.
  build: { outDir: "dist", assetsDir: "assets", emptyOutDir: true },
});
