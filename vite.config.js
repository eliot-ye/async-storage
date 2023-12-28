import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        asyncStorage: resolve(__dirname, "libs/asyncStorage.ts"),
        cookie: resolve(__dirname, "libs/engine/cookie.ts"),
        localStorage: resolve(__dirname, "libs/engine/localStorage.ts"),
        indexedDB: resolve(__dirname, "libs/engine/indexedDB.ts"),
      },
      name: "AsyncStorage",
    },
  },
});
