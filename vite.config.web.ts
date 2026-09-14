import path from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const projectPackage = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// 网页端（Vercel）构建：产品唯一的交付形态，工作台源码与本地预览共用同一份。
// 服务端承接的能力由前端按 /api/status 声明的能力集启用，未声明时如实显示未接通。
export default defineConfig({
  root: "src/workbench",
  envDir: import.meta.dirname,
  base: "./",
  define: {
    __PRODUCT_VERSION__: JSON.stringify(projectPackage.version),
    __WORKBENCH_SURFACE__: JSON.stringify("web"),
  },
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
