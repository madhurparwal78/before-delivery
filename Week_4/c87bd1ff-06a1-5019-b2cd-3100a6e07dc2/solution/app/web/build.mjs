import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "assets"), { recursive: true });

await build({
  entryPoints: { app: join(root, "src/main.tsx") },
  outdir: join(dist, "assets"),
  bundle: true,
  format: "esm",
  target: "es2022",
  minify: true,
  sourcemap: false,
  jsx: "automatic",
  jsxImportSource: "preact",
  loader: { ".css": "css" },
  external: ["/fonts/*"],
  legalComments: "none",
});

cpSync(join(root, "public/fonts"), join(dist, "fonts"), { recursive: true });
cpSync(join(root, "index.html"), join(dist, "index.html"));
