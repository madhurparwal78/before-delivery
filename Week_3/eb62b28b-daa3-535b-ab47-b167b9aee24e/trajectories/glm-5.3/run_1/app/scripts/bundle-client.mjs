import { build } from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const outdir = resolve(root, "public");
mkdirSync(outdir, { recursive: true });

await build({
  entryPoints: [resolve(root, "src/client/app.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome120"],
  outfile: resolve(outdir, "app.js"),
  sourcemap: false,
  minify: true,
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
});

copyFileSync(resolve(root, "public/fonts/Fraunces-OFL.txt"), resolve(outdir, "fonts/Fraunces-OFL.txt"));
copyFileSync(resolve(root, "public/fonts/Figtree-OFL.txt"), resolve(outdir, "fonts/Figtree-OFL.txt"));
console.log("client built");
