import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";

export default defineConfig({
  base: "./",
  plugins: [svelte()],
  build: {
    outDir: "docs",
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      input: {
        network: path.resolve(__dirname, "network/index.html"),
        scrolly: path.resolve(__dirname, "scrolly/index.html"),
      },
    },
  },
});
