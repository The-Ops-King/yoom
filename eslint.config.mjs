import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "desktop/**",
    // Agent worktrees are full copies of this repo. Linting them reports every
    // finding N times over and buries real ones in src/.
    ".claude/**",
    ".superpowers/**",
  ]),
]);

export default eslintConfig;
