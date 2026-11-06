import { build, buildSync } from "esbuild";
import { mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

mkdirSync("dist", { recursive: true });
mkdirSync("dist/assets/fonts", { recursive: true });

const res = await build({
  entryPoints: ["src/client/main.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2022", "chrome120", "firefox120", "safari17"],
  outfile: "dist/assets/app.js",
  sourcemap: false,
  legalComments: "none",
  write: true,
});
if (res.errors.length) { console.error(res.errors); process.exit(1); }

buildSync({
  entryPoints: ["src/server/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/server.js",
  sourcemap: false,
  packages: "external",
  legalComments: "none",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

for (const name of readdirSync("src/client/fonts")) {
  const p = join("src/client/fonts", name);
  if (statSync(p).isFile()) copyFileSync(p, join("dist/assets/fonts", name));
}
copyFileSync("src/client/app.css", "dist/assets/app.css");
console.log("build done");
