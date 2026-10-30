// Production build: bundles the server and the browser app into dist/ and copies the fonts.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });

await build({
  entryPoints: [join(root, "src/server/main.ts")],
  outfile: join(dist, "server.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["pg-native"],
  banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  legalComments: "none",
});

await build({
  entryPoints: { app: join(root, "src/client/main.ts"), styles: join(root, "src/client/styles.css") },
  outdir: join(dist, "public/assets"),
  bundle: true,
  splitting: true,
  format: "esm",
  target: "es2022",
  minify: true,
  chunkNames: "chunk-[hash]",
  external: ["/fonts/*"],
  legalComments: "none",
});

mkdirSync(join(dist, "public"), { recursive: true });
cpSync(join(root, "public"), join(dist, "public"), { recursive: true });
for (const dir of [".browser_screenshots", ".downloads"]) mkdirSync(join(root, dir), { recursive: true });
console.log("build: dist/server.js and dist/public ready");
