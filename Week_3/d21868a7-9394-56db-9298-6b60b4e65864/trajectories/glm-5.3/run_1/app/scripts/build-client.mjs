import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

// Bundle the client with esbuild (a dev dependency, not shipped).
const result = execSync(
  "npx esbuild src/client/main.ts --bundle --format=esm --target=es2022 --outfile=public/app.js --minify --log-level=error",
  { cwd: process.cwd(), encoding: "utf8" },
);
console.log(result.trim());
console.log("client bundled to public/app.js");
