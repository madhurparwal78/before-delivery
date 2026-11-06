import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { cp, writeFile } from "node:fs/promises";

mkdirSync("dist", { recursive: true });
mkdirSync("public/assets", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/server.js",
  sourcemap: false,
  external: ["pg"],
  packages: "external",
});

try {
await build({
  entryPoints: ["src/web/main.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  outfile: "public/assets/app.js",
  sourcemap: false,
  minify: false,
});
} catch (e: unknown) {
  console.log("web build skipped:", e instanceof Error ? e.message : String(e));
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kiln Desk</title>
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body>
<div id="root"></div>
<script src="/assets/app.js" defer></script>
</body>
</html>
`;
await writeFile("public/index.html", html);
await cp("src/web/styles.css", "public/assets/styles.css").catch(() => { console.log("styles.css not present yet"); });
console.log("build done");
