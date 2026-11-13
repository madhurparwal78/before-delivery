import { mkdirSync, readdirSync, copyFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "client");
const dest = join(root, "public");

mkdirSync(dest, { recursive: true });

const exts = new Set([".html", ".css", ".js", ".svg", ".woff2", ".txt", ".ico"]);
let copied = 0;
for (const entry of readdirSync(src, { recursive: true })) {
  const rel = entry.toString();
  const from = join(src, rel);
  if (!statSync(from).isFile()) continue;
  if (!exts.has(extname(from))) continue;
  const to = join(dest, rel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied++;
}
writeFileSync(join(dest, "build-stamp.txt"), new Date().toISOString());
console.log(`client assets copied: ${copied}`);
