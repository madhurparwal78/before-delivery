import { defineConfig, type Plugin } from "vite";

/** The app is same-origin only, so its own assets are loaded without CORS mode. */
function sameOriginAssets(): Plugin {
  return {
    name: "same-origin-assets",
    transformIndexHtml(html: string): string {
      return html.replace(/\s+crossorigin(=".*?")?/g, "");
    },
  };
}

export default defineConfig({
  root: "src/web",
  publicDir: "../../public",
  plugins: [sameOriginAssets()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
});
