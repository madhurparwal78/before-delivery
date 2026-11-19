import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/client/assets", { recursive: true });

await build({
  entryPoints: ["server/index.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  logLevel: "warning",
});

await build({
  entryPoints: { app: "src/main.tsx" },
  outdir: "dist/client/assets",
  bundle: true,
  format: "esm",
  target: ["chrome110", "firefox110", "safari16"],
  minify: true,
  jsx: "automatic",
  loader: { ".css": "css" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

await cp("index.html", "dist/client/index.html");
