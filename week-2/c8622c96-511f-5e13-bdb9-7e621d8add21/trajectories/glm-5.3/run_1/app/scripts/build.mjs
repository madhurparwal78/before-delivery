#!/usr/bin/env node
// Build script: type-check and compile server TypeScript, bundle the client
// with esbuild, and copy fonts and styles into the public directory.
import { execSync } from "node:child_process";
import { mkdirSync, cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;

mkdirSync(join(root, "dist/public/assets/fonts"), { recursive: true });

execSync("npx tsc -p scripts/tsconfig.check.json", { stdio: "inherit", cwd: root });
execSync("npx tsc -p scripts/tsconfig.client.json", { stdio: "inherit", cwd: root });
execSync("npx tsc -p scripts/tsconfig.server.json", { stdio: "inherit", cwd: root });

execSync(
  "npx esbuild ./src/client/main.ts --bundle --outfile=dist/public/assets/app.js --format=iife " +
    "--target=es2022 --minify --legal-comments=none",
  { stdio: "inherit", cwd: root }
);
cpSync(join(root, "assets/fonts.css"), join(root, "dist/public/assets/fonts.css"), { recursive: false });
cpSync(join(root, "src/client/styles.css"), join(root, "dist/public/assets/styles.css"), { recursive: false });
cpSync(join(root, "assets/fonts"), join(root, "dist/public/assets/fonts"), { recursive: true });
writeFileSync(join(root, "dist/public/index.html"), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Saltprint Desk</title>
<link rel="stylesheet" href="/assets/fonts.css">
<link rel="stylesheet" href="/assets/styles.css">
<link rel="icon" href="data:">
</head>
<body>
<div id="root"></div>
<script src="/assets/app.js"></script>
</body>
</html>
`);
