import { build } from "esbuild";

/** Bundles the browser code (src/client and the shared rule modules) into the one script the pages load. */
await build({
  entryPoints: ["src/client/main.ts"],
  outfile: "dist/web/app.js",
  bundle: true,
  format: "iife",
  target: "es2023",
  legalComments: "none",
});
