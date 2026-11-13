import { cp, mkdir, rm } from "node:fs/promises";
import { build } from "esbuild";

const common = { bundle: true, logLevel: "info", legalComments: "none" };

await rm("build", { recursive: true, force: true });
await mkdir("build/public/assets", { recursive: true });

await build({
  ...common,
  entryPoints: ["src/server/main.ts"],
  platform: "node",
  target: "node22",
  format: "cjs",
  packages: "external",
  outfile: "build/server.js",
});

await build({
  ...common,
  entryPoints: { app: "src/client/main.tsx" },
  platform: "browser",
  target: "es2022",
  format: "esm",
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  outdir: "build/public/assets",
});

await build({
  ...common,
  entryPoints: { "kernel-worker": "src/worker/kernel-worker.ts" },
  platform: "browser",
  target: "es2022",
  format: "iife",
  minify: true,
  outdir: "build/public/assets",
});

await cp("public", "build/public", { recursive: true });
