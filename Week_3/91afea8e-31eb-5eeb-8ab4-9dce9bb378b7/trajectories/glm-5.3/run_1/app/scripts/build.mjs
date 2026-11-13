import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", path.join(root, "tsconfig.build.json")], { stdio: "inherit" });

// client/ is copied as-is; the browser compiles nothing and the server serves it compiled at runtime
fs.cpSync(path.join(root, "src/client"), path.join(dist, "client"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(dist, "public"), { recursive: true });
console.log("build complete");
