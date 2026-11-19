// The build: copy fonts, typecheck everything, bundle the client, compile
// the server, stage the static assets next to the compiled output.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";

const log = (s) => process.stdout.write(s + "\n");
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

log("fonts...");
run("node", ["scripts/fonts.mjs"]);

log("typecheck...");
run("node", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.json"]);
run("node", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.server.json"]);

log("client bundle...");
const { build } = await import("esbuild");
const r = await build({
  entryPoints: ["src/client/main.tsx"],
  bundle: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  outfile: "static/app.js",
  loader: { ".woff2": "file" },
  logLevel: "error",
});
if (r.errors && r.errors.length > 0) process.exit(1);

log("server compile...");
run("node", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.server.json"]);

log("stage assets...");
mkdirSync("dist/static", { recursive: true });
cpSync("static", "dist/static", { recursive: true });
cpSync("src/server/schema.sql", "dist/schema.sql");

log("build done");
