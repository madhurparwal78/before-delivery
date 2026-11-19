import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  sourcemap: false,
  logLevel: "warning",
});

await build({
  entryPoints: { app: "src/client/main.tsx" },
  outdir: "dist/public",
  bundle: true,
  platform: "browser",
  target: ["chrome120", "firefox120", "safari17"],
  format: "esm",
  minify: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

await cp("src/client/index.html", "dist/public/index.html");
