// Build script: compiles server TypeScript, then browser TypeScript, copies assets.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

rmSync(join(root, "dist"), { recursive: true, force: true });
mkdirSync(join(root, "dist/browser"), { recursive: true });

run("npx", ["tsc", "-p", "tsconfig.json"]);
run("npx", ["tsc", "-p", "tsconfig.browser.json"]);

cpSync(join(root, "public"), join(root, "dist/browser"), { recursive: true });

console.log("build complete");

