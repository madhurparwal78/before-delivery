import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/public", { recursive: true });

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  sourcemap: false,
});

await build({
  entryPoints: { app: "src/client/main.tsx" },
  outdir: "dist/public",
  bundle: true,
  format: "esm",
  target: ["es2022"],
  minify: true,
  sourcemap: false,
  jsx: "automatic",
  loader: { ".css": "css" },
  define: { "process.env.NODE_ENV": '"production"' },
});

await cp("src/client/index.html", "dist/public/index.html");
