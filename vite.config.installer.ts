import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: path.resolve(import.meta.dirname, "packaging/windows/installer-shell/web"),
  base: "./",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5199, strictPort: true },
  build: { outDir: path.resolve(import.meta.dirname, "dist/installer"), emptyOutDir: true, cssCodeSplit: false },
});
