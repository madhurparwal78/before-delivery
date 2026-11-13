import { build } from "esbuild";
import { copyFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";

mkdirSync("public", { recursive: true });
mkdirSync("public/fonts", { recursive: true });
mkdirSync("public/icons", { recursive: true });

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",
  target: "es2022",
  outfile: "public/app.js",
});

await build({
  entryPoints: ["src/styles.css"],
  bundle: true,
  minify: true,
  loader: { ".css": "css" },
  outfile: "public/app.css",
  external: ["/static/*"],
});

for (const f of readdirSync("static/fonts")) {
  if (f.endsWith(".woff2")) copyFileSync(`static/fonts/${f}`, `public/fonts/${f}`);
}

for (const f of ["warn.svg", "now.svg", "block.svg"]) {
  if (existsSync(`static/icons/${f}`)) copyFileSync(`static/icons/${f}`, `public/icons/${f}`);
}

console.log("frontend built");
