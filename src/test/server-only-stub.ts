// Stub for the `server-only` package, which throws when imported outside
// Next's react-server bundler condition. Vitest has no such condition, so
// any test that transitively imports a server-only module (e.g. via
// `@/lib/supabase` or `@/lib/google-drive`) would crash at module load
// without this alias in vitest.config.ts.
export {};
