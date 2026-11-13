import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const pkgPath = path.join(root, "node_modules", "esbuild", "package.json");
if (!fs.existsSync(pkgPath)) {
  process.stderr.write("esbuild not found; run npm install\n");
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const binName = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.esbuild;
let bin = path.join(root, "node_modules", "esbuild", binName);
if (!fs.existsSync(bin)) bin = path.join(root, "node_modules", ".bin", "esbuild");

const outDir = path.join(root, "dist");
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, "public"), { recursive: true });
for (const f of fs.readdirSync(path.join(root, "public"))) {
  fs.cpSync(path.join(root, "public", f), path.join(outDir, "public", f), { recursive: true });
}

fs.copyFileSync(path.join(root, "src", "styles.css"), path.join(outDir, "public", "styles.css"));

const res = spawnSync(bin, [
  path.join(root, "src", "main.ts"),
  "--bundle",
  "--minify",
  "--format=iife",
  "--target=es2019",
  "--charset=utf8",
  `--outfile=${path.join(outDir, "public", "main.js")}`,
], { encoding: "utf8" });
if (res.status !== 0) {
  process.stderr.write(res.stderr || String(res.error));
  process.exit(1);
}
if (res.stderr) process.stderr.write(res.stderr);
console.log("built web/dist/public/main.js");
