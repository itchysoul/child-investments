/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SUPABASE_SCHEMA?: string;
  readonly VITE_APP_BASENAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
