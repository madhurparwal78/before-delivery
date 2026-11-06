// Pain de Lune — Loafline build script.
// Steps: 1) esbuild the server (TS -> JS in dist-server), 2) vite the client (into dist/),
// 3) stamp the client asset manifest the server reads at runtime.
import { build as esbuildBuild } from "esbuild";
import { execFileSync } from "node:child_process";
import { copyFileSync, writeFileSync } from "node:fs";

const serverOpts = {
  entryPoints: ["src-server/main.ts"],
  outdir: "dist-server",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: false,
  loader: { ".ts": "ts" }
};

console.log("building server…");
await esbuildBuild(serverOpts);
console.log("building client…");
execFileSync("node", ["node_modules/vite/bin/vite.js", "build"], { stdio: "inherit" });
copyFileSync("src/styles.css", "dist/styles.css");
console.log("build done.");
