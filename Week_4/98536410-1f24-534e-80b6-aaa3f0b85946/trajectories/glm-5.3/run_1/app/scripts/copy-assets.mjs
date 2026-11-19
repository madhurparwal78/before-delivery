import { mkdirSync, copyFileSync, readdirSync, statSync } from "fs";
import path from "path";

function copyDir(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

copyDir("public", "dist/public");
copyFileSync("src/server/schema.sql", "dist/server/schema.sql");copyFileSync("vendor-fonts/bigshoulders.woff2", "dist/public/fonts/bigshoulders.woff2");
copyFileSync("vendor-fonts/publicsans.woff2", "dist/public/fonts/publicsans.woff2");
