// Build script: bundles the browser TypeScript to one ES2020 script, no
// bundler dependency needed beyond the TypeScript compiler shipped as a dev tool.
import { build } from "esbuild";
import { writeFileSync } from "node:fs";

await build({
  entryPoints: ["src/browser/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  outfile: "public/scripts/app.js",
  legalComments: "none",
});

writeFileSync("public/scripts/app.js.time", String(Date.now()));
console.log("built public/scripts/app.js");
