import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Mirrors the `@/*` path mapping in tsconfig.json. Vitest picks that up on
  // its own only while there is no explicit config file; declaring one means
  // we have to restate the alias here.
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
    // `server-only` throws unless the "react-server" condition is on. Vitest
    // applies it implicitly when there is no config file; declaring one means
    // restating it, otherwise every server-side module fails to import.
    conditions: ["react-server", "node", "import", "module", "default"],
  },
  // Vitest externalizes/loads test modules through Vite's SSR pipeline, which
  // has its own condition list.
  ssr: {
    resolve: {
      conditions: ["react-server", "node", "import", "module", "default"],
      externalConditions: ["react-server", "node", "import", "module", "default"],
    },
  },
  test: {
    // `desktop/` is a separate npm package with its own vitest config and its
    // own (Electron) dependency tree. Run it with `npm --prefix desktop test`.
    exclude: ["**/node_modules/**", "desktop/**", "**/.next/**"],
  },
});
