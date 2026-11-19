// Bundles the browser app with esbuild and assembles dist/public (scripts, styles, fonts, Draco decoder, index.html).
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "public");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: { app: join(root, "src", "client", "main.tsx") },
  outdir: out,
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  legalComments: "none",
  logLevel: "warning",
  external: ["/fonts/*"],
  define: { "process.env.NODE_ENV": '"production"' },
});

cpSync(join(root, "public"), out, { recursive: true });

const template = readFileSync(join(root, "src", "client", "index.html"), "utf8");
writeFileSync(join(out, "index.html"), template);
