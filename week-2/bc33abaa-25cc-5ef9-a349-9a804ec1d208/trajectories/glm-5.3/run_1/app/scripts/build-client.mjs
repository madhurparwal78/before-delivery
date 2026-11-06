import { build } from "esbuild";
import { mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs";

async function main() {
  mkdirSync("dist/server", { recursive: true });
  mkdirSync("src/client/public", { recursive: true });

  await build({
    entryPoints: ["src/server/main.ts"],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    outfile: "dist/server/main.js",
    packages: "external",
    legalComments: "external",
    sourcemap: false,
  });

  await build({
    entryPoints: ["src/client/main.ts"],
    bundle: true,
    platform: "browser",
    target: "es2022",
    format: "iife",
    outfile: "src/client/public/app.js",
    sourcemap: false,
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  });

  // Fonts ship from the app's own origin.
  mkdirSync("src/client/public/fonts", { recursive: true });
  for (const pkg of ["space-grotesk", "ibm-plex-sans", "ibm-plex-mono"]) {
    const dir = `node_modules/@fontsource/${pkg}/files`;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".woff2")) continue;
      if (!file.includes("latin-400") && !file.includes("latin-500") && !file.includes("latin-600")) continue;
      copyFileSync(`${dir}/${file}`, `src/client/public/fonts/${file}`);
    }
  }
  console.log("build complete");
}

void main();
