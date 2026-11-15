import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  base: "/",
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    assetsDir: "assets",
    rollupOptions: {
      input: {
        upload: "web/upload/index.html",
        player: "web/player/index.html",
      },
    },
  },
});
