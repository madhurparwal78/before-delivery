import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";

execFileSync("node", ["scripts/fonts.mjs"], { stdio: "inherit" });

const run = (args) => {
  const r = spawnSync("node_modules/.bin/esbuild", args, { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

// Bundle the browser client and copy the stylesheet and service worker.
const entry = "src/client/client.ts";
mkdirSync("build/public/assets", { recursive: true });
run([entry, "--bundle", "--minify", "--format=iife", "--target=es2022", "--outfile=build/public/assets/client.js"]);
copyFileSync("src/client/app.css", "build/public/assets/app.css");
copyFileSync("src/client/fonts.css", "build/public/assets/fonts.css");
copyFileSync("src/client/sw.js", "build/public/sw.js");

// Bundle the server.
const server = "src/server/main.ts";
mkdirSync("build/server", { recursive: true });
run([server, "--bundle", "--platform=node", "--format=cjs", "--target=es2022", "--outfile=build/server/server.cjs", "--packages=external"]);
