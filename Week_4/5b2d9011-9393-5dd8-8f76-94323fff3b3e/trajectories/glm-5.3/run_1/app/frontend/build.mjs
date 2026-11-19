// Bundles the TypeScript frontend with esbuild into frontend/dist.
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist");

mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "src/main.ts")],
  bundle: true,
  format: "esm",
  target: ["es2022"],
  outfile: join(out, "app.js"),
  minify: true,
  sourcemap: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});

cpSync(join(root, "public"), out, { recursive: true });
cpSync(join(root, "fonts"), join(out, "fonts"), { recursive: true });
console.log("built frontend into", out);
