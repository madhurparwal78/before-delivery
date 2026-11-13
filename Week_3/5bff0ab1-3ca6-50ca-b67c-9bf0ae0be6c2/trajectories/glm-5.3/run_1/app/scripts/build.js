// Build: type-check the server, then bundle the client with esbuild.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const dist = path.join(root, "dist");

fs.mkdirSync(dist, { recursive: true });

// 1. typecheck server with tsc (emits to dist)
execSync(`npx tsc -p ${path.join(root, "tsconfig.server.json")}`, { stdio: "inherit", cwd: root });

// 2. bundle the client: one entry per page, shared modules folded in
const esbuild = require(path.join(root, "node_modules", "esbuild"));
const entryPoints = ["showroom", "testride", "garage", "hub"].map((name) =>
  path.join(root, "src/client", `${name}.ts`)
);

for (const entry of entryPoints) {
  const out = path.join(root, "public", path.basename(entry, ".ts") + ".js");
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    outfile: out,
    format: "iife",
    target: "es2022",
    minify: true,
    // the three.js MIT notice stays inside the bundle
    legalComments: "inline",
  });
  console.log(`bundled ${path.basename(entry)} -> public`);
}
console.log("build done");
