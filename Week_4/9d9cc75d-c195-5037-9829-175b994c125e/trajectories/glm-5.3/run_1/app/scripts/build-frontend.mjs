import { build } from "esbuild";
import { mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

mkdirSync("dist/public", { recursive: true });
mkdirSync("dist/public/fonts", { recursive: true });

await build({
  entryPoints: ["src/client/main.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  outfile: "dist/public/app.js",
  legalComments: "none",
});

copyFileSync("src/client/styles.css", "dist/public/styles.css");
copyFileSync("src/client/index.html", "dist/public/index.html");
for (const f of readdirSync("assets/fonts")) {
  copyFileSync(join("assets/fonts", f), join("dist/public/fonts", f));
}
console.log("frontend built");
