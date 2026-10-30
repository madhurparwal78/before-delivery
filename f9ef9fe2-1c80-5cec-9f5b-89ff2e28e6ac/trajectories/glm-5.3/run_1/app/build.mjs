import { build } from "esbuild";
import { mkdirSync, rmSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
const pub = path.join(dist, "public");

rmSync(dist, { recursive: true, force: true });
mkdirSync(pub, { recursive: true });

execSync("tsc --noEmit", { stdio: "inherit", cwd: root });

// Server bundle
await build({
  entryPoints: [path.join(root, "src/server/main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: path.join(dist, "server.js"),
  external: ["pg", "pg-types", "pg-connection-string", "pg-protocol", "pg-pool", "pg-cloudflare", "express"],
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
});

// Browser bundle
await build({
  entryPoints: [path.join(root, "src/browser/main.ts")],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: path.join(pub, "app.js"),
  sourcemap: false,
  legalComments: "none",
  minify: true,
  logLevel: "info",
});

// Static assets
cpSync(path.join(root, "src/browser/index.html"), path.join(pub, "index.html"));
cpSync(path.join(root, "assets"), path.join(pub, "assets"), { recursive: true });
cpSync(path.join(root, "src/browser/styles.css"), path.join(pub, "app.css"));
console.log("build complete");
