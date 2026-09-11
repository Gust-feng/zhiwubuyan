import { defineConfig } from "vite";

/**
 * 后端独立构建：服务端入口打包到 dist/backend，与前端产物分离。
 * 原生/本地模块（libsql 系）与 Mastra 包保持外部依赖，
 * 由随包 Node 直接加载，不按 Electron ABI 重建。
 * 两个入口：index 是研究后端库；desktop-server 是桌面端可执行服务（由 Electron 拉起）。
 */
export default defineConfig({
  build: {
    ssr: true,
    outDir: "dist/backend",
    target: "node24",
    minify: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: "src/backend/index.ts",
        "desktop-server": "src/server/desktop-server.ts",
      },
      external: [
        /^node:/,
        "@mastra/core",
        /^@mastra\/core\//,
        "@mastra/libsql",
        "@mastra/memory",
        "@libsql/client",
        "proper-lockfile",
      ],
      output: {
        format: "esm",
        entryFileNames: "[name].mjs",
      },
    },
  },
});
