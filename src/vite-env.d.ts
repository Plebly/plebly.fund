/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORKERS_API?: string;
  readonly VITE_BITCOIN_NETWORK?: string;
  /** Show Lightning donate UI on non-mainnet (pairs with Workers LIGHTNING_ENABLED). */
  readonly VITE_LIGHTNING_TESTNET?: string;
  readonly VITE_LIGHTNING?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
