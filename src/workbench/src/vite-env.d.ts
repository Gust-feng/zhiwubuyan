declare module "*.svg" {
  const src: string;
  export default src;
}

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