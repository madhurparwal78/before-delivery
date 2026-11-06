// Loads src/tsconfig.json, type-checks with tsc, then bundles server, client and
// the shared modules with esbuild. Fonts are copied verbatim at build time.
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { rm, mkdir, cp, readdir, copyFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTsconfig } from "./config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tscBin = join(root, "node_modules", "typescript", "bin", "tsc");

let ok = true;
try {
  console.log("tsc --noEmit");
  execFileSync(process.execPath, [tscBin, "--noEmit"], { cwd: root, stdio: "inherit" });
} catch {
  process.exitCode = 1;
  ok = false;
}
const cfg = await loadTsconfig(root);
const tsconfigFile = join(root, "src/tsconfig.json");
await rm(join(root, "build"), { recursive: true, force: true });
await mkdir(join(root, "build"), { recursive: true });
if (ok) {
  for (const flavor of ["server", "shared"]) {
    console.log(`bundle ${flavor}`);
    await build({
      entryPoints: { index: join(root, `src/${flavor}/main.ts`) },
      bundle: true,
      write: true,
      platform: "node",
      format: "esm",
      target: "es2022",
      keepNames: true,
      outdir: join(root, `build/${flavor}`),
      tsconfig: tsconfigFile,
      logLevel: "warning",
      external: ["@aws-sdk/*", "nodemailer"],
    });
  }
  // The client bundle runs in the browser, not on Node.
  console.log("bundle client");
  await build({
    entryPoints: { index: join(root, "src/client/main.ts") },
    bundle: true,
    write: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    outdir: join(root, "build/client"),
    tsconfig: tsconfigFile,
    logLevel: "warning",
  });
}

await mkdir(join(root, "build/client"), { recursive: true });
await mkdir(join(root, "build/fonts"), { recursive: true });
for (const face of ["libre-franklin", "source-serif-4"]) {
  const from = join(root, `assets/fonts/${face}`);
  const to = join(root, `build/fonts/${face}`);
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from)) {
    if (entry.endsWith(".woff2")) {
      await cp(join(from, entry), join(to, entry));
    }
  }
}
// The client bundle is a browser module: the page shell loads it as
// /clapstick.js.
await copyFile(join(root, "src/client/clapstick.css"), join(root, "build/client/clapstick.css"));
console.log("build done");
