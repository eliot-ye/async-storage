import fs from "node:fs";
import { resolve } from "path";
import { defineConfig, createLogger } from "vite";
import dts from "vite-plugin-dts";

const logger = createLogger();

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "libs/index.ts"),
        asyncStorage: resolve(__dirname, "libs/asyncStorage.ts"),
        syncStorage: resolve(__dirname, "libs/syncStorage.ts"),
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
  plugins: [
    {
      name: "vite-plugin-copy",
      enforce: "post",
      closeBundle() {
        logger.info("Copying package.json to dist/package.json");
        fs.copyFileSync(
          resolve(__dirname, "package.json"),
          resolve(__dirname, "dist/package.json")
        );
        logger.info("Copying LICENSE to dist/LICENSE");
        fs.copyFileSync(
          resolve(__dirname, "LICENSE"),
          resolve(__dirname, "dist/LICENSE")
        );
        logger.info("Copying README.md to dist/README.md");
        fs.copyFileSync(
          resolve(__dirname, "README.md"),
          resolve(__dirname, "dist/README.md")
        );
      },
    },
    dts({ rollupTypes: true }),
  ],
});
