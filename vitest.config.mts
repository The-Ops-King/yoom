import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./src/test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // `desktop/` is a separate npm package with its own vitest config and its
    // own (Electron) dependency tree. Run it with `npm --prefix desktop test`.
    exclude: ["**/node_modules/**", "desktop/**", "**/.next/**"],
  },
});
