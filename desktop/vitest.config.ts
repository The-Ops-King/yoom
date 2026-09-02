import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Only the pure main-process maths is unit-tested. Everything that touches
    // Electron, media or TCC lives in the manual verification matrix.
    include: ["src/main/**/*.test.ts", "src/preload/**/*.test.ts"],
  },
});
