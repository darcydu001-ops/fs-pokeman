/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PK_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
