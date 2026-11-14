import { build } from "esbuild";
import { readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

rmSync("dist-test", { recursive: true, force: true });
const files = readdirSync("test").filter((f) => f.endsWith(".test.ts"));
await build({
  entryPoints: files.map((f) => `test/${f}`),
  outdir: "dist-test",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  outExtension: { ".js": ".mjs" },
  logLevel: "warning",
});
const result = spawnSync("node", ["--test", ...files.map((f) => `dist-test/${f.replace(/\.ts$/, ".mjs")}`)], { stdio: "inherit" });
process.exit(result.status ?? 1);
