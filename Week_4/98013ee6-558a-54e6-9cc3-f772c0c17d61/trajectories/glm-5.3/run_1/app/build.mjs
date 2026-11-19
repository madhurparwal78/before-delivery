import { build } from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

// Server: bundle to CJS (node built-ins via require), run from dist.
await build({
  entryPoints: ["src/server.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "dist/server.cjs",
  sourcemap: false,
  legalComments: "none",
});

// Client: bundle the app to public/app.js, served same-origin by express.static (IF-06).
await build({
  entryPoints: ["src/client/app.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: "public/app.js",
  target: "es2022",
  sourcemap: false,
  minify: true,
  legalComments: "none",
});

console.log("build done");
