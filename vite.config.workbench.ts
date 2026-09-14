import path from "node:path";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const projectPackage = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// 工作台前端的本地开发/预览构建：源码位于 src/workbench，入口 index.html → /src/main.tsx，产物在 dist/workbench。
// 界面数据全部来自本地后端（/api/* 代理到 4301）；后端未提供的能力在界面上呈现空态或错误，不用示例数据顶替。
export default defineConfig({
  root: "src/workbench",
  envDir: import.meta.dirname,
  base: "./",
  define: {
    __PRODUCT_VERSION__: JSON.stringify(projectPackage.version),
    // 产品只交付网页端：这里只服务本地开发与预览，运行面是网页端。
    __WORKBENCH_SURFACE__: JSON.stringify("auto"),
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
    port: 4303,
    proxy: {
      // 用正则精确匹配 /api/，避免把源码模块路径 /api-contracts/* 一并代理走。
      "^/api/": "http://127.0.0.1:4301",
    },
  },
  build: {
    outDir: "../../dist/workbench",
    emptyOutDir: true,
  },
});
