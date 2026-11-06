// Build: compile the server and the client, then copy the static assets.

import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

execFileSync("npx", ["tsc", "-p", "tsconfig.json"], { stdio: "inherit" });
execFileSync("npx", ["tsc", "-p", "tsconfig.client.json"], { stdio: "inherit" });

const root = process.cwd();
const destDir = join(root, "dist", "public");
await mkdir(destDir, { recursive: true });
await cp(join(root, "public"), destDir, { recursive: true });
console.log("built");
