import { build } from "esbuild";
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";

const shared = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
  logLevel: "info",
};

mkdirSync("dist/public", { recursive: true });

await build({
  ...shared,
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server.js",
  external: ["pg"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});

copyFileSync("src/server/schema.sql", "dist/schema.sql");

await build({
  ...shared,
  entryPoints: ["src/browser/main.ts"],
  outfile: "dist/public/app.js",
  platform: "browser",
});

copyFileSync("src/browser/index.html", "dist/public/index.html");

// Fonts are served by the app itself, straight from the built assets.
for (const font of readdirSync("src/browser/fonts")) {
  copyFileSync(`src/browser/fonts/${font}`, `dist/public/${font}`);
}
