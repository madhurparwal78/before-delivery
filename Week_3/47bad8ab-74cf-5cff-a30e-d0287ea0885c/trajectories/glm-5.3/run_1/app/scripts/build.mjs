import { build } from "esbuild";
import { mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";

mkdirSync("dist", { recursive: true });

await build({
  entryPoints: {
    client: "src/client/main.ts",
    styles: "src/client/styles.ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outdir: "dist/public/assets",
  minify: true,
  legalComments: "none",
});

await build({
  entryPoints: ["src/server/server.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  outfile: "dist/server.js",
  external: ["pg", "pg-pool", "ws"],
  minify: false,
});

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = `${src}/${name}`;
    const to = `${dest}/${name}`;
    if (statSync(from).isDirectory()) copyDir(from, to);
    else copyFileSync(from, to);
  }
}
copyDir("public", "dist/public");
console.log("build done");
