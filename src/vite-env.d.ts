/// <reference types="vite/client" />

// Endpoint overrides for running against a local backend instead of the
// deployed one. Both are optional; without them the app targets production.
interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_WS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
