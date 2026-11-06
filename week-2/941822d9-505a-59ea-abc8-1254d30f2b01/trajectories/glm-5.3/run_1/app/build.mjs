import { execSync } from "node:child_process";
import { mkdirSync, cpSync, rmSync } from "node:fs";

rmSync("dist", { force: true, recursive: true });
mkdirSync("dist", { recursive: true });

// Server: Node module resolution, imports rewritten from .ts to .js.
execSync("npx tsc", { stdio: "inherit" });
cpSync("src/server/fonts", "dist/server/fonts", { recursive: true });

// Frontend: browser modules emitted straight into the assets folder.
execSync("npx tsc -p tsconfig.frontend.json", { stdio: "inherit" });

// Static shell, styles and fonts.
mkdirSync("dist/public", { recursive: true });
cpSync("public", "dist/public", { recursive: true });

console.log("build complete");
