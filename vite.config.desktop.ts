import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";

const externalModules = [
  "electron",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default defineConfig({
  build: {
    outDir: "dist/desktop",
    emptyOutDir: true,
    lib: {
      entry: path.resolve(import.meta.dirname, "src/desktop/main.ts"),
      formats: ["cjs"],
      fileName: () => "main.cjs",
    },
    rollupOptions: {
      external: externalModules,
    },
  },
});
