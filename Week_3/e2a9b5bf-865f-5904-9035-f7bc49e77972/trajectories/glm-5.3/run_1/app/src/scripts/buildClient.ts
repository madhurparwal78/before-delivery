// Build script: compile the server, then bundle the browser client.
import { build } from "esbuild";
import { copyFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

await build({
  entryPoints: [join(root, "src/client/main.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: join(root, "public/app.js"),
  sourcemap: false,
  legalComments: "none",
  minify: true,
});

copyFileSync(join(root, "src/client/styles.css"), join(root, "public/app.css"));

console.log("client bundled");
