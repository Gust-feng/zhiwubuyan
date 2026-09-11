import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// 网页端（Vercel）独立构建：最小壳，只用知乎 API；不装 demo 传输层，无凭证时如实报错。
export default defineConfig({
  root: "src/web",
  envDir: import.meta.dirname,
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@ui": path.resolve(import.meta.dirname, "src/workbench/src"),
      "@api-contracts": path.resolve(import.meta.dirname, "src/workbench/api-contracts"),
      "@contracts": path.resolve(import.meta.dirname, "src/contracts"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4304,
    strictPort: true,
    proxy: {
      "^/api/": "http://127.0.0.1:4301",
    },
  },
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
  },
});
