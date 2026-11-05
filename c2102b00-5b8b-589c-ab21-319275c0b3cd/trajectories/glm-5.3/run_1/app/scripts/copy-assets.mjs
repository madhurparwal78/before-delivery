// Copies vendored assets that must be served by the app itself.
import { cpSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
mkdirSync(join(root, "public", "vendor", "three"), { recursive: true });
for (const f of ["three.module.js", "three.core.js"]) {
  cpSync(join(root, "node_modules", "three", "build", f), join(root, "public", "vendor", "three", f));
}
if (!existsSync(join(root, "public", "fonts"))) {
  console.error("public/fonts is missing; run scripts/fetch-fonts.mjs first");
  process.exit(1);
}
