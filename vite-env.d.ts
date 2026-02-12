/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_AI_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
