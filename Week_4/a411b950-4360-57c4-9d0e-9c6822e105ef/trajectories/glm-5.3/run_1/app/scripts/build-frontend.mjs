#!/usr/bin/env node
/**
 * Frontend build: type-checks and compiles the browser TypeScript with tsc
 * into public/app.js as ES modules, copies the CSS, fonts and icons.
 * esbuild is deliberately not used; tsc output is served as-is.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "public");
const assetsDir = join(outDir, "assets");

mkdirSync(join(assetsDir, "fonts"), { recursive: true });
mkdirSync(join(assetsDir, "icons"), { recursive: true });

// Compile the browser sources.
execFileSync(
  "npx",
  [
    "tsc",
    "-p",
    "tsconfig.frontend.json",
  ],
  { stdio: "inherit", cwd: root },
);

// tsc preserves the directory structure under public/app/<file>.js, which the
// page imports as modules.

// Copy static assets.
copyFileSync(join(root, "frontend/styles.css"), join(outDir, "styles.css"));
for (const file of readdirSync(join(root, "frontend/assets/fonts"))) {
  copyFileSync(join(root, "frontend/assets/fonts", file), join(assetsDir, "fonts", file));
}
for (const file of readdirSync(join(root, "frontend/assets/icons"))) {
  copyFileSync(join(root, "frontend/assets/icons", file), join(assetsDir, "icons", file));
}

// The HTML entry points are authored per route; copy them.
for (const page of ["index.html", "listen.html", "proposal.html", "console.html"]) {
  const source = join(root, "frontend", page);
  if (existsSync(source)) {
    copyFileSync(source, join(outDir, page));
  }
}

console.log("Frontend built into public/");
