import { build, context } from "esbuild";
import { cpSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, "dist", "client");
mkdirSync(join(outDir, "assets"), { recursive: true });

copyFileSync(join(root, "src", "client", "index.html"), join(outDir, "index.html"));
copyFileSync(join(root, "src", "client", "styles.css"), join(outDir, "assets", "app.css"));
cpSync(join(root, "public", "fonts"), join(outDir, "assets", "fonts"), { recursive: true });

const options = {
  entryPoints: [join(root, "src", "client", "main.ts")],
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",
  target: "es2022",
  outfile: join(outDir, "assets", "app.js"),
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
