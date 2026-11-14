import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/client", { recursive: true });

await build({
  entryPoints: ["src/client/main.tsx"],
  outdir: "dist/client",
  entryNames: "app",
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  jsx: "automatic",
  external: ["/fonts/*"],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
});

await build({
  entryPoints: ["src/server/index.ts"],
  outfile: "dist/server/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
});

cpSync("public/fonts", "dist/client/fonts", { recursive: true });
