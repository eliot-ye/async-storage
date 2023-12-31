import { resolve } from "path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "libs/index.ts"),
        asyncStorage: resolve(__dirname, "libs/asyncStorage.ts"),
        cookie: resolve(__dirname, "libs/engine/cookie.ts"),
        localStorage: resolve(__dirname, "libs/engine/localStorage.ts"),
        indexedDB: resolve(__dirname, "libs/engine/indexedDB.ts"),
      },
      name: "AsyncStorage",
    },
    rollupOptions: {
      external: [],
    },
  },
  plugins: [dts({ rollupTypes: true })],
});
