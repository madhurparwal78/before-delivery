// Builds the browser bundle: styles, TypeScript entry points, and static assets.
import { build } from "esbuild";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";

mkdirSync("dist", { recursive: true });

const serverResult = await build({
  entryPoints: ["src/server/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: "dist/server.js",
  packages: "external",
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  loader: { ".ts": "ts" },
});

const browserResult = await build({
  entryPoints: ["src/browser/main.ts"],
  bundle: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  outfile: "dist/app.js",
  loader: { ".ts": "ts" },
  minify: true,
});
if (serverResult.errors.length > 0 || browserResult.errors.length > 0) process.exit(1);

copyFileSync("src/browser/index.html", "dist/index.html");
copyFileSync("src/browser/styles.css", "dist/styles.css");
if (existsSync("public/host-grotesk.ttf")) copyFileSync("public/host-grotesk.ttf", "dist/host-grotesk.ttf");
for (const f of ["demo-radio.jpg", "demo-calculator.jpg", "demo-kettle.jpg"]) {
  if (existsSync(`assets/photos/${f}`)) copyFileSync(`assets/photos/${f}`, `dist/${f}`);
}
console.log("build complete");
