import { mkdirSync, copyFileSync, readdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = dirname(fileURLToPath(new URL(import.meta.url)));
const dist = join(root, "dist");
const publicDir = join(root, "public");

rmSync(dist, { recursive: true, force: true });
execFileSync(
  process.execPath,
  [join(root, "node_modules", "typescript", "lib", "tsc.js"), "--project", join(root, "tsconfig.build.json")],
  { stdio: "inherit", cwd: root }
);

execFileSync(
  process.execPath,
  [join(root, "node_modules", "typescript", "lib", "tsc.js"), "--project", join(root, "tsconfig.client.json")],
  { stdio: "inherit", cwd: root }
);

rmSync(join(dist, "public"), { recursive: true, force: true });
mkdirSync(join(publicDir, "js"), { recursive: true });


const serifDir = join(root, "node_modules", "@fontsource", "instrument-serif");
const sansDir = join(root, "node_modules", "@fontsource", "instrument-sans");
const fontsOut = join(publicDir, "fonts");
mkdirSync(fontsOut, { recursive: true });

copyFont(serifDir, fontsOut, "instrument-serif");
copyFont(sansDir, fontsOut, "instrument-sans");

function copyFont(sourceDir, targetDir, family) {
  const filesDir = join(sourceDir, "files");
  for (const file of readdirSync(filesDir)) {
    if (file.endsWith(".woff2") && /latin(-ext)?-(400|500|600)-normal/.test(file)) {
      copyFileSync(join(filesDir, file), join(targetDir, file));
    }
  }
}

console.log("Build complete");
