import path from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectPackage = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

export default defineConfig({
  root: path.resolve(import.meta.dirname, "src/welcome"),
  base: "./",
  plugins: [react()],
  define: {
    __PRODUCT_VERSION__: JSON.stringify(projectPackage.version),
  },
  server: {
    host: "127.0.0.1",
    port: 4390,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/welcome"),
    emptyOutDir: true,
    cssCodeSplit: false,
  },
});
