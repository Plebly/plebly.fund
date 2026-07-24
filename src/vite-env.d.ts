/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORKERS_API?: string;
  readonly VITE_BITCOIN_NETWORK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
