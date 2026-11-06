import { build } from "esbuild";
import { mkdirSync, cpSync, rmSync, readdirSync } from "node:fs";

const out = "dist";
rmSync(out, { recursive: true, force: true });
mkdirSync(`${out}/server`, { recursive: true });
mkdirSync(`${out}/client`, { recursive: true });

await build({
  entryPoints: ["src/server/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  outfile: `${out}/server/index.mjs`,
  logLevel: "info",
});

await build({
  entryPoints: ["src/client/main.ts"],
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  outfile: `${out}/client/main.js`,
  logLevel: "info",
  minify: true,
});

for (const entry of readdirSync("src/public")) {
  if (entry === "fonts" || entry === "icons" || entry === "index.html") {
    cpSync(`src/public/${entry}`, `${out}/client/${entry}`, { recursive: true });
  }
}
cpSync("src/client/styles.css", `${out}/client/styles.css`);
console.log("build complete");
