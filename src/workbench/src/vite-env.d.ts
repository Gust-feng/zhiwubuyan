declare module "*.svg" {
  const src: string;
  export default src;
}

/** 由 vite.config.workbench.ts 的 define 注入，来源是项目 package.json 的版本号。 */
declare const __PRODUCT_VERSION__: string;

/**
 * 构建期运行面：网页产物固定为 "web"，其余产物为 "auto"，由 /api/status 在运行时决定。
 * 用于能力探测返回前给出正确的默认归属，避免网页端先按桌面端放行。
 */
declare const __WORKBENCH_SURFACE__: "web" | "auto";

interface ImportMetaEnv {
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.svg?raw" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}