import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";

await build({
  entryPoints: { app: "src/browser/main.ts" },
  bundle: true,
  format: "esm",
  outdir: "public/assets",
  sourcemap: false,
  minify: true,
  target: "es2022",
  logLevel: "info",
});

mkdirSync("dist/src/server/db", { recursive: true });
copyFileSync("src/server/db/schema.sql", "dist/src/server/db/schema.sql");
