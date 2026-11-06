import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dirname);
const tsc = path.join(root, "node_modules", ".bin", "tsc");
if (fs.existsSync(tsc)) {
  execFileSync(tsc, ["-p", "tsconfig.build.json"], { cwd: root, stdio: "inherit" });
}
fs.mkdirSync(path.join(root, "dist", "public", "assets"), { recursive: true });
execFileSync(path.join(root, "node_modules", ".bin", "esbuild"), [
  "src/client/main.tsx",
  "--bundle",
  "--outfile=dist/public/assets/app.js",
  "--loader:.ttf=file",
  "--minify",
  "--format=iife",
  "--target=es2020",
  "--jsx=automatic",
  "--define:process.env.NODE_ENV=\"production\"",
], { cwd: root, stdio: "inherit" });
execFileSync(path.join(root, "node_modules", ".bin", "esbuild"), [
  "src/client/sw.ts",
  "--bundle",
  "--outfile=dist/public/sw.js",
  "--format=iife",
  "--target=es2020",
], { cwd: root, stdio: "inherit" });
fs.copyFileSync(path.join(root, "src", "client", "index.html"), path.join(root, "dist", "public", "index.html"));
console.log("BUILD_OK");
