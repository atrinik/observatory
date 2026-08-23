import { defineConfig } from "astro/config";

export default defineConfig({
  output: "static",
  site: "https://observatory.atrinik.org",
  build: {
    assets: "assets",
    inlineStylesheets: "never",
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
