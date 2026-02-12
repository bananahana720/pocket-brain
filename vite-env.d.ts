/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_USE_AI_PROXY?: string;
  readonly VITE_SYNC_QUEUE_HARD_CAP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
