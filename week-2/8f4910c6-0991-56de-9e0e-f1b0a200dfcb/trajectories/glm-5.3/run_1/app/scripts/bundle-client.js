import { build } from "esbuild";

/** Bundles the browser app into one classic script served at /app.js. */
await build({
  entryPoints: ["public-src/app.ts"],
  bundle: true,
  outfile: "public-static/app.js",
  target: "es2022",
  format: "iife",
  minify: true,
  logLevel: "info",
});
console.log("client bundled to public-static/app.js");
