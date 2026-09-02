import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/main/index.ts") } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          app: resolve(__dirname, "src/preload/app.ts"),
          picker: resolve(__dirname, "src/preload/picker.ts"),
          bubble: resolve(__dirname, "src/preload/bubble.ts"),
          hud: resolve(__dirname, "src/preload/hud.ts"),
        },
        // A sandboxed preload cannot load an ES module; CommonJS output only.
        output: { format: "cjs", entryFileNames: "[name].js" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      rollupOptions: {
        input: {
          picker: resolve(__dirname, "src/renderer/picker/index.html"),
          bubble: resolve(__dirname, "src/renderer/bubble/index.html"),
          hud: resolve(__dirname, "src/renderer/hud/index.html"),
        },
      },
    },
  },
});
